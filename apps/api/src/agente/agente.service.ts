import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { HERRAMIENTAS_SCHEMAS, ejecutarHerramienta } from './herramientas';
import { validarEnriquecimiento, esPorPeso } from './confianza';

const norm = (s: string) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const PROMPT_ENRIQUECER = `Sos el catalogador experto de O.D.B, un outlet PREMIUM de bebidas y almacén en Canning, Argentina.
Te paso productos con el nombre tal cual viene del sistema viejo (sucio, abreviado). Para CADA uno devolvé un objeto:
- sku (igual al que te paso)
- nombre_limpio (comercial y prolijo)
- marca
- varietal_o_tipo
- volumen_ml (número o null)
- graduacion (grados de alcohol, número o null)
- categoria (rubro)
- descripcion (2-3 frases, tono premium, lista para el e-commerce; SIN inventar premios ni puntajes)
- confianza (0 a 1: qué tan seguro estás de los datos inferidos a partir del nombre)
Si dudás de un dato ponelo en null y bajá la confianza. Devolvé SOLO un array JSON, sin texto extra.`;

const SISTEMA = `Sos el Agente IA Operativo de ODB (un outlet de bebidas y almacén). Tu trabajo es ejecutar
tareas operativas del catálogo usando las herramientas disponibles, con AUTONOMÍA SUPERVISADA:
- Actuá solo en operaciones de bajo riesgo (mejorar datos, generar prompts de imagen, publicar).
- Antes de crear un producto, fijate que no exista (la herramienta avisa si está duplicado).
- Si NO podés completar la tarea por tu cuenta (alto impacto, ambigüedad, datos faltantes,
  o confianza < 0.85), NO respondas pidiendo confirmación en texto: llamá SIEMPRE a la
  herramienta request_human_review con el motivo. Es la ÚNICA forma de derivar a un humano.
- Sé conciso. Cuando termines, respondé en 1-2 frases qué hiciste.`;

@Injectable()
export class AgenteService {
  private readonly claude = new Anthropic();

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async encolar(descripcion: string, tipo = 'general', origen = 'manual') {
    if (!descripcion?.trim()) throw new BadRequestException('La tarea necesita una descripción');
    const { data, error } = await this.db.from('agente_tareas').insert({ descripcion: descripcion.trim(), tipo, origen }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    return { tareaId: data.id };
  }

  // Procesa una tarea con el loop de tool-use; audita cada acción y escala si corresponde.
  async ejecutar(tareaId: number) {
    const { data: tarea } = await this.db.from('agente_tareas').select('*').eq('id', tareaId).maybeSingle();
    if (!tarea) throw new BadRequestException('No existe la tarea');
    if (tarea.estado === 'completada') return { estado: 'completada', resultado: tarea.resultado };
    await this.db.from('agente_tareas').update({ estado: 'procesando' }).eq('id', tareaId);

    const messages: any[] = [{ role: 'user', content: tarea.descripcion }];
    let escalado: { motivo: string } | null = null;
    let resumen = '';
    let acciones = 0;

    try {
      for (let paso = 0; paso < 6; paso++) {
        const resp = await this.claude.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: SISTEMA,
          tools: HERRAMIENTAS_SCHEMAS as any,
          messages,
        });
        const texto = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ').trim();
        if (texto) resumen = texto;
        const toolUses = resp.content.filter((c: any) => c.type === 'tool_use');
        if (resp.stop_reason !== 'tool_use' || !toolUses.length) break;

        messages.push({ role: 'assistant', content: resp.content });
        const toolResults: any[] = [];
        for (const tu of toolUses as any[]) {
          const r = await ejecutarHerramienta(this.db, tu.name, tu.input);
          acciones += 1;
          await this.db.from('agente_auditoria').insert({ tarea_id: tareaId, herramienta: tu.name, argumentos: tu.input, resultado: r.resultado, ok: r.ok });
          if (r.escalar) escalado = { motivo: r.resultado?.motivo || 'Escalado por el agente' };
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r.resultado) });
        }
        messages.push({ role: 'user', content: toolResults });
        if (escalado) break;
      }
    } catch (e: any) {
      await this.db.from('agente_tareas').update({ estado: 'error', resultado: e.message, procesado_en: new Date().toISOString() }).eq('id', tareaId);
      throw new BadRequestException('El agente falló: ' + e.message);
    }

    const estado = escalado ? 'escalada' : 'completada';
    await this.db.from('agente_tareas').update({
      estado, resultado: resumen || (escalado ? escalado.motivo : 'Sin cambios'),
      motivo_escalamiento: escalado?.motivo ?? null, procesado_en: new Date().toISOString(),
    }).eq('id', tareaId);
    return { estado, acciones, resultado: resumen, escalado: escalado?.motivo ?? null };
  }

  async procesarPendientes(limite = 5) {
    const { data } = await this.db.from('agente_tareas').select('id').eq('estado', 'pendiente').order('creado_en').limit(Math.min(limite, 20));
    const resultados: any[] = [];
    for (const t of data ?? []) {
      try { resultados.push({ tareaId: t.id, ...(await this.ejecutar(t.id)) }); }
      catch (e: any) { resultados.push({ tareaId: t.id, estado: 'error', error: e.message }); }
    }
    return { procesadas: resultados.length, resultados };
  }

  // Barrido de mantenimiento: detecta productos con datos flojos y encola tareas para el agente.
  async barridoMantenimiento(limite = 10) {
    const { data, error } = await this.db
      .from('productos')
      .select('sku, nombre, descripcion, categoria_id')
      .eq('activo', true)
      .or('descripcion.is.null,categoria_id.is.null')
      .limit(Math.min(limite, 50));
    if (error) throw new BadRequestException(error.message);
    let encoladas = 0;
    for (const p of data ?? []) {
      const faltan = [!p.descripcion ? 'descripción' : null, !p.categoria_id ? 'categoría' : null].filter(Boolean).join(' y ');
      await this.encolar(
        `Mejorá el producto SKU ${p.sku} ("${p.nombre}"): completá ${faltan} con datos plausibles para un outlet de bebidas/almacén. Si no podés inferir la categoría con confianza, escalá.`,
        'mantenimiento', 'barrido',
      );
      encoladas += 1;
    }
    return { encoladas };
  }

  // Enriquecedor de catálogo a escala: completa datos faltantes de productos sin descripción.
  // Aplica solo lo de confianza VALIDADA alta; lo dudoso lo deja escalado para revisión humana.
  async enriquecer(opts: { limite?: number } = {}) {
    const limite = Math.min(opts.limite ?? 50, 200);
    const { data: prods, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, categoria_id')
      .eq('activo', true).is('descripcion', null).not('codigo_legacy', 'is', null)
      .limit(limite);
    if (error) throw new BadRequestException(error.message);
    if (!prods?.length) return { procesados: 0, aplicados: 0, escalados: 0, ejemplos: [] };

    let aplicados = 0, escalados = 0;
    const ejemplos: any[] = [];

    for (const grupo of chunk(prods, 8)) {
      let enr: any[] = [];
      try {
        const r = await this.claude.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 3500,
          messages: [{ role: 'user', content: `${PROMPT_ENRIQUECER}\n\nProductos:\n${JSON.stringify(grupo.map((p) => ({ sku: p.sku, nombre: p.nombre })))}` }],
        });
        const txt = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        enr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
      } catch {
        continue; // si un lote falla, seguimos con el resto
      }
      const porSku = new Map(enr.map((e: any) => [e.sku, e]));

      for (const p of grupo) {
        const e: any = porSku.get(p.sku);
        if (!e) continue;
        const v = validarEnriquecimiento(p.nombre, e);

        if (v.score >= 0.7) {
          const cambios: any = { descripcion: e.descripcion };
          // volumen SOLO si no es un producto por peso (gramos/kilos)
          if (!esPorPeso(p.nombre)) {
            if (v.volumenParseado != null) cambios.volumen_ml = v.volumenParseado;
            else if (Number(e.volumen_ml) >= 50 && Number(e.volumen_ml) <= 5000) cambios.volumen_ml = Math.round(Number(e.volumen_ml));
          }
          if (e.graduacion != null && Number(e.graduacion) >= 0 && Number(e.graduacion) <= 60) cambios.graduacion = Number(e.graduacion);
          if (!p.categoria_id && e.categoria) { const cid = await this.categoriaId(e.categoria); if (cid) cambios.categoria_id = cid; }
          if (e.marca && v.marcaOk) { const mid = await this.marcaId(e.marca); if (mid) cambios.marca_id = mid; }
          await this.db.from('productos').update(cambios).eq('id', p.id);
          aplicados += 1;
          if (ejemplos.length < 6) ejemplos.push({ sku: p.sku, antes: p.nombre, marca: cambios.marca_id ? e.marca : null, volumen_ml: cambios.volumen_ml ?? null, descripcion: e.descripcion, score: v.score, estado: 'aplicado' });
        } else {
          await this.db.from('agente_tareas').insert({
            descripcion: `Revisar enriquecimiento de ${p.sku} ("${p.nombre}") — confianza ${v.score}. ${v.motivos.join('; ')}`,
            tipo: 'enriquecimiento', origen: 'enriquecer', estado: 'escalada',
            confianza: v.score, motivo_escalamiento: v.motivos.join('; '), resultado: JSON.stringify(e),
          });
          escalados += 1;
          if (ejemplos.length < 6) ejemplos.push({ sku: p.sku, antes: p.nombre, score: v.score, estado: 'escalado', motivos: v.motivos });
        }
      }
    }
    return { procesados: prods.length, aplicados, escalados, ejemplos };
  }

  private async categoriaId(nombre: string): Promise<string | null> {
    const { data } = await this.db.from('categorias').select('id,nombre');
    return (data || []).find((c: any) => norm(c.nombre) === norm(nombre))?.id ?? null;
  }

  private async marcaId(nombre: string): Promise<string | null> {
    const n = (nombre || '').trim();
    if (n.length < 2) return null;
    const { data } = await this.db.from('marcas').select('id').ilike('nombre', n).maybeSingle();
    if (data) return data.id;
    const { data: ins, error } = await this.db.from('marcas').insert({ nombre: n }).select('id').single();
    return error ? null : ins.id;
  }

  // ---------- lecturas para el panel ----------
  async tareas(estado?: string) {
    let q = this.db.from('agente_tareas').select('*').order('creado_en', { ascending: false }).limit(100);
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async auditoria(tareaId: number) {
    const { data } = await this.db.from('agente_auditoria').select('*').eq('tarea_id', tareaId).order('creado_en');
    return data ?? [];
  }

  async resumen() {
    const { data } = await this.db.from('agente_tareas').select('estado');
    const por = (e: string) => (data ?? []).filter((t: any) => t.estado === e).length;
    return {
      pendientes: por('pendiente'), procesando: por('procesando'),
      completadas: por('completada'), escaladas: por('escalada'), errores: por('error'),
      total: (data ?? []).length,
    };
  }

  async resolver(tareaId: number, usuarioId?: string) {
    const { error } = await this.db.from('agente_tareas').update({ estado: 'completada', resuelta_por: usuarioId ?? null, procesado_en: new Date().toISOString() }).eq('id', tareaId).eq('estado', 'escalada');
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}

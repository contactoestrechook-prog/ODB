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

  // Fotos de productos por código de barra: busca en Open Food Facts (base
  // pública y gratuita, foto subida por la comunidad para identificar el
  // producto) y sube la que encuentra al storage 'productos' como {sku}.jpg.
  // Como esas fotos son de calidad muy variable (sacadas con el celular en la
  // calle, torcidas, con gente de fondo), cada una pasa un control de calidad
  // con Claude Vision ANTES de subirse: para un catálogo premium, solo entra
  // si el producto se ve claro, centrado y sin gente/manos de fondo. Prioriza
  // los productos con más stock. No reintenta un producto sin resultado antes
  // de 30 días (para no golpear la API en vano).
  async buscarFotos(opts: { limite?: number } = {}) {
    const limite = Math.min(opts.limite ?? 60, 300);
    const { data: candidatos, error } = await this.db.rpc('candidatos_fotos', { p_limite: limite });
    if (error) throw new BadRequestException(error.message);
    if (!candidatos?.length) return { procesados: 0, subidos: 0, rechazadas_calidad: 0, sin_resultado: 0, ejemplos: [] };

    let subidos = 0;
    let rechazadasCalidad = 0;
    let sinResultado = 0;
    const ejemplos: any[] = [];

    for (const c of candidatos as { producto_id: string; sku: string; nombre: string; eans: string[] }[]) {
      let encontrado = false;
      let motivoRechazo = '';
      for (const eanCrudo of c.eans ?? []) {
        const ean = eanCrudo.replace(/\D/g, '');
        if (ean.length < 8) continue;
        try {
          const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json`, {
            headers: { 'User-Agent': 'ODB-CatalogoFotos/1.0 (contacto@odb.com.ar)' },
          });
          if (r.ok) {
            const d: any = await r.json();
            const url = d?.status === 1 ? d?.product?.image_front_url : null;
            if (url) {
              const img = await fetch(url);
              if (img.ok) {
                const buffer = Buffer.from(await img.arrayBuffer());
                const mediaType = img.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/jpeg';
                const calidad = await this.evaluarFotoProducto(buffer, mediaType, c.nombre);
                if (calidad.apta) {
                  const { error: upErr } = await this.db.storage
                    .from('productos')
                    .upload(`${c.sku}.jpg`, buffer, { contentType: 'image/jpeg', upsert: true });
                  if (!upErr) {
                    encontrado = true;
                    subidos += 1;
                    if (ejemplos.length < 8) ejemplos.push({ sku: c.sku, estado: 'subida' });
                  }
                } else {
                  motivoRechazo = calidad.motivo;
                }
              }
            }
          }
        } catch {
          // probamos el siguiente EAN del mismo producto
        }
        if (encontrado) break;
        await new Promise((res) => setTimeout(res, 200)); // ritmo respetuoso con la API pública
      }
      if (!encontrado) {
        if (motivoRechazo) {
          rechazadasCalidad += 1;
          if (ejemplos.length < 8) ejemplos.push({ sku: c.sku, estado: 'rechazada_calidad', motivo: motivoRechazo });
        } else {
          sinResultado += 1;
          if (ejemplos.length < 8) ejemplos.push({ sku: c.sku, estado: 'sin_resultado' });
        }
      }
      await this.db.from('fotos_intentos').upsert({ producto_id: c.producto_id, encontrado, intentado_en: new Date().toISOString() });
    }

    return { procesados: candidatos.length, subidos, rechazadas_calidad: rechazadasCalidad, sin_resultado: sinResultado, ejemplos };
  }

  // Importación masiva de fotos que manda un proveedor (pack de su catálogo).
  // Cada archivo puede venir nombrado con el SKU, el EAN o el código propio
  // del proveedor para ese producto — se intenta matchear por los tres, en
  // ese orden. Pasa por el mismo control de calidad que buscarFotos (por si
  // el proveedor mandó una foto de mala calidad o un archivo equivocado).
  async importarFotosProveedor(archivos: Express.Multer.File[], proveedorId?: string) {
    if (!archivos?.length) throw new BadRequestException('No se recibió ningún archivo');

    const productos = await this.paginado('productos', 'id, sku, nombre', (q) => q.eq('activo', true));
    const porSku = new Map(productos.map((p: any) => [norm(p.sku), p]));
    const idPorId = new Map(productos.map((p: any) => [p.id, p]));

    const barras = await this.paginado('codigos_barras', 'codigo, producto_id');
    const porEan = new Map(barras.map((b: any) => [b.codigo.replace(/\D/g, ''), b.producto_id]));

    let porCodigoProveedor = new Map<string, string>();
    if (proveedorId) {
      const pp = await this.paginado('proveedor_productos', 'codigo_proveedor, producto_id', (q) => q.eq('proveedor_id', proveedorId));
      porCodigoProveedor = new Map(pp.map((r: any) => [norm(r.codigo_proveedor), r.producto_id]));
    }

    let subidos = 0;
    let rechazadasCalidad = 0;
    let sinCoincidencia = 0;
    const detalle: any[] = [];

    for (const archivo of archivos) {
      const nombreBase = archivo.originalname.replace(/\.[^.]+$/, '');
      const clave = norm(nombreBase);
      const soloDigitos = nombreBase.replace(/\D/g, '');

      let producto: any = porSku.get(clave);
      if (!producto && soloDigitos.length >= 8 && porEan.has(soloDigitos)) producto = idPorId.get(porEan.get(soloDigitos)!);
      if (!producto && porCodigoProveedor.has(clave)) producto = idPorId.get(porCodigoProveedor.get(clave)!);

      if (!producto) {
        sinCoincidencia += 1;
        detalle.push({ archivo: archivo.originalname, estado: 'sin_coincidencia' });
        continue;
      }

      const mediaType = archivo.mimetype === 'image/png' ? 'image/png' : 'image/jpeg';
      const calidad = await this.evaluarFotoProducto(archivo.buffer, mediaType, producto.nombre);
      if (!calidad.apta) {
        rechazadasCalidad += 1;
        detalle.push({ archivo: archivo.originalname, estado: 'rechazada_calidad', sku: producto.sku, motivo: calidad.motivo });
        continue;
      }

      const { error: upErr } = await this.db.storage.from('productos').upload(`${producto.sku}.jpg`, archivo.buffer, { contentType: 'image/jpeg', upsert: true });
      if (upErr) {
        detalle.push({ archivo: archivo.originalname, estado: 'error_subida', sku: producto.sku, motivo: upErr.message });
        continue;
      }
      subidos += 1;
      await this.db.from('fotos_intentos').upsert({ producto_id: producto.id, encontrado: true, intentado_en: new Date().toISOString() });
      detalle.push({ archivo: archivo.originalname, estado: 'subida', sku: producto.sku });
    }

    return { procesados: archivos.length, subidos, rechazadas_calidad: rechazadasCalidad, sin_coincidencia: sinCoincidencia, detalle };
  }

  // Control de calidad por visión: rechaza fotos amateur (celular en la calle,
  // torcidas, con gente/manos de fondo) que no corresponden a un catálogo
  // premium, aunque muestren el producto correcto.
  private async evaluarFotoProducto(buffer: Buffer, mediaType: string, nombreProducto: string): Promise<{ apta: boolean; motivo: string }> {
    try {
      const r = await this.claude.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as any, data: buffer.toString('base64') } },
            {
              type: 'text',
              text: `Esta foto es candidata para el catálogo de O.D.B Premium Market (outlet de bebidas y almacén de nivel PREMIUM), del producto "${nombreProducto}". Sos muy exigente: la mayoría de las fotos que te van a llegar son sacadas por usuarios con el celular y hay que rechazar casi todas. ANTE LA DUDA, RECHAZÁ.

RECHAZAR si pasa CUALQUIERA de estas cosas (revisá cada una con cuidado, incluso si es sutil o de fondo):
- La imagen NO corresponde al producto indicado (otra marca, otro tipo de bebida/producto, o cualquier cosa distinta a "${nombreProducto}") — esto puede pasar porque un archivo vino mal nombrado o mal vinculado, así que compará con atención antes de aceptar.
- Se ve una persona, una mano, un brazo o cualquier parte del cuerpo, aunque sea borrosa o parcial.
- El fondo deja ver que la foto fue tomada en la CALLE, en una CASA (ventana, cortina, mesada, piso de living, mueble) o en un auto — cualquier indicio de un ambiente doméstico o urbano identificable.
- La foto está tomada en ángulo, torcida o inclinada (el envase no está vertical).
- Hay reflejos de luz fuertes, brillos que tapan la etiqueta, o está fuera de foco / borrosa.
- Falta una parte importante del envase (se corta la tapa, el pico, la base, o gran parte de la etiqueta).
- Es un ticket, una factura, un cartel de oferta, o cualquier imagen que no sea el producto en sí.

ACEPTAR únicamente si: el envase está derecho y centrado, se ve completo, con buena iluminación uniforme, y el fondo es LISO (blanco/gris/color de estudio) o es claramente una góndola de supermercado bien iluminada sin elementos de una casa o la calle visibles.

Respondé SOLO un JSON: {"apta": true o false, "motivo": "razón concreta en 5 palabras"}`,
            },
          ],
        }],
      });
      const texto = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      return { apta: json.apta === true, motivo: json.motivo ?? 'rechazada' };
    } catch {
      // ante cualquier falla del control de calidad, no arriesgamos: no se sube
      return { apta: false, motivo: 'error evaluando calidad' };
    }
  }

  // Supabase corta cada select en 1000 filas por defecto: para volcar tablas
  // completas (productos, codigos_barras) hay que pedir por rangos.
  private async paginado(tabla: string, select: string, filtro?: (q: any) => any): Promise<any[]> {
    const filas: any[] = [];
    let desde = 0;
    const TAMANO = 1000;
    while (true) {
      let q = this.db.from(tabla).select(select).range(desde, desde + TAMANO - 1);
      if (filtro) q = filtro(q);
      const { data, error } = await q;
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data ?? []));
      if (!data || data.length < TAMANO) break;
      desde += TAMANO;
    }
    return filas;
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

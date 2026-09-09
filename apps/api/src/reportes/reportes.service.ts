import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { enviarTextoWhatsapp } from '../comun/whatsapp';

// "Esto está mal" (2026-09-09): cualquier persona del equipo reporta desde la
// pantalla donde está, con el contexto adjunto solo. La IA clasifica en el acto:
//   dato    → se resuelve en la pantalla (aclaraciones, corrección): se le explica cómo
//   sistema → es un bug o un cambio: le llega a Leandro como tarea (campanita + WhatsApp)
//   duda    → es una pregunta de uso: se responde
// Al resolverse un reporte de sistema, quien lo mandó recibe el aviso en su campanita.
export type CrearReporteDto = {
  mensaje: string;
  pantalla?: string;
  url?: string;
  contexto?: Record<string, unknown>;
};

// Esta clasificación decide si algo es un error del sistema o un dato mal cargado:
// va con el modelo más capaz y razonamiento adaptativo (pedido de Leandro).
const MODELO = process.env.REPORTES_MODELO || 'claude-opus-4-8';

@Injectable()
export class ReportesService {
  private readonly log = new Logger(ReportesService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async crear(dto: CrearReporteDto, usuarioId?: string) {
    const mensaje = String(dto.mensaje ?? '').trim().slice(0, 2000);
    if (mensaje.length < 3) throw new BadRequestException('Contanos qué está mal');
    const contexto = { ...(dto.contexto ?? {}) };
    if (typeof contexto.texto === 'string') contexto.texto = (contexto.texto as string).slice(0, 4000);
    const { data: fila, error } = await this.db
      .from('reportes_sistema')
      .insert({ usuario_id: usuarioId ?? null, pantalla: dto.pantalla ?? null, url: dto.url ?? null, mensaje, contexto })
      .select('id')
      .single();
    if (error || !fila) throw new BadRequestException(`No se pudo guardar el reporte: ${error?.message ?? 'sin datos'}`);

    const { data: quien } = usuarioId
      ? await this.db.from('usuarios').select('nombre, rol').eq('id', usuarioId).maybeSingle()
      : { data: null as any };
    const clasif = await this.clasificar(mensaje, dto.pantalla ?? '', contexto, quien?.rol ?? null);
    await this.db.from('reportes_sistema')
      .update({ tipo: clasif.tipo, clasificacion: clasif, respuesta_ia: clasif.respuesta_usuario, estado: clasif.tipo === 'sistema' ? 'nuevo' : 'resuelto', resuelto_en: clasif.tipo === 'sistema' ? null : new Date().toISOString() })
      .eq('id', fila.id);

    if (clasif.tipo === 'sistema') await this.avisarSistema(fila.id, mensaje, dto.pantalla ?? '', quien?.nombre ?? 'Alguien del equipo', clasif);
    this.log.log(`reporte ${fila.id.slice(0, 8)} (${clasif.tipo}) de ${quien?.nombre ?? usuarioId} en ${dto.pantalla ?? '?'}`);
    return { id: fila.id, tipo: clasif.tipo, respuesta: clasif.respuesta_usuario, resumen: clasif.resumen };
  }

  private async clasificar(mensaje: string, pantalla: string, contexto: Record<string, unknown>, rol: string | null) {
    const porDefecto = {
      tipo: 'sistema' as const,
      resumen: mensaje.slice(0, 200),
      pasos: [] as string[],
      respuesta_usuario: 'Lo anotamos y le llega a Leandro para arreglarlo. Cuando esté resuelto te avisamos por la campanita.',
    };
    if (!process.env.ANTHROPIC_API_KEY) return porDefecto;
    try {
      const claude = new Anthropic();
      const system = `Sos el asistente técnico interno de ODB (O.D.B Premium Market, supermercado premium de Canning). Una persona del equipo tocó "Esto está mal" en una pantalla del sistema y escribió qué esperaba. Tenés el texto visible de la pantalla y su mensaje. Clasificá en UNO de tres tipos:
- "dato": el sistema funciona, pero un dato quedó mal (una factura leída con un número equivocado, un producto mal vinculado, un precio a corregir). La persona lo puede resolver en la misma pantalla: en Entrada por foto escribe la aclaración en "Aclaraciones para la IA" y toca "Volver a leer con mis aclaraciones"; en productos edita la ficha; en costos usa Mesa de compras.
- "sistema": es un error o una falta del sistema (algo que se calcula mal, se rompe, no aparece, o un cambio que hay que programar). Lo arregla el programador.
- "duda": es una pregunta de cómo se usa algo.
Respondé SOLO un JSON: {"tipo":"dato|sistema|duda","resumen":"una línea técnica y concreta para el programador, en rioplatense","pasos":["pasos concretos para reproducir o para que la persona lo resuelva"],"respuesta_usuario":"lo que le decís a la persona: cálido, rioplatense, máximo 3 oraciones, sin emojis; si es dato, decile exactamente qué tocar; si es sistema, decile que le llega a Leandro y que le avisamos por la campanita al resolverlo"}`;
      const r = await claude.messages.create({
        model: MODELO, max_tokens: 2000, system,
        thinking: { type: 'adaptive' } as any,
        output_config: { effort: 'high' } as any,
        messages: [{ role: 'user', content: `Pantalla: ${pantalla}\nRol de quien reporta: ${rol ?? '?'}\nMensaje: ${mensaje}\n\nTexto visible de la pantalla (recortado):\n${String(contexto.texto ?? '').slice(0, 3500)}` }],
      });
      const texto = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      const m = texto.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : null;
      if (!j || !['dato', 'sistema', 'duda'].includes(j.tipo)) return porDefecto;
      return {
        tipo: j.tipo as 'dato' | 'sistema' | 'duda',
        resumen: String(j.resumen ?? '').slice(0, 400),
        pasos: Array.isArray(j.pasos) ? j.pasos.slice(0, 8).map((x: any) => String(x).slice(0, 200)) : [],
        respuesta_usuario: String(j.respuesta_usuario ?? porDefecto.respuesta_usuario).slice(0, 600),
      };
    } catch (e) {
      this.log.warn(`clasificación del reporte falló: ${e instanceof Error ? e.message : e}`);
      return porDefecto;
    }
  }

  // Los de sistema son tarea del programador: campanita a los dueños + WhatsApp a Leandro.
  private async avisarSistema(id: string, mensaje: string, pantalla: string, quien: string, clasif: any) {
    const titulo = `"Esto está mal" en ${pantalla || 'el panel'}: ${clasif.resumen || mensaje.slice(0, 80)}`;
    const detalle = `${quien} reportó: «${mensaje.slice(0, 300)}». ${clasif.pasos?.length ? 'Pasos: ' + clasif.pasos.join(' · ') : ''}`;
    const { data: duenos } = await this.db.from('usuarios').select('id, nombre, telefono').eq('rol', 'dueno').eq('activo', true);
    for (const u of (duenos ?? []) as any[]) {
      await this.db.from('alertas_internas').insert({ para_usuario: u.id, tipo: 'reporte', titulo, detalle, referencia: { reporte_id: id, link: '/reportes' } });
    }
    const tel = process.env.REPORTES_WHATSAPP || ((duenos ?? []) as any[]).find((u) => /leandro/i.test(u.nombre))?.telefono;
    if (tel) {
      const link = `${(process.env.ADMIN_URL ?? 'https://odb-admin-production.up.railway.app').replace(/\/$/, '')}/reportes`;
      await enviarTextoWhatsapp(this.db, tel, `ODB · Reporte del equipo (${pantalla || 'panel'})\n${quien}: «${mensaje.slice(0, 400)}»\nIA: ${clasif.resumen}\n${link}`, 'reporte').catch(() => null);
    }
  }

  async listar(estado?: string) {
    let q = this.db.from('reportes_sistema')
      .select('id, pantalla, url, mensaje, tipo, clasificacion, respuesta_ia, estado, creado_en, resuelto_en, respuesta, contexto, autor:usuarios!reportes_sistema_usuario_id_fkey(nombre, rol), resolvio:usuarios!reportes_sistema_resuelto_por_fkey(nombre)')
      .order('creado_en', { ascending: false }).limit(200);
    if (estado === 'pendientes') q = q.in('estado', ['nuevo', 'en_curso']);
    else if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async resolver(id: string, usuarioId: string, respuesta: string, estado: 'resuelto' | 'descartado' | 'en_curso' = 'resuelto') {
    const { data: r } = await this.db.from('reportes_sistema').select('id, usuario_id, mensaje, pantalla').eq('id', id).maybeSingle();
    if (!r) throw new BadRequestException('Reporte inexistente');
    const ahora = new Date().toISOString();
    const { error } = await this.db.from('reportes_sistema')
      .update({ estado, respuesta: respuesta?.trim() || null, resuelto_por: usuarioId, resuelto_en: estado === 'en_curso' ? null : ahora })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    if (r.usuario_id && estado !== 'en_curso') {
      await this.db.from('alertas_internas').insert({
        para_usuario: r.usuario_id, tipo: 'reporte',
        titulo: estado === 'resuelto' ? `Lo que reportaste en ${r.pantalla || 'el panel'} quedó arreglado` : `Tu reporte en ${r.pantalla || 'el panel'} no se va a cambiar`,
        detalle: `«${String(r.mensaje).slice(0, 160)}» — ${respuesta?.trim() || (estado === 'resuelto' ? 'Ya está en el sistema.' : 'Sin cambios.')}`,
        referencia: { reporte_id: id },
      });
    }
    return { ok: true };
  }
}

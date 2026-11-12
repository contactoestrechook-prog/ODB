import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { esfuerzo, RAZONAMIENTO } from '../comun/modelos';
import { ReportesService } from '../reportes/reportes.service';
import { leerRespuesta, SIN_RESPUESTA, type RespuestaManual } from './respuesta';

// EL MANUAL QUE CONTESTA (Leandro, 10/11/2026: «necesito que el manual de uso
// odb esté siempre actualizado, que sea muy inteligente y si lo que están
// pidiendo no existe en el sistema que lo digan, que tienen que hablar con
// MetoGroup»).
//
// Siempre al día sin que nadie lo reescriba: cada pregunta se contesta con
//   - el manual escrito (apps/admin/app/manual/contenido.ts), tal como está publicado;
//   - las pantallas que tiene hoy el menú, y cuáles puede abrir quien pregunta;
//   - lo que se publicó en los últimos 60 días (mantenimiento_trabajos, que se
//     carga solo en cada publicación): si un cambio contradice al manual, manda el cambio.
// Si no está en ninguna de las tres cosas, no existe: lo dice y manda a MetoGroup.
//
// Va con Haiku 5.5, no con Opus (Leandro, 10/11/2026: «no opus para eso, algo
// más barato»): USD 0,10 / 0,50 por millón contra 4 / 20 de Opus 5.5. Para
// contestar con un texto que se le da alcanza; piensa igual (adaptive).
// MANUAL_MODELO / MANUAL_ESFUERZO cambian modelo y esfuerzo sin tocar código.
const MODELO = process.env.MANUAL_MODELO || 'claude-haiku-5-5';
const DIAS_CAMBIOS = 60;

export type PantallaManual = { href: string; nombre: string; grupo?: string; bajada?: string; puede: boolean };
export type PreguntaManual = {
  pregunta?: string;
  historial?: { pregunta: string; respuesta: string }[];
  manual?: string;
  secciones?: string[];
  pantallas?: PantallaManual[];
};

const INSTRUCCIONES = `Sos el manual del sistema de ODB (O.D.B Premium Market, supermercado premium con dos sucursales: Sant Thomas y Santa Inés). El sistema lo hizo y lo mantiene MetoGroup. Te pregunta alguien del equipo, casi siempre con un cliente o una tarea esperando.

Contestás SOLO con lo que está en tres fuentes: el MANUAL, las PANTALLAS del menú y los CAMBIOS RECIENTES. Si un cambio reciente contradice al manual, manda el cambio (el manual puede ir un paso atrás).

Reglas:
- No inventes pantallas, botones, campos ni pasos. Si no está en las fuentes, no existe.
- Si lo que piden no existe en el sistema: existe = "no", decilo claro en la primera oración («Eso hoy no está en el sistema») y terminá con «Para pedirlo, hablá con MetoGroup.». Si se puede resolver de otra forma con lo que sí hay, decilo en una oración.
- Si existe una parte: existe = "parcial", explicá qué sí se puede y qué no, y lo que falta es para hablar con MetoGroup.
- Si existe pero la persona no puede abrir esa pantalla (puede = no), decile qué rol lo hace (dueño, gerente, compras, depósito, caja, administración) y no la mandes ahí.
- Si es un error o algo que anda mal (no una duda de uso), decile que toque «Esto está mal» en esa pantalla.
- Castellano rioplatense, de vos, cálido y corto: la respuesta en 1 a 3 oraciones; los pasos, concretos, con los nombres reales de los botones y pantallas, máximo 6. Sin emojis.
- No hables de cómo está hecho el sistema por dentro (tablas, código, IA) ni des datos de negocio que no estén en las fuentes.

Respondé SOLO este JSON:
{"existe":"si|parcial|no","respuesta":"…","pasos":["…"],"pantalla":"el href exacto de la pantalla donde se hace, de la lista, o null","seccion":"el id exacto de la sección del manual que lo explica, o null"}`;

@Injectable()
export class ManualService {
  private readonly log = new Logger(ManualService.name);
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly reportes: ReportesService,
  ) {}

  // Lo que se publicó últimamente, para «Lo nuevo» y para el asistente.
  async novedades(dias = 30) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data, error } = await this.db
      .from('mantenimiento_trabajos')
      .select('hash, publicado_en, tipo, area, titulo, que_se_hizo')
      .gte('publicado_en', desde)
      .order('publicado_en', { ascending: false })
      .order('hash', { ascending: true })
      .limit(400);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async preguntar(b: PreguntaManual, rol: string | null): Promise<RespuestaManual> {
    const pregunta = String(b?.pregunta ?? '').trim().slice(0, 600);
    if (pregunta.length < 3) throw new BadRequestException('Escribí qué querés hacer');
    const manual = String(b?.manual ?? '').slice(0, 120_000);
    const pantallas = (Array.isArray(b?.pantallas) ? b.pantallas : []).slice(0, 200);
    const hrefs = new Set(pantallas.filter((p) => p?.puede).map((p) => String(p.href)));
    const secciones = new Set((Array.isArray(b?.secciones) ? b.secciones : []).map(String));
    if (!process.env.ANTHROPIC_API_KEY) return SIN_RESPUESTA;

    const cambios = await this.novedades(DIAS_CAMBIOS).catch(() => []);
    const fuentes =
      `MANUAL (secciones con su id entre corchetes):\n${manual}\n\n` +
      `CAMBIOS RECIENTES (lo último que se publicó, del más nuevo al más viejo):\n` +
      cambios.map((c: any) => `- ${String(c.publicado_en).slice(0, 10)} · ${c.area} · ${c.titulo}: ${c.que_se_hizo}`).join('\n');
    const menu =
      `QUIEN PREGUNTA tiene el rol: ${rol ?? 'sin dato'}.\n\nPANTALLAS DEL MENÚ (href · nombre · grupo · para qué · ¿la puede abrir?):\n` +
      pantallas.map((p) => `- ${p.href} · ${p.nombre} · ${p.grupo ?? ''} · ${p.bajada ?? ''} · ${p.puede ? 'sí' : 'no'}`).join('\n');
    const historial = (Array.isArray(b?.historial) ? b.historial : []).slice(-4).flatMap((h) => [
      { role: 'user' as const, content: String(h?.pregunta ?? '').slice(0, 600) || '…' },
      { role: 'assistant' as const, content: String(h?.respuesta ?? '').slice(0, 1500) || '…' },
    ]);

    try {
      const claude = new Anthropic();
      const r = await claude.messages.create({
        model: MODELO,
        max_tokens: 6000,
        // el manual y los cambios son iguales para todos hasta la próxima
        // publicación: van primero y en caché; el menú cambia según el rol
        system: [
          { type: 'text', text: INSTRUCCIONES },
          { type: 'text', text: fuentes, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: menu },
        ],
        thinking: RAZONAMIENTO,
        output_config: { effort: esfuerzo('MANUAL_ESFUERZO', 'low', { general: false }) },
        messages: [...historial, { role: 'user', content: pregunta }],
      } as any);
      if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return SIN_RESPUESTA;
      const texto = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      const respuesta = leerRespuesta(texto, hrefs, secciones);
      this.log.log(`pregunta (${rol ?? '?'}): «${pregunta.slice(0, 80)}» → ${respuesta.existe}`);
      return respuesta;
    } catch (e) {
      this.log.warn(`el manual no pudo contestar: ${e instanceof Error ? e.message : e}`);
      return SIN_RESPUESTA;
    }
  }

  // «Pedírselo a MetoGroup»: lo que no existe entra como pedido en Reportes del
  // equipo (campanita a los dueños y WhatsApp a Leandro, como «Esto está mal»).
  async pedir(b: { pregunta?: string; respuesta?: string }, usuarioId?: string) {
    const pregunta = String(b?.pregunta ?? '').trim().slice(0, 600);
    if (pregunta.length < 3) throw new BadRequestException('Falta qué se necesita');
    return this.reportes.pedidoDelManual(pregunta, String(b?.respuesta ?? '').slice(0, 1500), usuarioId);
  }
}

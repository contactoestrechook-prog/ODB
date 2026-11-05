import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { randomUUID } from 'node:crypto';
import { extensionAudio, transcribirAudio } from '../comun/transcribir';

// ============================================================
// NOTAS Y REIMPRESIONES DE UN TICKET (Leandro, 5/11/2026)
//
// «En caja necesitan en cada operación un espacio de notas en donde puedan
// anotar algo o enviar un audio explicando algo; también un botón de volver a
// imprimir el ticket por si falla la impresora.»
//
// La nota se escribe o se graba sobre una venta ya cobrada: no frena el cobro.
// El audio queda en el depósito privado «comprobantes» y, si hay clave de
// transcripción, también su texto. La reimpresión deja quién y cuándo; el
// ticket sale marcado «REIMPRESIÓN» desde el panel.
//
// Las tablas son de db/migracion-caja-notas-reimpresion.sql. Si todavía no
// está aplicada, leer devuelve listas vacías y guardar avisa claro: la caja
// nunca se cae por esto.
// ============================================================

export const NOTA_MAX_CARACTERES = 1000;
// 3 minutos de opus del navegador pesan ~1 MB; 6 MB deja aire para m4a del celular
export const AUDIO_MAX_BYTES = 6 * 1024 * 1024;
export const AUDIO_MAX_SEGUNDOS = 180;
const BUCKET = 'comprobantes';

export type NotaNueva = { texto?: string; audioBase64?: string; audioMime?: string; audioSegundos?: number };

// Valida y limpia lo que manda el panel. Devuelve lo que se guarda.
export function prepararNota(dto: NotaNueva | null | undefined): {
  texto: string | null;
  audio: { bin: Buffer; mime: string; segundos: number | null } | null;
} {
  const texto = String(dto?.texto ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '');
  if (texto.length > NOTA_MAX_CARACTERES) {
    throw new BadRequestException(`La nota es muy larga: hasta ${NOTA_MAX_CARACTERES} caracteres`);
  }
  let audio: { bin: Buffer; mime: string; segundos: number | null } | null = null;
  if (dto?.audioBase64) {
    const mime = String(dto.audioMime ?? '').split(';')[0].trim().toLowerCase();
    if (!/^audio\/[a-z0-9.+-]+$/.test(mime)) throw new BadRequestException('El archivo no es un audio');
    const bin = Buffer.from(String(dto.audioBase64).replace(/^data:[^,]*,/, ''), 'base64');
    if (bin.length < 200) throw new BadRequestException('El audio llegó vacío: grabalo de nuevo');
    if (bin.length > AUDIO_MAX_BYTES) throw new BadRequestException('El audio es muy largo: hasta 3 minutos');
    const s = Number(dto.audioSegundos);
    const segundos = Number.isFinite(s) && s > 0 ? Math.min(Math.round(s), AUDIO_MAX_SEGUNDOS) : null;
    audio = { bin, mime, segundos };
  }
  if (!texto && !audio) throw new BadRequestException('Escribí algo o grabá un audio');
  return { texto: texto || null, audio };
}

// ¿El error es porque la migración todavía no se aplicó?
export function faltaLaTabla(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '');
}

@Injectable()
export class NotasVentaService {
  private readonly log = new Logger(NotasVentaService.name);

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private async ventaDe(ventaId: string) {
    const { data, error } = await this.db.from('ventas').select('id, sesion_caja_id').eq('id', ventaId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Esa venta no existe');
    return data as { id: string; sesion_caja_id: string | null };
  }

  async listar(ventaId: string) {
    const { data, error } = await this.db
      .from('ventas_notas')
      .select('id, texto, audio_ruta, audio_mime, audio_segundos, transcripcion, creado_en, usuario:usuarios(nombre)')
      .eq('venta_id', ventaId)
      .order('creado_en', { ascending: true });
    if (error) {
      if (!faltaLaTabla(error)) this.log.warn(`notas de ${ventaId}: ${error.message}`);
      return [];
    }
    const notas = (data ?? []) as any[];
    // el audio se escucha con un enlace firmado de una hora (el depósito es privado)
    const rutas = notas.map((n) => n.audio_ruta).filter(Boolean) as string[];
    const firmas: Record<string, string> = {};
    if (rutas.length) {
      const { data: f } = await this.db.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      for (const x of f ?? []) if (x.path && x.signedUrl) firmas[x.path] = x.signedUrl;
    }
    return notas.map((n) => ({
      id: n.id,
      texto: n.texto ?? null,
      audioUrl: n.audio_ruta ? firmas[n.audio_ruta] ?? null : null,
      audioSegundos: n.audio_segundos ?? null,
      transcripcion: n.transcripcion ?? null,
      creadoEn: n.creado_en,
      usuario: n.usuario?.nombre ?? null,
    }));
  }

  async agregar(ventaId: string, dto: NotaNueva, usuarioId?: string) {
    const { texto, audio } = prepararNota(dto);
    const venta = await this.ventaDe(ventaId);
    const id = randomUUID();
    let audioRuta: string | null = null;
    let transcripcion: string | null = null;
    if (audio) {
      audioRuta = `caja-notas/${ventaId}/${id}.${extensionAudio(audio.mime)}`;
      const { error: eSubir } = await this.db.storage.from(BUCKET).upload(audioRuta, audio.bin, { contentType: audio.mime, upsert: false });
      if (eSubir) throw new BadRequestException(`No se pudo guardar el audio: ${eSubir.message}`);
      transcripcion = await transcribirAudio(audio.bin, audio.mime,
        'Nota de la caja de un almacén de bebidas en Argentina: ticket, cliente, vuelto, efectivo, Mercado Pago, posnet, Getnet, Clover, factura, devolución, cajón, botella, fernet, Malbec.');
    }
    const { error } = await this.db.from('ventas_notas').insert({
      id,
      venta_id: ventaId,
      sesion_caja_id: venta.sesion_caja_id,
      usuario_id: usuarioId ?? null,
      texto,
      audio_ruta: audioRuta,
      audio_mime: audio?.mime ?? null,
      audio_segundos: audio?.segundos ?? null,
      transcripcion,
    });
    if (error) {
      if (audioRuta) await this.db.storage.from(BUCKET).remove([audioRuta]).then(() => null, () => null);
      if (faltaLaTabla(error)) throw new BadRequestException('Las notas todavía no están habilitadas en la base');
      throw new BadRequestException(error.message);
    }
    return this.listar(ventaId);
  }

  // Cada vez que se vuelve a imprimir un ticket. Devuelve cuántas van.
  async reimpresion(ventaId: string, usuarioId?: string) {
    const venta = await this.ventaDe(ventaId);
    const { error } = await this.db.from('ventas_reimpresiones').insert({
      venta_id: ventaId,
      sesion_caja_id: venta.sesion_caja_id,
      usuario_id: usuarioId ?? null,
    });
    if (error) {
      if (faltaLaTabla(error)) throw new BadRequestException('Las reimpresiones todavía no se registran en la base');
      throw new BadRequestException(error.message);
    }
    const reimpresiones = await this.reimpresiones(ventaId);
    return { veces: reimpresiones.length, reimpresiones };
  }

  async reimpresiones(ventaId: string) {
    const { data, error } = await this.db
      .from('ventas_reimpresiones')
      .select('creado_en, usuario:usuarios(nombre)')
      .eq('venta_id', ventaId)
      .order('creado_en', { ascending: true });
    if (error) {
      if (!faltaLaTabla(error)) this.log.warn(`reimpresiones de ${ventaId}: ${error.message}`);
      return [];
    }
    return ((data ?? []) as any[]).map((r) => ({ creadoEn: r.creado_en, usuario: r.usuario?.nombre ?? null }));
  }

}

// Para la lista del turno: cuántas notas y reimpresiones tiene cada ticket.
// Función suelta para que la use CajaService sin depender del módulo de ventas.
// Sin la migración aplicada, todo da cero.
export async function contarNotasYReimpresiones(
  db: SupabaseClient,
  ventaIds: string[],
): Promise<Record<string, { notas: number; reimpresiones: number }>> {
  const r: Record<string, { notas: number; reimpresiones: number }> = {};
  if (!ventaIds.length) return r;
  const [notas, reimp] = await Promise.all([
    db.from('ventas_notas').select('venta_id').in('venta_id', ventaIds),
    db.from('ventas_reimpresiones').select('venta_id').in('venta_id', ventaIds),
  ]);
  for (const n of (notas.data ?? []) as any[]) (r[n.venta_id] ??= { notas: 0, reimpresiones: 0 }).notas++;
  for (const n of (reimp.data ?? []) as any[]) (r[n.venta_id] ??= { notas: 0, reimpresiones: 0 }).reimpresiones++;
  return r;
}

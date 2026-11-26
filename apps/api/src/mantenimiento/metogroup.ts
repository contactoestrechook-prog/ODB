import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// MANTENIMIENTO CON METOGROUP ADENTRO DE ODB (Leandro, 26/11/2026: «agregarle
// también el módulo de mantenimiento como tiene Car Cash, con un contexto agéntico
// totalmente inteligente con clave ODB…»).
//
// La charla con el agente es la pantalla de MetoGroup (la misma de Car Cash) en un
// marco. ODB solo:
//   · le firma el PASE a quien entra (HMAC con la clave compartida, 8 horas), con el
//     mismo formato que verifica MetoGroup: base64url(JSON) + '.' + hex(hmac);
//   · deja PUBLICADO el manual (temas y pantallas del menú) en manual_publicado, para
//     que el agente lo lea antes de decir que algo no existe.
// Quién puede cargar lo decide MetoGroup persona por persona (en ODB queda como el
// permiso 'mantenimiento' de usuarios.permisos).

export const EMPRESA = 'odb';
export const HORAS_PASE = 8;

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type DatosPase = { usuario: string; nombre: string; rol: string };

export function firmarPase(d: DatosPase, clave: string, ahoraSeg = Math.floor(Date.now() / 1000)): string {
  const cuerpo = b64u(JSON.stringify({ e: EMPRESA, u: d.usuario, n: d.nombre.slice(0, 120), r: d.rol.slice(0, 60), c: true, x: ahoraSeg + HORAS_PASE * 3600 }));
  return `${cuerpo}.${createHmac('sha256', clave).update(cuerpo).digest('hex')}`;
}

export type SeccionManual = { seccion: string; titulo: string; area: string; pantallas: string[]; texto: string };
export type PantallaManual = { href: string; nombre: string; grupo: string; bajada: string };
export type ManualPublicado = { version: string; secciones: SeccionManual[]; pantallas: PantallaManual[] };

const txt = (v: unknown, max: number) => String(v ?? '').slice(0, max);

/** Las filas de manual_publicado a partir de lo que manda el panel (limpias y con tope). */
export function filasDelManual(m: ManualPublicado): Record<string, unknown>[] | null {
  const version = txt(m?.version, 80).trim();
  if (!version || !Array.isArray(m?.secciones) || !Array.isArray(m?.pantallas)) return null;
  const secciones = m.secciones.slice(0, 400).filter((s) => s && txt(s.seccion, 80).trim());
  const pantallas = m.pantallas.slice(0, 300).filter((p) => p && txt(p.href, 200).startsWith('/'));
  if (!secciones.length || !pantallas.length) return null;
  const vistas = new Set<string>();
  const filas: Record<string, unknown>[] = [];
  secciones.forEach((s, i) => {
    const clave = `s:${txt(s.seccion, 80)}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    filas.push({
      clave, tipo: 'seccion', orden: i, seccion: txt(s.seccion, 80), titulo: txt(s.titulo, 200), area: txt(s.area, 80),
      pantallas: (Array.isArray(s.pantallas) ? s.pantallas : []).map((p) => txt(p, 200)).slice(0, 20), texto: txt(s.texto, 30_000), version,
    });
  });
  pantallas.forEach((p, i) => {
    const clave = `p:${txt(p.href, 200)}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    filas.push({ clave, tipo: 'pantalla', orden: i, href: txt(p.href, 200), nombre: txt(p.nombre, 120), grupo: txt(p.grupo, 120), bajada: txt(p.bajada, 400), version });
  });
  return filas;
}

/** Deja publicado el manual si cambió desde la última vez (una sola versión en la tabla). */
export async function publicarManual(db: SupabaseClient, m: ManualPublicado | undefined): Promise<'igual' | 'actualizado' | 'sin manual'> {
  const filas = m ? filasDelManual(m) : null;
  if (!filas) return 'sin manual';
  const version = String(filas[0].version);
  const { data: actual } = await db.from('manual_publicado').select('version').limit(1);
  if (actual?.[0]?.version === version) return 'igual';
  const { error: e1 } = await db.from('manual_publicado').upsert(filas, { onConflict: 'clave' });
  if (e1) throw new Error(e1.message);
  // lo que ya no está en el manual nuevo, se va
  await db.from('manual_publicado').delete().neq('version', version);
  return 'actualizado';
}

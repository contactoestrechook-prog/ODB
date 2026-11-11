// DE CUÁNDO ES EL DATO (11/11/2026). Los locales venden con otros sistemas, así
// que el stock de NÚCLEO es una foto: la de la última sincronización. Ese día,
// midiendo, apareció que el stock de Santa Inés era el de la apertura del 11/8
// (tres meses sin actualizar) y sus ventas, las de julio; y la pantalla le
// sugería a Saint Thomas traer 201 productos «que le sobran» a Santa Inés.
//
// Regla: el stock de un local sirve para decidir si el local vende con la caja
// de NÚCLEO (el stock baja solo) o si se sincronizó en los últimos días. Si no,
// se dice de cuándo es y no se sugiere pasar mercadería con ese dato.

import { SupabaseClient } from '@supabase/supabase-js';

/** Cuántos días puede tener la foto del stock para seguir decidiendo con ella. */
export const DIAS_STOCK_AL_DIA = 7;

export type Frescura = {
  sucursalId: string;
  /** como está en la base: «Suc Sant Thomas» */
  nombre: string;
  /** como se muestra: «Saint Thomas», «Santa Inés» */
  sucursal: string;
  /** el día de la última sincronización del stock (AAAA-MM-DD); null si nunca */
  stockAl: string | null;
  /** hasta qué día hay ventas cargadas (AAAA-MM-DD) */
  ventasHasta: string | null;
  diasStock: number | null;
  /** vende con la caja de NÚCLEO: el stock baja solo */
  enVivo: boolean;
  alDia: boolean;
  /** por qué no sirve, en una frase; null si está al día */
  motivo: string | null;
};

const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const corto = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

export const nombreDeLocal = (s: unknown) =>
  String(s ?? '').replace(/^Suc\s+/, '').replace(/^Sant Thomas/, 'Saint Thomas').replace(/^Santa Ines$/, 'Santa Inés');

export function frescuraDeLocal(l: { sucursalId: string; nombre?: string; sucursal: string; stockAl?: unknown; ventasHasta?: unknown; enVivo?: boolean }, hoy = new Date()): Frescura {
  const stockAl = dia(l.stockAl);
  const ventasHasta = dia(l.ventasHasta);
  const diasStock = stockAl ? Math.max(0, Math.floor((Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - Date.parse(`${stockAl}T00:00:00Z`)) / 86400_000)) : null;
  const enVivo = !!l.enVivo;
  const alDia = enVivo || (diasStock != null && diasStock <= DIAS_STOCK_AL_DIA);
  const motivo = alDia ? null : [
    stockAl ? `El stock de ${l.sucursal} no se actualiza desde el ${corto(stockAl)}` : `El stock de ${l.sucursal} nunca se cargó`,
    ventasHasta ? ` y sus ventas llegan hasta el ${corto(ventasHasta)}` : ' y no tiene ventas cargadas',
    ': con esos datos no se sabe qué le falta ni qué le sobra.',
  ].join('');
  return { sucursalId: l.sucursalId, nombre: l.nombre ?? l.sucursal, sucursal: l.sucursal, stockAl, ventasHasta, diasStock, enVivo, alDia, motivo };
}

/** Por qué no se sugieren traspasos; null si todos los locales están al día. */
export function frenoDeTraspasos(locales: Frescura[]): string | null {
  const viejos = locales.filter((l) => !l.alDia);
  if (!locales.length) return 'No pude confirmar de cuándo es el stock de cada local: no se sugieren traspasos.';
  return viejos.length ? viejos.map((l) => l.motivo).join(' ') : null;
}

// ---------- la lectura ----------

// Dos consultas chicas por local; se comparten un minuto, como la del motor.
let memo: { en: number; datos: Frescura[] } | null = null;

export async function leerFrescura(db: SupabaseClient): Promise<Frescura[]> {
  if (memo && Date.now() - memo.en < 60_000) return memo.datos;
  const { data: locales, error } = await db.from('sucursales').select('id, nombre, caja_modo_prueba').eq('activa', true);
  if (error) throw new Error(error.message);
  const datos = await Promise.all(((locales ?? []) as any[]).map(async (s) => {
    const [sync, ventas] = await Promise.all([
      // la foto del stock: la apertura o la última sincronización con el sistema del local
      db.from('movimientos_stock').select('creado_en').eq('sucursal_id', s.id).in('referencia_tipo', ['importacion', 'apertura'])
        .order('creado_en', { ascending: false }).limit(1).maybeSingle(),
      db.from('ventas_historicas').select('hasta').eq('sucursal_id', s.id).order('hasta', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return frescuraDeLocal({
      sucursalId: s.id, nombre: s.nombre, sucursal: nombreDeLocal(s.nombre),
      stockAl: (sync.data as any)?.creado_en, ventasHasta: (ventas.data as any)?.hasta,
      // con la caja en modo prueba el local todavía vende con su sistema: el stock no baja solo
      enVivo: s.caja_modo_prueba === false,
    });
  }));
  memo = { en: Date.now(), datos };
  return datos;
}

// Solo para las pruebas, y después de una sincronización.
export function olvidarFrescura() {
  memo = null;
}

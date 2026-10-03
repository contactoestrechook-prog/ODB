import { SupabaseClient } from '@supabase/supabase-js';
import { traerTodo } from '../comun/lotes';

// La lectura COMPARTIDA del motor de abastecimiento (función abastecimiento()
// de la base, db/migracion-abastecimiento.sql): todos los renglones producto ×
// sucursal, con o sin alerta.
//
// 2/10/2026: el Analista ODB calculaba el ritmo por su cuenta, solo con las
// ventas de la caja de ODB (casi vacía: el local vende con el sistema viejo), y
// le dijo al dueño "esta semana no hay nada que comprar" cuando había cientos
// de productos sin stock. Ahora el Analista, el informe de las 7, Promociones y
// Estadísticas leen de acá: una sola fuente de números.
//
// La memo va a nivel de módulo, no de instancia: AnalistaService se crea suelto
// en varios módulos (Informes, Promociones, Estadísticas) y cada uno tendría la
// suya. Una lectura completa son ~9 páginas de ~300 ms.

const TOPE = 20_000; // el tope interno de la función: si llegan tantas, se cortó
const MEMO_MS = 60_000;

let memo: { en: number; filas: any[] } | null = null;
let enVuelo: Promise<any[]> | null = null;
let generacion = 0; // sube al invalidar: una lectura empezada antes no se guarda ni se reparte

export async function leerAbastecimiento(db: SupabaseClient): Promise<any[]> {
  if (memo && Date.now() - memo.en < MEMO_MS) return memo.filas;
  if (enVuelo) return enVuelo;
  const gen = generacion;
  const args = { p_sucursal: null, p_solo_alertas: false, p_proveedor: null, p_q: null, p_limite: TOPE };
  enVuelo = (async () => {
    // PostgREST corta las funciones en 1.000 filas sin avisar: de a páginas
    const filas = await traerTodo<any>((desde, hasta) => db.rpc('abastecimiento', args).range(desde, hasta) as any);
    if (filas.length >= TOPE) {
      throw new Error(`El motor de abastecimiento devolvió ${filas.length} renglones (su tope): faltan datos, no se puede analizar a medias`);
    }
    if (gen === generacion) memo = { en: Date.now(), filas };
    return filas;
  })();
  const esta = enVuelo;
  try {
    return await esta;
  } finally {
    if (enVuelo === esta) enVuelo = null;
  }
}

// El costo del catálogo (productos.costo), para valorizar lo que el motor no
// trae con último costo de compra. Misma memo.
let memoCostos: { en: number; costos: Map<string, number> } | null = null;

export async function leerCostos(db: SupabaseClient): Promise<Map<string, number>> {
  if (memoCostos && Date.now() - memoCostos.en < MEMO_MS) return memoCostos.costos;
  const filas = await traerTodo<any>((desde, hasta) =>
    db.from('productos').select('id, costo').eq('activo', true).gt('costo', 0).range(desde, hasta) as any);
  const costos = new Map<string, number>(filas.map((p: any) => [p.id, Number(p.costo)]));
  memoCostos = { en: Date.now(), costos };
  return costos;
}

// Después de crear o recibir una orden (cambia lo que está en camino, y con eso
// la cobertura, la alerta y el sugerido): la próxima lectura va a la base.
export function invalidarAbastecimiento() {
  memo = null;
  enVuelo = null;
  generacion++;
}

// Solo para las pruebas.
export function olvidarLecturas() {
  memo = null;
  memoCostos = null;
  enVuelo = null;
}

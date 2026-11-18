// ============================================================
// DUDAS QUE NO HACE FALTA PREGUNTAR (18/11/2026).
//
// Suma del Plata, factura 0001-00007397: el lector preguntó «El CUIT del emisor
// está parcialmente ilegible (30 71... 66). ¿Cuál es el CUIT completo?». El
// proveedor ya estaba reconocido por el nombre y su CUIT (30-71632916-6) está
// en la ficha. Ana lo escribió igual en el chat y el chat le contestó que no
// tenía dónde ponerlo.
//
// Regla: si el proveedor se reconoció y su ficha tiene un CUIT válido, una duda
// sobre el CUIT del EMISOR no se muestra. Las del CUIT del cliente o receptor,
// y todas las demás, quedan como vienen.
//
// Función pura; se prueba en dudas-de-mas.spec.ts.
// ============================================================

export type Duda = { pregunta?: string | null; referencia?: string | null };

const plano = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿La duda pregunta por el CUIT de quien emite el comprobante? */
export function preguntaPorElCuitDelEmisor(d: Duda): boolean {
  const pregunta = plano(d?.pregunta);
  const referencia = plano(d?.referencia);
  if (!/\bcuit\b/.test(pregunta)) return false;
  // el del cliente no es este tema
  if (/\b(cliente|receptor|comprador|destinatario)\b/.test(`${pregunta} ${referencia}`)) return false;
  // una duda que además pregunta QUIÉN es el proveedor no se saca por acá: esa se
  // contesta sola cuando el proveedor está reconocido, pero la decide otro control
  const delEmisor = /\b(emisor|proveedor|vendedor|razon social)\b/.test(`${pregunta} ${referencia}`);
  // habla solo del CUIT (ilegible, cortado, no figura), no de otra cosa del comprobante
  const soloElCuit = !/\b(iva|discrimina|precios?|importes?|cantidad(es)?|total|remito|presupuesto)\b|cual es el proveedor|quien es/.test(pregunta);
  return delEmisor && soloElCuit;
}

/** Las dudas de la lectura, sin las que ya tienen respuesta en el sistema. */
export function sinDudasDeMas<T extends Duda>(dudas: T[], ctx: { proveedorConCuit: boolean }): T[] {
  if (!ctx?.proveedorConCuit) return dudas ?? [];
  return (dudas ?? []).filter((d) => !preguntaPorElCuitDelEmisor(d));
}

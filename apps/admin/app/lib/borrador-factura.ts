// ============================================================
// LA FACTURA A MEDIO CARGAR SE GUARDA SOLA (3/11/2026). Leandro: «no tomó los
// cambios viejos; cuando modificamos algo hay que hacer todo otra vez». Lo que
// se corregía en la pantalla de carga vivía solo en el navegador.
//
// Se guarda SOLO lo que cambió la persona: renglón por renglón, los campos que
// difieren de lo que leyó el sistema, y lo que cambió del pie. Al abrir, la
// lectura se interpreta con las reglas de HOY (si el sistema mejoró, se nota) y
// encima van esos cambios. Un renglón guardado se aplica solo si sigue siendo
// el mismo (misma descripción): si la factura se volvió a leer distinta, ese
// cambio se descarta en vez de caer en otro producto.
//
// Funciones puras; se prueban en apps/api/src/compras/borrador-factura.spec.ts.
// ============================================================

export type CambioDeRenglon = { renglon: number; descripcion: string; campos: Record<string, unknown> };
/**
 * `agregados` (13/11/2026): los renglones que se agregaron en la pantalla (a
 * mano o con el chat). No están en lo que leyó el sistema, así que se guardan
 * enteros; van siempre después de los leídos.
 */
export type BorradorFactura = { renglones: CambioDeRenglon[]; pie: Record<string, unknown>; cambios: unknown[]; agregados?: Record<string, unknown>[] };

// lo que arma el sistema y no decide la persona
const NO_SE_GUARDA = new Set(['interpretado', '_lectura']);

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function camposCambiados(original: Record<string, any>, actual: Record<string, any>): Record<string, unknown> {
  const campos: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(original ?? {}), ...Object.keys(actual ?? {})])) {
    if (NO_SE_GUARDA.has(k) || k.startsWith('_')) continue;
    if (!igual(original?.[k], actual?.[k])) campos[k] = actual?.[k] ?? null;
  }
  return campos;
}

/** Lo que cambió la persona, contra lo que leyó el sistema. */
export function borradorDe(
  original: Record<string, any>[],
  actual: Record<string, any>[],
  pieOriginal: Record<string, any>,
  pieActual: Record<string, any>,
  cambios: unknown[] = [],
): BorradorFactura {
  const renglones: CambioDeRenglon[] = [];
  const agregados: Record<string, unknown>[] = [];
  actual.forEach((fila, k) => {
    const o = original[k];
    if (!o) {
      // un renglón agregado en la pantalla: entero, sin lo que arma el sistema
      if (fila?.agregado) agregados.push(Object.fromEntries(Object.entries(fila).filter(([c]) => !NO_SE_GUARDA.has(c) && !c.startsWith('_'))));
      return;
    }
    const campos = camposCambiados(o, fila);
    if (Object.keys(campos).length) renglones.push({ renglon: k, descripcion: String(o.descripcion ?? ''), campos });
  });
  return { renglones, pie: camposCambiados(pieOriginal ?? {}, pieActual ?? {}), cambios: cambios ?? [], ...(agregados.length ? { agregados } : {}) };
}

export function borradorVacio(b: BorradorFactura | null | undefined): boolean {
  return !b || (!b.renglones?.length && !Object.keys(b.pie ?? {}).length && !(b.cambios ?? []).length && !(b.agregados ?? []).length);
}

/** Pone lo guardado encima de la lectura de hoy. */
export function aplicarBorrador<T extends Record<string, any>>(
  filas: T[],
  pie: Record<string, any>,
  b: Partial<BorradorFactura> | null | undefined,
): { filas: T[]; pie: Record<string, any>; aplicados: number; descartados: number } {
  const nuevas = filas.slice();
  let aplicados = 0;
  let descartados = 0;
  for (const r of b?.renglones ?? []) {
    const f = nuevas[r?.renglon];
    if (!f || String(f.descripcion ?? '') !== String(r.descripcion ?? '') || !r.campos || typeof r.campos !== 'object') { descartados++; continue; }
    nuevas[r.renglon] = { ...f, ...r.campos };
    aplicados++;
  }
  // los agregados en la pantalla vuelven al final, como estaban
  for (const a of Array.isArray(b?.agregados) ? b!.agregados : []) {
    if (!a || typeof a !== 'object' || !(a as any).agregado) { descartados++; continue; }
    nuevas.push(a as T);
    aplicados++;
  }
  const delPie = b?.pie && typeof b.pie === 'object' ? b.pie : {};
  return { filas: nuevas, pie: { ...pie, ...delPie }, aplicados: aplicados + Object.keys(delPie).length, descartados };
}

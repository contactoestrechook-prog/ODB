// ============================================================
// IVA DE UNA FACTURA DE COMPRA, RENGLÓN POR RENGLÓN (2026-09-15)
//
// Regla de la casa (Leandro: "nunca más se equivoque en algo tan básico como
// el IVA"): el IVA de cada producto se calcula con SU alícuota, y la suma
// tiene que dar el IVA que imprime el pie de la factura. Si no da, no se
// adivina: la factura no se registra hasta que una persona diga la alícuota.
//
// Antes, cuando no podía probar la alícuota de cada renglón, el panel repartía
// el IVA del pie en proporción al neto. Eso es un promedio: en una factura con
// productos al 21% y al 10,5% le cargaba IVA de más a los del 10,5 y de menos a
// los del 21, y nadie se enteraba porque el total cerraba igual.
//
// Función pura, sin React: la prueban los tests de la API
// (apps/api/src/compras/iva-compras.spec.ts).
// ============================================================

/** Alícuotas de IVA vigentes en Argentina. Cualquier otra lectura es un error. */
export const ALICUOTAS_IVA = [0, 2.5, 5, 10.5, 21, 27] as const;

export type OrigenAlicuota = 'elegida' | 'impresa' | 'catalogo' | 'general';

export type RenglonIva = {
  /** neto del renglón ya con su descuento (cantidad × costo unitario del papel) */
  neto: number;
  /** la que imprime la fila de la factura, si la imprime */
  alicuotaImpresa?: number | null;
  /** la que eligió una persona en el panel: manda sobre todo lo demás */
  alicuotaElegida?: number | null;
  /** la que tiene el producto en el catálogo */
  alicuotaCatalogo?: number | null;
};

export type Pie = {
  neto: number | null;
  iva: number | null;
  /** percepciones de IVA + IIBB que van al costo (0 si la casa las deja afuera) */
  percepcionesAlCosto: number;
  impuestosInternos: number;
};

export type Sugerencia = { indices: number[]; alicuota: number };

export type ResultadoIva =
  | {
      estado: 'cierra';
      alicuotas: number[];
      origenes: OrigenAlicuota[];
      ivaCalculado: number;
      ivaPie: number;
      diferencia: number;
      /** neto del pie ÷ suma de renglones (≠ 1 si hay descuento en el pie) */
      factorNeto: number;
      /** percepciones + internos sobre el neto: se reparten en proporción */
      cargaComunPct: number;
    }
  | {
      estado: 'no_cierra';
      alicuotas: number[];
      origenes: OrigenAlicuota[];
      ivaCalculado: number;
      ivaPie: number;
      /** IVA del pie − IVA calculado: negativo = los renglones suman IVA de más */
      diferencia: number;
      factorNeto: number;
      cargaComunPct: number;
      /** cambios de alícuota que harían cerrar la factura (para ofrecer, nunca aplicar solos) */
      sugerencias: Sugerencia[];
    }
  | { estado: 'falta_pie'; motivo: string }
  | { estado: 'alicuota_invalida'; indices: number[] };

const redondear = (n: number) => Math.round(n * 100) / 100;

const valida = (a: unknown): a is number =>
  typeof a === 'number' && Number.isFinite(a) && (ALICUOTAS_IVA as readonly number[]).includes(a);

/**
 * Tolerancia de cierre. El proveedor redondea el IVA de cada renglón al
 * centavo, así que el pie puede diferir en medio centavo por renglón. Es
 * deliberadamente CHICA: un renglón de $1.000 al 10,5% mal tomado como 21%
 * mueve el IVA $105, y eso tiene que saltar siempre.
 */
export function toleranciaIva(renglones: number, ivaPie: number): number {
  return Math.max(1, renglones * 0.01, Math.abs(ivaPie) * 0.0002);
}

export function repartirIva(renglones: RenglonIva[], pie: Pie): ResultadoIva {
  const conNeto = renglones.map((r) => (Number.isFinite(r.neto) ? r.neto : 0));
  const suma = conNeto.reduce((s, n) => s + n, 0);

  if (pie.neto == null || !(pie.neto > 0)) return { estado: 'falta_pie', motivo: 'Falta el neto gravado del pie de la factura' };
  if (pie.iva == null || !(pie.iva >= 0)) return { estado: 'falta_pie', motivo: 'Falta el IVA del pie de la factura' };
  if (!(suma > 0)) return { estado: 'falta_pie', motivo: 'Los renglones no suman nada' };

  // una alícuota que no existe (un "12" o un "105" mal leídos) no se usa nunca
  const invalidas = renglones
    .map((r, i) => ({ i, a: r.alicuotaElegida ?? r.alicuotaImpresa }))
    .filter((x) => x.a != null && !valida(x.a))
    .map((x) => x.i);
  if (invalidas.length) return { estado: 'alicuota_invalida', indices: invalidas };

  const origenes: OrigenAlicuota[] = [];
  const alicuotas = renglones.map((r) => {
    if (valida(r.alicuotaElegida)) { origenes.push('elegida'); return r.alicuotaElegida; }
    if (valida(r.alicuotaImpresa)) { origenes.push('impresa'); return r.alicuotaImpresa; }
    if (valida(r.alicuotaCatalogo)) { origenes.push('catalogo'); return r.alicuotaCatalogo; }
    origenes.push('general');
    return 21;
  });

  const factorNeto = pie.neto / suma;
  const ivaDe = (als: number[]) => als.reduce((s, a, i) => s + conNeto[i] * factorNeto * (a / 100), 0);
  const ivaCalculado = redondear(ivaDe(alicuotas));
  const diferencia = redondear(pie.iva - ivaCalculado);
  const cargaComunPct = (pie.percepcionesAlCosto + pie.impuestosInternos) / pie.neto;
  const tol = toleranciaIva(renglones.length, pie.iva);

  if (Math.abs(diferencia) <= tol) {
    return { estado: 'cierra', alicuotas, origenes, ivaCalculado, ivaPie: pie.iva, diferencia, factorNeto, cargaComunPct };
  }

  // ¿Qué cambio de alícuota haría cerrar? Se prueban cambios de uno o dos
  // renglones a la misma alícuota: es lo que pasa en la práctica (una legumbre,
  // una carne al 10,5 en medio de almacén al 21). Primero sobre los renglones
  // sin alícuota escrita; si con esos no alcanza, también sobre los que la
  // traen impresa (la lectura pudo tomar "21" donde decía "10,5"), y al final
  // también lo que eligió una persona. Son sugerencias: nada se cambia solo.
  const cierraCon = (indices: number[], a: number) => {
    const als = alicuotas.slice();
    for (const i of indices) als[i] = a;
    return Math.abs(pie.iva! - ivaDe(als)) <= tol;
  };
  const buscarSugerencias = (libres: number[]): Sugerencia[] => {
    const encontradas: Sugerencia[] = [];
    for (const a of ALICUOTAS_IVA) {
      for (const i of libres) {
        if (alicuotas[i] !== a && cierraCon([i], a)) encontradas.push({ indices: [i], alicuota: a });
      }
    }
    if (encontradas.length || libres.length > 80) return encontradas;
    for (const a of ALICUOTAS_IVA) {
      for (let x = 0; x < libres.length && encontradas.length <= 5; x++) {
        for (let y = x + 1; y < libres.length && encontradas.length <= 5; y++) {
          const [i, j] = [libres[x], libres[y]];
          if (alicuotas[i] !== a && alicuotas[j] !== a && cierraCon([i, j], a)) encontradas.push({ indices: [i, j], alicuota: a });
        }
      }
    }
    return encontradas;
  };
  const indices = alicuotas.map((_, i) => i);
  let sugerencias = buscarSugerencias(indices.filter((i) => origenes[i] === 'catalogo' || origenes[i] === 'general'));
  if (!sugerencias.length) sugerencias = buscarSugerencias(indices.filter((i) => origenes[i] !== 'elegida'));
  // último recurso: también lo que eligió una persona (se sugiere, nunca se cambia solo)
  if (!sugerencias.length) sugerencias = buscarSugerencias(indices);

  return {
    estado: 'no_cierra',
    alicuotas,
    origenes,
    ivaCalculado,
    ivaPie: pie.iva,
    diferencia,
    factorNeto,
    cargaComunPct,
    // una sola salida posible es una sugerencia; muchas es ruido
    sugerencias: sugerencias.length <= 3 ? sugerencias : [],
  };
}

/** Costo final por unidad de un renglón con el IVA ya repartido. */
export function costoConIva(costoUnitarioNeto: number, alicuota: number, factorNeto: number, cargaComunPct: number): number {
  return redondear(costoUnitarioNeto * factorNeto * (1 + alicuota / 100 + cargaComunPct));
}

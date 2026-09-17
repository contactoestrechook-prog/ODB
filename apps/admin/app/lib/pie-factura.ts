// ============================================================
// EL PIE DE LA FACTURA: QUÉ FALTA, QUÉ SOBRA, Y ARREGLARLO CON UN CLICK (17/9/2026)
//
// Leandro: "hace 3 meses estamos con esto, necesito que lea bien los impuestos y
// que en caso que los lea mal todo se pueda sacar o agregar con un click".
//
// La identidad del papel es una sola: neto + IVA + percepciones + internos +
// otros = total. Si no da, la diferencia casi siempre es UN impuesto: uno que no
// se leyó (falta plata) o uno leído dos veces o de más (sobra plata). Se busca
// cuál es y se ofrece el arreglo exacto, listo para un click. Nunca se aplica solo.
//
// Además, cada proveedor cobra siempre las mismas percepciones (Luvik y Noria:
// perc. IVA 3% + IIBB 5%; Barraza: 3%; Teide: IIBB 3,3%). Si la factura no las
// trae y el pie no cierra, ese hábito dice cuál falta.
//
// Función pura, sin React: la prueban los tests de la API
// (apps/api/src/compras/pie-factura.spec.ts).
// ============================================================

export type CampoPie = 'iva' | 'percepcionIva' | 'percepcionIibb' | 'impuestosInternos' | 'otros';

export const NOMBRE_CAMPO: Record<CampoPie, string> = {
  iva: 'IVA',
  percepcionIva: 'Percepción IVA',
  percepcionIibb: 'Percepción IIBB',
  impuestosInternos: 'Impuestos internos',
  otros: 'Otros impuestos',
};

export type Pie = {
  neto: number | null;
  iva: number | null;
  percepcionIva: number | null;
  percepcionIibb: number | null;
  impuestosInternos: number | null;
  otros: number | null;
  descuentoGlobal?: number | null;
  total: number | null;
};

/** % sobre el neto que suele cobrar el proveedor (promedio de sus últimas facturas). */
export type Habituales = { facturas: number; percepcionIva: number; percepcionIibb: number; impuestosInternos: number } | null;

export type Arreglo = {
  campo: CampoPie;
  /** el monto que queda en el campo después del click */
  monto: number;
  /** % sobre el neto del monto nuevo */
  pct: number;
  accion: 'agregar' | 'quitar' | 'corregir';
  motivo: string;
};

export type Diagnostico = {
  /** neto + impuestos − total: negativo = falta plata en el pie, positivo = sobra */
  diferencia: number | null;
  cierra: boolean;
  arreglos: Arreglo[];
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const plata = (x: number) => '$' + Math.round(x).toLocaleString('es-AR');
const pctDe = (monto: number, neto: number) => (neto > 0 ? Math.round((monto / neto) * 10000) / 100 : 0);

// alícuotas de percepción que se ven en la práctica (ARBA/AGIP/RG): la
// diferencia tiene que caer justo en una de ellas para sugerirla por su nombre
const PCT_PERC_IVA = [1, 1.5, 2, 3, 5, 10];
const PCT_IIBB = [0.5, 1, 1.5, 1.75, 2, 2.5, 3, 3.3, 3.5, 4, 4.5, 5, 5.5, 6, 8];

export function toleranciaPie(total: number): number {
  return Math.max(1, Math.abs(total) * 0.0005);
}

export function sumaPie(p: Pie): number {
  return n(p.neto) + n(p.iva) + n(p.percepcionIva) + n(p.percepcionIibb) + n(p.impuestosInternos) + n(p.otros);
}

export function diagnosticarPie(p: Pie, habituales: Habituales = null): Diagnostico {
  const neto = n(p.neto);
  if (p.total == null || !(n(p.total) > 0) || !(neto > 0)) return { diferencia: null, cierra: false, arreglos: [] };
  const total = n(p.total);
  const diferencia = r2(sumaPie(p) - total);
  const tol = toleranciaPie(total);
  const cierra = Math.abs(diferencia) <= tol;
  const arreglos: Arreglo[] = [];
  const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(tol, 0.0006 * neto);

  if (!cierra && diferencia < 0) {
    // FALTA plata: un impuesto que no se leyó
    const falta = -diferencia;
    const pct = pctDe(falta, neto);
    const vacio = (c: CampoPie) => !(n(p[c]) > 0);
    const habitual = (c: 'percepcionIva' | 'percepcionIibb' | 'impuestosInternos') =>
      habituales && habituales.facturas >= 1 && habituales[c] > 0 && Math.abs(habituales[c] - pct) <= 0.15;
    const candidatos: Arreglo[] = [];
    // 1) lo que el proveedor cobra siempre y cae justo
    for (const c of ['percepcionIibb', 'percepcionIva', 'impuestosInternos'] as const) {
      if (vacio(c) && habitual(c)) {
        candidatos.push({ campo: c, monto: r2(falta), pct, accion: 'agregar', motivo: `falta ${pct.toString().replace('.', ',')}% del neto y este proveedor siempre cobra ${NOMBRE_CAMPO[c]} ${String(habituales![c]).replace('.', ',')}%` });
      }
    }
    // 2) un porcentaje típico exacto
    if (!candidatos.length) {
      const exacto = (lista: number[]) => lista.find((a) => cerca(neto * a / 100, falta));
      const aIibb = vacio('percepcionIibb') ? exacto(PCT_IIBB) : undefined;
      const aIva = vacio('percepcionIva') ? exacto(PCT_PERC_IVA) : undefined;
      if (aIibb != null) candidatos.push({ campo: 'percepcionIibb', monto: r2(falta), pct, accion: 'agregar', motivo: `falta justo el ${String(aIibb).replace('.', ',')}% del neto: parece una percepción de IIBB que no se leyó` });
      if (aIva != null) candidatos.push({ campo: 'percepcionIva', monto: r2(falta), pct, accion: 'agregar', motivo: `falta justo el ${String(aIva).replace('.', ',')}% del neto: parece una percepción de IVA que no se leyó` });
    }
    // 3) el IVA en blanco y la diferencia es un IVA
    if (vacio('iva') && [21, 10.5, 27].some((a) => cerca(neto * a / 100, falta))) {
      candidatos.unshift({ campo: 'iva', monto: r2(falta), pct, accion: 'agregar', motivo: `falta justo un IVA del ${pct.toString().replace('.', ',')}%: no se leyó el IVA` });
    }
    arreglos.push(...candidatos);
    // siempre hay una salida: cargar la diferencia como otros impuestos
    arreglos.push({ campo: 'otros', monto: r2(n(p.otros) + falta), pct: pctDe(n(p.otros) + falta, neto), accion: n(p.otros) > 0 ? 'corregir' : 'agregar', motivo: `cargar los ${plata(falta)} que faltan como otros impuestos` });
  }

  if (!cierra && diferencia > 0) {
    // SOBRA plata: un impuesto leído de más o dos veces
    const sobra = diferencia;
    // primero "otros": es donde cae lo leído dos veces (una percepción repetida sin rótulo propio)
    for (const c of ['otros', 'percepcionIibb', 'percepcionIva', 'impuestosInternos', 'iva'] as CampoPie[]) {
      const v = n(p[c]);
      if (v > 0 && cerca(v, sobra)) {
        arreglos.push({ campo: c, monto: 0, pct: 0, accion: 'quitar', motivo: `${NOMBRE_CAMPO[c]} (${plata(v)}) es justo lo que sobra: se leyó de más o dos veces` });
      }
    }
    if (!arreglos.length && n(p.otros) >= sobra) {
      arreglos.push({ campo: 'otros', monto: r2(n(p.otros) - sobra), pct: pctDe(n(p.otros) - sobra, neto), accion: 'corregir', motivo: `bajar otros impuestos en ${plata(sobra)}` });
    }
  }

  return { diferencia, cierra, arreglos };
}

/** El pie cierra pero el proveedor suele cobrar algo que esta factura no trae: se avisa, sin tocar nada. */
export function faltantesHabituales(p: Pie, habituales: Habituales): { campo: CampoPie; pct: number }[] {
  if (!habituales || habituales.facturas < 2) return [];
  return (['percepcionIva', 'percepcionIibb', 'impuestosInternos'] as const)
    .filter((c) => habituales[c] >= 0.5 && !(n(p[c]) > 0))
    .map((c) => ({ campo: c, pct: habituales[c] }));
}

/** Monto de un impuesto a partir de su % sobre el neto. */
export function montoPorPct(neto: number | null, pct: number): number {
  return r2(n(neto) * pct / 100);
}

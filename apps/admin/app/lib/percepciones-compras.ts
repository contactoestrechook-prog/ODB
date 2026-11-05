// ============================================================
// PERCEPCIONES CON BASE PROPIA (5/11/2026). La Serenísima 06376-00001075: en
// «Otros tributos» imprime la percepción de IVA al 3 % sobre una base de
// $449.833,62 (no sobre todo el neto, $800.707,62) y la de IIBB al 5 % sobre el
// neto entero. El panel repartía los $13.495 de la primera entre todo el neto
// (≈1,69 %) y la leche daba $2.168,48. Anabella la calcula $1.698,30 × 1,29 =
// $2.190,81 y el chat le discutió la cuenta.
//
// Regla de Leandro: «en estos casos vamos a aplicar el 1,29 a todo; cuando no
// dé la cuenta, que aparezca un cartel que es por eso, pero que deje cargarla».
//  - Una percepción que imprime su alícuota y se cobra sobre una base MENOR que
//    el neto va ENTERA a cada renglón: el costo es neto × (1 + IVA + alícuota).
//    El 1,29 no es fijo: es lo que imprime esa factura (21 + 3 + 5).
//  - Las demás (sin alícuota impresa, o cobradas sobre todo el neto o más)
//    siguen como siempre: su monto repartido sobre el neto, más los internos si
//    los hay (ver pctPercepciones en internos-compras.ts).
//  - Así los costos suman más que la factura: la diferencia es la alícuota por
//    la parte del neto que no estaba en la base. Se avisa en un cartel y NO se
//    traba el registro.
//  - Lo que se le paga al proveedor no cambia: total, IVA, percepciones y cuenta
//    corriente son los del papel. Solo cambia el costo por unidad.
//
// Funciones puras; se prueban en apps/api/src/compras/percepciones-compras.spec.ts.
// ============================================================

export type Percepcion = {
  /** cómo se la nombra en el cartel: «la percepción de IVA» */
  nombre: string;
  /** lo que cobra el papel, en pesos */
  monto: number;
  /** el % impreso; 0 o vacío si el papel no lo imprime */
  alicuota?: number | null;
  /** la base impresa sobre la que se calculó; 0 o vacío si el papel no la imprime */
  base?: number | null;
};

export type CargaPercepciones = {
  /** la fracción que se le suma a cada peso de neto (y de interno, si los hay) */
  pct: number;
  /** cuánto de más dan los costos contra la factura por aplicar alguna entera a todos */
  exceso: number;
  /** las que se aplicaron enteras, para el cartel */
  enteras: { nombre: string; alicuota: number; base: number; exceso: number }[];
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const redondear = (v: number) => Math.round(v * 100) / 100;

export function cargaDePercepciones(percepciones: Percepcion[], neto: number, internos = 0): CargaPercepciones {
  const netoDoc = n(neto);
  const baseComun = netoDoc + Math.max(0, n(internos));
  let pct = 0;
  let exceso = 0;
  const enteras: CargaPercepciones['enteras'] = [];
  if (!(netoDoc > 0)) return { pct, exceso, enteras };
  for (const p of percepciones ?? []) {
    const monto = n(p.monto);
    if (!(monto > 0)) continue;
    const alicuota = n(p.alicuota);
    const base = n(p.base);
    // la alícuota y la base impresas valen si entre las dos dan el monto del papel
    const coherente = alicuota > 0 && alicuota <= 30 && base > 0 && Math.abs((base * alicuota) / 100 - monto) <= Math.max(1, monto * 0.01);
    if (coherente && base < netoDoc * 0.995) {
      pct += alicuota / 100;
      const deMas = redondear((baseComun * alicuota) / 100 - monto);
      exceso += deMas;
      enteras.push({ nombre: p.nombre, alicuota, base, exceso: deMas });
    } else {
      pct += monto / baseComun;
    }
  }
  return { pct, exceso: redondear(exceso), enteras };
}

/** El cartel: por qué el costo da más que la factura, en una oración. */
export function textoPercepcionesEnteras(c: CargaPercepciones, pesos: (v: number) => string): string {
  if (!c.enteras.length) return '';
  const pc = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
  const partes = c.enteras.map((e) => `${e.nombre} (${pc(e.alicuota)} %) se cobra sobre ${pesos(e.base)}`);
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  return `El costo da ${pesos(c.exceso)} más que la factura porque ${lista} y se aplicó a todos los renglones. Lo que se le paga al proveedor no cambia.`;
}

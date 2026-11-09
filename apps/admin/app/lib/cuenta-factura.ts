// ============================================================
// LA CUENTA DE LA FACTURA (9/11/2026). Leandro: «¿cómo puede ser que el sistema
// se equivoque tanto y no lo podamos terminar de entender? Usá la lógica,
// siempre la lógica. Y hacela más simple, siempre. Y que el chat que usa ella
// pueda modificar esa lógica».
//
// Antes había tres controles sueltos, cada uno con su propia base: «el costo
// supera la mercadería con IVA», «supera el total» y «el costo no alcanza».
// Con una devolución en negativo el primero gritaba en falso (el pie ya la
// tenía restada y el costo no), y nadie entendía qué pedía.
//
// Ahora hay UNA cuenta, la que haría cualquiera con el papel en la mano: lo
// que cobra la factura tiene que ser la suma de lo que trae, cada cosa con sus
// impuestos.
//
//   lo que entra al stock
// + lo que no entra (destildado, volvió en la entrega, faltó, solo precio)
// − lo devuelto al proveedor (el renglón en negativo)
// + lo del pie que no va al costo (percepciones si no se costean, otros cargos)
// − lo que el costo da de más a propósito (percepción entera a cada renglón)
// = el total de la factura
//
// Si no da, la diferencia se dice en pesos y se señala el renglón sospechoso.
// Y la persona (o el chat, en su nombre) puede aceptarla con un motivo: queda
// escrito y no traba. Es la única cuenta que traba el registro por plata.
// ============================================================

export type TipoParte = 'entra' | 'no_entra' | 'volvio' | 'falto' | 'solo_precio' | 'devuelto';

/** Un renglón (o la parte de un renglón) con lo que vale en la factura, impuestos incluidos. */
export type ParteRenglon = { renglon: number; descripcion: string; tipo: TipoParte; valor: number };

export type EntradaCuenta = {
  /** el total impreso; null si no se leyó (entonces no hay con qué comparar) */
  total: number | null;
  partes: ParteRenglon[];
  /** percepciones que NO se suman al costo (la casilla «percepciones al costo» destildada) */
  percepcionesFueraDelCosto?: number;
  /** otros cargos del pie (flete, redondeo impreso): se pagan y no son de ningún renglón */
  otrosDelPie?: number;
  /** lo que el costo da de más porque una percepción va entera a cada renglón (5/11/2026) */
  excesoPercepciones?: number;
  /** descuentos que la persona eligió no aplicar: el renglón cuesta más que lo que cobra el pie */
  descuentosNoAplicados?: number;
  /** la diferencia que aceptó una persona, con su motivo */
  aceptada?: { monto: number; motivo: string } | null;
};

export type LineaCuenta = { clave: string; texto: string; monto: number; renglones: number[] };

export type Cuenta = {
  lineas: LineaCuenta[];
  /** la suma de las líneas */
  calculado: number;
  total: number | null;
  /** total − calculado: positivo = la factura cobra más de lo que suman los renglones */
  diferencia: number | null;
  /** hasta cuánto se considera redondeo */
  tolerancia: number;
  estado: 'sin_total' | 'cierra' | 'aceptada' | 'no_cierra';
  /** los renglones que mejor explican la diferencia (el que vale justo eso, o el más parecido) */
  sospechosos: number[];
  /** una oración para la persona */
  mensaje: string;
};

const TEXTO: Record<TipoParte, string> = {
  entra: 'Entra al stock',
  no_entra: 'No entra al stock (destildado)',
  volvio: 'Volvió en la entrega',
  falto: 'Faltó en la entrega',
  solo_precio: 'Solo actualiza el precio',
  devuelto: 'Devuelto al proveedor',
};
const redondear = (n: number) => Math.round(n * 100) / 100;
const pesosCortos = (n: number) => `$${Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Redondeo tolerado: medio por ciento del total, nunca menos de $5 (centavos de cada renglón). */
export function toleranciaDe(total: number): number {
  return Math.max(5, Math.abs(total) * 0.005);
}

export function cuentaDeLaFactura(e: EntradaCuenta): Cuenta {
  const lineas: LineaCuenta[] = [];
  for (const tipo of ['entra', 'no_entra', 'volvio', 'falto', 'solo_precio', 'devuelto'] as TipoParte[]) {
    const ps = e.partes.filter((p) => p.tipo === tipo && Math.abs(p.valor) >= 0.005);
    if (!ps.length) continue;
    const monto = ps.reduce((s, p) => s + p.valor, 0);
    lineas.push({ clave: tipo, texto: TEXTO[tipo], monto: redondear(monto), renglones: [...new Set(ps.map((p) => p.renglon))] });
  }
  const pie = (clave: string, texto: string, monto: number | undefined) => {
    if (monto && Math.abs(monto) >= 0.005) lineas.push({ clave, texto, monto: redondear(monto), renglones: [] });
  };
  pie('percepciones', 'Percepciones que no van al costo', e.percepcionesFueraDelCosto);
  pie('otros', 'Otros cargos del pie', e.otrosDelPie);
  pie('exceso_percepciones', 'Percepción entera en cada renglón (el costo da de más a propósito)', e.excesoPercepciones ? -e.excesoPercepciones : 0);
  pie('descuentos_no_aplicados', 'Descuentos que se eligió no aplicar', e.descuentosNoAplicados ? -e.descuentosNoAplicados : 0);

  const calculado = redondear(lineas.reduce((s, l) => s + l.monto, 0));
  if (e.total == null || !(e.total > 0)) {
    return { lineas, calculado, total: null, diferencia: null, tolerancia: 0, estado: 'sin_total', sospechosos: [], mensaje: 'La factura no tiene el total leído: cargalo en el pie para poder controlar la cuenta.' };
  }
  const total = redondear(e.total);
  const diferencia = redondear(total - calculado);
  const tolerancia = toleranciaDe(total);
  if (Math.abs(diferencia) <= tolerancia) {
    return { lineas, calculado, total, diferencia, tolerancia, estado: 'cierra', sospechosos: [], mensaje: Math.abs(diferencia) >= 1 ? `Cierra (${pesosCortos(diferencia)} de redondeo).` : 'Cierra al centavo.' };
  }
  const sospechosos = sospechososDe(e.partes, diferencia);
  // aceptada: vale si es la MISMA diferencia (si después cambió algo, hay que volver a mirarla)
  if (e.aceptada && e.aceptada.motivo.trim() && Math.abs(Math.abs(e.aceptada.monto) - Math.abs(diferencia)) <= tolerancia) {
    return { lineas, calculado, total, diferencia, tolerancia, estado: 'aceptada', sospechosos, mensaje: `No cierra por ${pesosCortos(diferencia)}, aceptado: «${e.aceptada.motivo.trim()}».` };
  }
  const sentido = diferencia > 0
    ? `La factura cobra ${pesosCortos(diferencia)} más de lo que suman los renglones`
    : `Los renglones suman ${pesosCortos(diferencia)} más de lo que cobra la factura`;
  const donde = sospechosos.length ? `: mirá el renglón ${sospechosos.join(' o el ')}` : ': revisá cantidades y precios contra el papel, y el pie';
  return { lineas, calculado, total, diferencia, tolerancia, estado: 'no_cierra', sospechosos, mensaje: `${sentido}${donde}.` };
}

/**
 * Qué renglón explica la diferencia. Primero, uno que valga justo eso (un
 * renglón que no se leyó o se leyó dos veces, un destildado que en realidad
 * entró). Si no, el que tenga un valor más parecido (cantidad o precio mal leídos).
 */
export function sospechososDe(partes: ParteRenglon[], diferencia: number): number[] {
  const d = Math.abs(diferencia);
  const exactos = partes.filter((p) => Math.abs(Math.abs(p.valor) - d) <= Math.max(1, d * 0.01)).map((p) => p.renglon);
  if (exactos.length) return [...new Set(exactos)].slice(0, 3);
  // un renglón al que le sobra o le falta un bulto vale varias veces la diferencia: el más parecido
  const cercano = partes
    .filter((p) => Math.abs(p.valor) >= d * 0.5)
    .sort((a, b) => Math.abs(Math.abs(a.valor) - d) - Math.abs(Math.abs(b.valor) - d))[0];
  return cercano && Math.abs(cercano.valor) <= d * 3 ? [cercano.renglon] : [];
}

/** La cuenta como la lee el chat: corta y con los mismos números que ve la persona. */
export function cuentaParaIA(c: Cuenta) {
  return {
    estado: c.estado,
    lineas: c.lineas.map((l) => ({ que: l.texto, monto: l.monto, renglones: l.renglones })),
    sumaDeLasLineas: c.calculado,
    totalDeLaFactura: c.total,
    diferencia: c.diferencia,
    redondeoTolerado: redondear(c.tolerancia),
    sospechosos: c.sospechosos,
    mensaje: c.mensaje,
  };
}

// ============================================================
// CIGARRILLOS: LOS IMPUESTOS INTERNOS VIENEN IMPRESOS POR RENGLÓN (5/11/2026)
// Leandro: «investigá cómo son los impuestos en una factura de cigarrillos,
// aplicalo al sistema y dale razonamiento: no puedo explicarle todo».
//
// Cómo es la factura de un distribuidor de cigarrillos (Grupo Modo
// 0005-00843292 y 0005-00843293, del 4/11/2026):
//
//   Cant  Descripción        Neto      Iva      Imp Int Uni  Precio Unit  Total
//   30    LUCKY COOL 12      715,42    150,24   2.517,91     3.383,57     101.507,12
//
// - «Neto» es el precio neto POR UNIDAD: lo único que es base del IVA.
// - «Iva» es el 21 % de ese neto, por unidad.
// - «Imp Int Uni» es el impuesto interno por unidad. Lo fija la ley sobre el
//   precio de venta al público (hoy 73 %, Ley 27.742) y lo paga UNA sola vez
//   la tabacalera: el distribuidor lo traslada tal cual. No lleva IVA y no es
//   crédito fiscal: es costo.
// - «Precio Unit» = neto + IVA + interno. NO es un precio neto.
// - «Total» del renglón = cantidad × Precio Unit (con todos los impuestos).
// - En el pie: Subtotal = suma de los netos; IVA 21 % = 21 % del subtotal;
//   Imp. Internos = suma de los internos de cada renglón; y la percepción de
//   IIBB es el 5 % de (subtotal + internos), no del subtotal solo.
//
// LO QUE DICE EL PAPEL MANDA (Leandro, 5/11/2026: «¿toma el neto en vez del
// precio unitario?»): el renglón se muestra y se carga con el «Precio Unit» y
// el «Total» impresos, que es lo que se paga por cada atado. El neto y el
// interno de cada renglón se guardan APARTE, solo para controlar el IVA y los
// internos contra el pie y para repartir la percepción. El costo es el precio
// unitario del papel más su parte de la percepción.
//
// Vale también para los renglones sin interno de la misma factura (las barras
// de cereal que vienen con los cigarrillos): su «Precio Unit» ya trae el IVA.
// ============================================================

export type RenglonLeido = {
  cantidad?: number | null;
  precio?: number | null;
  importe?: number | null;
  alicuotaIva?: number | null;
  impuestoInternoUnitario?: number | null;
};

export type RenglonDelPapel = {
  /** el «Precio Unit» del papel: neto + IVA + interno */
  precio: number;
  /** el «Total» del renglón, como está impreso */
  importe: number;
  alicuotaIva: number;
  /** el neto por unidad (la base del IVA) */
  netoDelPapel: number;
  /** qué parte del precio unitario es neto: sirve aunque después cambie la unidad o haya un descuento */
  fraccionNeta: number;
  /** impuestos internos del renglón entero, según el papel (0 si no lleva) */
  internosDelPapel: number;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const redondear = (v: number) => Math.round(v * 100) / 100;
const parecido = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.006);

/**
 * Los renglones de una factura que imprime el impuesto interno por unidad, con
 * el precio unitario y el total del papel, y aparte su neto y su interno.
 * Devuelve null en cada renglón que no hay que tocar, y null entero si la
 * factura no trae internos por renglón.
 */
export function renglonesDelPapel(items: RenglonLeido[]): (RenglonDelPapel | null)[] | null {
  if (!items.some((i) => n(i.impuestoInternoUnitario) > 0 && n(i.cantidad) > 0)) return null;
  return items.map((i) => {
    const cantidad = n(i.cantidad);
    const precio = n(i.precio);
    const importe = n(i.importe);
    const interno = Math.max(0, n(i.impuestoInternoUnitario));
    if (!(cantidad > 0) || !(precio > 0) || importe < 0) return null;
    const alicuota = n(i.alicuotaIva) > 0 && n(i.alicuotaIva) <= 27 ? n(i.alicuotaIva) : 21;
    const conIva = 1 + alicuota / 100;
    const porUnidad = importe > 0 ? importe / cantidad : 0;

    // el precio que se leyó: ¿es el «Precio Unit» (con todo adentro) o la columna Neto?
    let neto: number | null = null;
    let final = precio;
    // se leyó el «Precio Unit»: queda tal cual
    if (porUnidad > 0 && parecido(precio, porUnidad) && precio > interno) neto = (precio - interno) / conIva;
    // se leyó la columna Neto: el precio vuelve a ser el «Precio Unit» del papel
    else if (porUnidad > 0 && parecido(precio * conIva + interno, porUnidad)) { neto = precio; final = redondear(precio * conIva + interno); }
    else if (importe === 0 && precio > interno) neto = (precio - interno) / conIva;
    if (neto == null || !(neto > 0)) return null;
    return {
      precio: final,
      importe: importe > 0 ? importe : redondear(cantidad * final),
      alicuotaIva: alicuota,
      netoDelPapel: redondear(neto),
      fraccionNeta: neto / final,
      internosDelPapel: redondear(cantidad * interno),
    };
  });
}

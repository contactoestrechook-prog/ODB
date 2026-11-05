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
// El sistema trabaja cada renglón por su NETO (cantidad × precio = importe, y
// después suma IVA, percepciones e internos). Con «Precio Unit» y «Total»
// tomados tal cual, los renglones sumaban 329.400,32 contra un neto de
// 69.658,20: nada cerraba y había que explicarlo a mano.
//
// Esta función deja cada renglón en neto y guarda cuánto interno trae cada uno
// según el papel. Vale también para los renglones sin interno de la misma
// factura (las barras de cereal que vienen con los cigarrillos), que en este
// formato también traen el total con IVA.
// ============================================================

export type RenglonLeido = {
  cantidad?: number | null;
  precio?: number | null;
  importe?: number | null;
  alicuotaIva?: number | null;
  impuestoInternoUnitario?: number | null;
};

export type RenglonEnNeto = {
  /** precio neto por unidad */
  precio: number;
  /** cantidad × precio neto */
  importe: number;
  alicuotaIva: number;
  /** impuestos internos del renglón entero, según el papel (0 si no lleva) */
  internosDelPapel: number;
  /** el total impreso en el renglón, con impuestos */
  importeImpreso: number;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const redondear = (v: number) => Math.round(v * 100) / 100;
const parecido = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.006);

/**
 * Los renglones de una factura que imprime el impuesto interno por unidad,
 * llevados a neto. Devuelve null en cada renglón que no hay que tocar, y null
 * entero si la factura no trae internos por renglón.
 */
export function renglonesEnNeto(items: RenglonLeido[]): (RenglonEnNeto | null)[] | null {
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

    // el precio que se leyó: ¿es el neto, o el «Precio Unit» con todo adentro?
    let neto: number | null = null;
    if (porUnidad > 0 && parecido(precio * conIva + interno, porUnidad)) neto = precio;
    else if (porUnidad > 0 && parecido(precio, porUnidad) && precio > interno) neto = (precio - interno) / conIva;
    else if (interno > 0 && importe === 0) neto = precio;
    // un renglón que ya está en neto (cantidad × precio = importe, sin interno) no se toca
    if (neto == null || (interno === 0 && parecido(precio * cantidad, importe))) return null;
    const precioNeto = redondear(neto);
    return {
      precio: precioNeto,
      importe: redondear(cantidad * precioNeto),
      alicuotaIva: alicuota,
      internosDelPapel: redondear(cantidad * interno),
      importeImpreso: importe,
    };
  });
}

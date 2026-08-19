// Costeo de una compra — LÓGICA PURA, sin DB ni red, testeable aislada.
//
// El precio de lista de un proveedor casi nunca es el costo real. Entre medio hay
// descuentos en cascada, bonificaciones, flete, impuestos internos y el costo del
// plazo de pago. Errar acá se paga dos veces: se compra mal y además se fija mal
// el precio de venta, porque la regla de oro de ODB parte del costo.
//
// Qué es costo y qué no (esto es lo que más se equivoca a mano):
//  · IVA .............. NO es costo. Se recupera como crédito fiscal.
//  · Percepciones ..... NO son costo. Son pagos a cuenta de otros impuestos.
//  · Impuestos internos SÍ son costo. No se recuperan.
//  · Flete ............ SÍ es costo. Se prorratea entre las unidades que llegan.

export type Bonificacion = {
  // "compra 10, lleva 12" → paga: 10, gratis: 2
  paga: number;
  gratis: number;
};

export type OfertaCompra = {
  descripcion?: string;
  /** unidades que trae cada bulto/caja. 1 si se compra por unidad. */
  unidadesPorBulto: number;
  /** cuántos bultos se compran (para prorratear el flete) */
  bultos: number;
  /** precio de lista de UN bulto, sin IVA */
  precioBulto: number;
  /** ajuste sobre la lista ANTES de descuentos: +29 = el proveedor subió 29%; -5 = bajó 5% */
  ajusteListaPct?: number;
  /** descuentos que se aplican uno sobre otro, en orden: [10, 5] = 10% y después 5% */
  descuentosPct?: number[];
  bonificacion?: Bonificacion | null;
  /** flete TOTAL de la compra (no por bulto) */
  flete?: number;
  /** impuestos internos: % sobre el neto, o monto fijo por unidad */
  impuestosInternosPct?: number;
  impuestosInternosPorUnidad?: number;
  /** días de plazo de pago (0 = contado) */
  plazoDias?: number;
  /** tasa mensual de referencia para valuar el plazo (%) */
  tasaMensualPct?: number;
};

export type CostoCalculado = {
  descripcion: string;
  unidadesPagadas: number;
  unidadesRecibidas: number;
  /** lo que se paga de mercadería, ya con descuentos y bonificación */
  netoMercaderia: number;
  fletePorUnidad: number;
  internosPorUnidad: number;
  /** costo por unidad antes de valuar el plazo de pago */
  costoUnitarioContado: number;
  /** costo por unidad llevado a valor de hoy (comparable entre ofertas con plazos distintos) */
  costoUnitarioReal: number;
  ahorroPorPlazo: number;
  detalle: string[];
};

const redondear = (n: number, dec = 4) => {
  const f = 10 ** dec;
  return Math.round((Number(n) || 0) * f) / f;
};

const pesos = (n: number) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

/**
 * Costo real por unidad de una oferta. Devuelve además el detalle paso a paso,
 * para que el comprador (y el dueño que aprueba) vean de dónde sale el número.
 */
export function calcularCosto(oferta: OfertaCompra): CostoCalculado {
  const unidadesPorBulto = Math.max(1, Number(oferta.unidadesPorBulto) || 1);
  const bultos = Math.max(1, Number(oferta.bultos) || 1);
  const precioBulto = Number(oferta.precioBulto) || 0;
  if (precioBulto <= 0) throw new Error('El precio del bulto tiene que ser mayor a cero');

  const detalle: string[] = [];
  detalle.push(
    `Punto de partida: ${bultos} bulto(s) de ${unidadesPorBulto} u. a ${pesos(precioBulto)} c/u = ${pesos(precioBulto * bultos)}`,
  );

  // 0) ajuste de la lista (el proveedor subió o bajó sus precios): se aplica
  //    sobre el precio de lista, antes de cualquier descuento
  let precioBultoNeto = precioBulto;
  const ajuste = Number(oferta.ajusteListaPct) || 0;
  if (ajuste !== 0) {
    precioBultoNeto = precioBulto * (1 + ajuste / 100);
    detalle.push(
      `Lista ${ajuste > 0 ? 'aumentada' : 'rebajada'} ${Math.abs(ajuste)}%: ${pesos(precioBulto)} → ${pesos(precioBultoNeto)} por bulto`,
    );
  }

  // 1) descuentos en cascada (no se suman: se aplican uno sobre el otro)
  for (const d of oferta.descuentosPct ?? []) {
    const pct = Number(d) || 0;
    if (pct <= 0) continue;
    const antes = precioBultoNeto;
    precioBultoNeto = precioBultoNeto * (1 - pct / 100);
    detalle.push(`Descuento ${pct}%: ${pesos(antes)} → ${pesos(precioBultoNeto)} por bulto`);
  }
  if ((oferta.descuentosPct ?? []).filter((d) => Number(d) > 0).length > 1) {
    const suma = (oferta.descuentosPct ?? []).reduce((s, d) => s + (Number(d) || 0), 0);
    const base = precioBulto * (1 + ajuste / 100);
    const real = (1 - precioBultoNeto / base) * 100;
    detalle.push(
      `Ojo: los descuentos NO se suman. ${suma.toFixed(1)}% "de arriba" es en realidad ${real.toFixed(2)}%`,
    );
  }

  const netoMercaderia = precioBultoNeto * bultos;

  // 2) bonificación: se paga por unos bultos y llegan más
  let bultosRecibidos = bultos;
  const bon = oferta.bonificacion;
  if (bon && Number(bon.paga) > 0 && Number(bon.gratis) > 0) {
    const combos = Math.floor(bultos / Number(bon.paga));
    const regalados = combos * Number(bon.gratis);
    bultosRecibidos = bultos + regalados;
    detalle.push(
      `Bonificación ${bon.paga}+${bon.gratis}: se pagan ${bultos} bulto(s) y llegan ${bultosRecibidos} (${regalados} sin cargo)`,
    );
  }

  const unidadesPagadas = bultos * unidadesPorBulto;
  const unidadesRecibidas = bultosRecibidos * unidadesPorBulto;

  // 3) flete: se reparte entre las unidades que REALMENTE llegan
  const flete = Number(oferta.flete) || 0;
  const fletePorUnidad = unidadesRecibidas > 0 ? flete / unidadesRecibidas : 0;
  if (flete > 0) {
    detalle.push(
      `Flete ${pesos(flete)} repartido en ${unidadesRecibidas} u. = ${pesos(fletePorUnidad)} por unidad`,
    );
  }

  // 4) impuestos internos: sí son costo, no se recuperan
  let internosPorUnidad = Number(oferta.impuestosInternosPorUnidad) || 0;
  if (!internosPorUnidad && Number(oferta.impuestosInternosPct) > 0) {
    const totalInternos = netoMercaderia * (Number(oferta.impuestosInternosPct) / 100);
    internosPorUnidad = unidadesRecibidas > 0 ? totalInternos / unidadesRecibidas : 0;
    detalle.push(
      `Impuestos internos ${oferta.impuestosInternosPct}% sobre ${pesos(netoMercaderia)} = ${pesos(totalInternos)} (${pesos(internosPorUnidad)} por unidad)`,
    );
  } else if (internosPorUnidad > 0) {
    detalle.push(`Impuestos internos: ${pesos(internosPorUnidad)} por unidad`);
  }

  const costoMercaderiaPorUnidad = unidadesRecibidas > 0 ? netoMercaderia / unidadesRecibidas : 0;
  const costoUnitarioContado = costoMercaderiaPorUnidad + fletePorUnidad + internosPorUnidad;
  detalle.push(
    `Mercadería ${pesos(costoMercaderiaPorUnidad)} + flete ${pesos(fletePorUnidad)} + internos ${pesos(internosPorUnidad)} = ${pesos(costoUnitarioContado)} por unidad`,
  );

  // 5) el plazo de pago vale plata: se lleva a valor de hoy para poder comparar
  //    ofertas con plazos distintos en igualdad de condiciones
  const dias = Math.max(0, Number(oferta.plazoDias) || 0);
  const tasa = Math.max(0, Number(oferta.tasaMensualPct) || 0);
  let costoUnitarioReal = costoUnitarioContado;
  if (dias > 0 && tasa > 0) {
    costoUnitarioReal = costoUnitarioContado / (1 + (tasa / 100) * (dias / 30));
    detalle.push(
      `Pago a ${dias} días con tasa ${tasa}% mensual: en plata de hoy son ${pesos(costoUnitarioReal)} por unidad`,
    );
  }

  return {
    descripcion: oferta.descripcion ?? 'Oferta sin nombre',
    unidadesPagadas,
    unidadesRecibidas,
    netoMercaderia: redondear(netoMercaderia, 2),
    fletePorUnidad: redondear(fletePorUnidad, 2),
    internosPorUnidad: redondear(internosPorUnidad, 2),
    costoUnitarioContado: redondear(costoUnitarioContado, 2),
    costoUnitarioReal: redondear(costoUnitarioReal, 2),
    ahorroPorPlazo: redondear(costoUnitarioContado - costoUnitarioReal, 2),
    detalle,
  };
}

/**
 * Compara varias ofertas del mismo producto y devuelve cuál conviene, ordenadas
 * por costo real. Es el caso típico: dos proveedores con estructuras distintas
 * (uno con bonificación, otro con descuento y plazo) que a ojo no se comparan.
 */
export function compararOfertas(ofertas: OfertaCompra[]) {
  if (!ofertas?.length) throw new Error('No hay ofertas para comparar');
  const calculadas = ofertas.map(calcularCosto).sort((a, b) => a.costoUnitarioReal - b.costoUnitarioReal);
  const mejor = calculadas[0];
  const peor = calculadas[calculadas.length - 1];
  const diferenciaPct =
    mejor.costoUnitarioReal > 0
      ? ((peor.costoUnitarioReal - mejor.costoUnitarioReal) / mejor.costoUnitarioReal) * 100
      : 0;
  return {
    ofertas: calculadas,
    mejor: mejor.descripcion,
    diferenciaPct: redondear(diferenciaPct, 2),
    veredicto:
      calculadas.length > 1
        ? `Conviene "${mejor.descripcion}": ${pesos(mejor.costoUnitarioReal)} por unidad, ${diferenciaPct.toFixed(1)}% por debajo de la más cara.`
        : `Costo real: ${pesos(mejor.costoUnitarioReal)} por unidad.`,
  };
}

/**
 * Qué pasa con el precio de venta si se toma este costo. No decide nada: muestra
 * el impacto para que el dueño apruebe con el número a la vista.
 */
export function impactoEnPrecio(params: {
  costoNuevo: number;
  costoAnterior?: number | null;
  precioVigente?: number | null;
  margenPct: number;
}) {
  const costoNuevo = Number(params.costoNuevo) || 0;
  const costoAnterior = Number(params.costoAnterior) || 0;
  const precioVigente = Number(params.precioVigente) || 0;
  const margen = Number(params.margenPct) || 0;

  const precioSugerido = Math.round(costoNuevo * (1 + margen / 100));
  const variacionCostoPct = costoAnterior > 0 ? ((costoNuevo - costoAnterior) / costoAnterior) * 100 : null;
  const variacionPrecioPct = precioVigente > 0 ? ((precioSugerido - precioVigente) / precioVigente) * 100 : null;
  // margen que quedaría si NO se tocara el precio de venta
  const margenSiNoSeTocaPct = costoNuevo > 0 && precioVigente > 0 ? ((precioVigente - costoNuevo) / costoNuevo) * 100 : null;

  return {
    precioSugerido,
    variacionCostoPct: variacionCostoPct == null ? null : redondear(variacionCostoPct, 2),
    variacionPrecioPct: variacionPrecioPct == null ? null : redondear(variacionPrecioPct, 2),
    margenSiNoSeTocaPct: margenSiNoSeTocaPct == null ? null : redondear(margenSiNoSeTocaPct, 2),
    vendeBajoCosto: precioVigente > 0 && precioVigente < costoNuevo,
  };
}

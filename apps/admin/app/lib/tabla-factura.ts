// ============================================================
// LA FACTURA COMO TABLA (8/10/2026). Pedido de Leandro: «una pantalla donde
// aparezcan todos los ítems de la factura, como si fuese una foto de la factura
// pero editables; si administración ve que el sistema leyó mal algo, le cambia
// la cantidad y se hace la cuenta automáticamente».
//
// Cada renglón de mercadería se muestra con las columnas del papel: bultos,
// unidades por bulto, sueltas, precio unitario, % de descuento, IVA e importe.
// La cuenta, unidades × precio − descuento, tiene que dar el importe impreso:
// si da, el renglón está bien leído; si no, se ve en rojo y con la diferencia.
//
// La tabla NO tiene estado propio: edita los mismos renglones (fotoItems) con
// los que la pantalla de compras calcula el costo y registra la entrada. Lo del
// papel queda guardado en `papel`; lo que entra al stock (cantidad, precio,
// importe, bonificación) se recalcula desde ahí con aplicarPapel().
//
// Funciones puras, sin React. Las prueban los tests de la API
// (apps/api/src/compras/tabla-factura.spec.ts).
// ============================================================

export type Papel = {
  /** bultos o cajas del papel («1 BTO», «BULT 1») */
  bultos: number | null;
  /** unidades que trae cada bulto («12 X 300Grs», «UxB 12») */
  uxb: number | null;
  /** unidades sueltas («12 un», «UNID 4») */
  sueltas: number | null;
  /** precio unitario impreso, por unidad */
  precio: number | null;
  /** % de descuento o bonificación del renglón */
  desc: number | null;
  /** alícuota de IVA del renglón */
  iva: number | null;
  /** importe del renglón (neto, lo que suma al pie) */
  importe: number | null;
  /**
   * % de bonificación que la factura informa pero que YA está adentro del precio
   * unitario (unidades × precio = importe, sin descontar nada). Es un dato, no se
   * vuelve a descontar (Rueda Que Rueda, 22/10/2026: «bonif. 18%» en renglones
   * que ya estaban bonificados daban «no cierra»).
   */
  descIncluido?: number | null;
};

/**
 * Cómo entra al stock lo que dice el papel:
 * - unidades: tal cual (bultos × unidades por bulto + sueltas);
 * - cajas de N: el producto del catálogo es la caja (30 Fuet = 3 cajas de 10);
 * - abiertas de N: la factura cuenta cajas y el stock va por unidad
 *   (6 «Paty Light caja ×4» = 24 hamburguesas).
 * null: hay un bulto y nadie dijo todavía cómo entra.
 */
export type EntraComo = { como: 'unidades' } | { como: 'cajas'; de: number } | { como: 'abiertas'; de: number } | null;

export const CAMPOS_PAPEL = ['bultos', 'uxb', 'sueltas', 'precio', 'desc', 'iva', 'importe'] as const;
export type CampoPapel = (typeof CAMPOS_PAPEL)[number];

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
/** el proveedor redondea: unos centavos, o 0,2 % del importe en renglones grandes */
const tolerancia = (importe: number) => Math.max(0.1, Math.abs(importe) * 0.002);

export function unidadesDelPapel(p: Papel): number {
  // un bulto sin unidades por bulto cuenta como una unidad: nunca se pierde en silencio
  return (num(p.bultos) ?? 0) * (num(p.uxb) || 1) + (num(p.sueltas) ?? 0);
}

/** La cuenta del renglón: unidades × precio − % de descuento, contra el importe impreso. */
export function cuentaDelPapel(p: Papel): { unidades: number; lista: number; cuenta: number; cierra: boolean; dif: number | null } {
  const unidades = unidadesDelPapel(p);
  const lista = unidades * (num(p.precio) ?? 0);
  const cuenta = lista * (1 - Math.min(100, Math.abs(num(p.desc) ?? 0)) / 100);
  const importe = num(p.importe);
  const cierra = importe != null && unidades > 0 && Math.abs(cuenta - importe) <= tolerancia(importe);
  return { unidades, lista: redondear(lista), cuenta: redondear(cuenta), cierra, dif: importe != null ? redondear(cuenta - importe) : null };
}

/**
 * Lo que dice el papel, a partir del renglón que devolvió el lector (la lectura
 * cruda y su interpretación). Se arma UNA vez, al cargar la lectura en pantalla.
 */
export function papelDeLectura(raw: any): Papel {
  const r = raw?.interpretado ?? {};
  const papel = papelSegun(raw, num(raw?.bonificacionPct) ?? num(r.bonificacionPct));
  // La bonificación informada pero ya aplicada en el precio impreso: con ella la
  // cuenta no cierra y sin ella cierra exacto. Manda el importe impreso.
  const desc = num(papel.desc);
  if (desc != null && desc > 0 && !cuentaDelPapel(papel).cierra) {
    const sin = papelSegun(raw, null);
    if (cuentaDelPapel(sin).cierra) return { ...sin, descIncluido: desc };
  }
  return papel;
}

function papelSegun(raw: any, desc: number | null): Papel {
  const papel = papelLeido(raw, desc);
  if (cuentaDelPapel(papel).cierra) return papel;
  // MANDA EL IMPORTE (5/11/2026, Galletitas del Sur, «Alfajor Jorgito 18 x 6U»:
  // 1 bulto, el lector tomó ×6 y el bulto trae 18 paquetes). Si nada de lo leído
  // cierra pero el importe ÷ el precio neto da un número entero de unidades que
  // se reparte justo en los bultos del papel, eso trae cada bulto. Nadie tiene
  // que explicarlo: la cuenta lo dice sola.
  const precio = num(papel.precio);
  const importe = num(papel.importe);
  const neto = precio != null ? precio * (1 - Math.min(100, Math.abs(desc ?? 0)) / 100) : 0;
  if (!(neto > 0) || importe == null || !(importe > 0)) return papel;
  const unidades = Math.round(importe / neto);
  if (unidades < 2 || Math.abs(unidades * neto - importe) > tolerancia(importe)) return papel;
  const bultos = [num(raw?.bultos), num(raw?.cantidad), num(raw?.interpretado?.cantidadOriginal)].find((x) => x != null && x > 0) ?? 0;
  const cada = bultos > 0 ? unidades / bultos : 0;
  if (!Number.isInteger(bultos) || !Number.isInteger(cada) || cada < 2) return papel;
  return { ...papel, bultos, uxb: cada, sueltas: 0 };
}

function papelLeido(raw: any, desc: number | null): Papel {
  const r = raw?.interpretado ?? {};
  // la cantidad del papel: la que leyó el lector (la interpretación pudo corregirla)
  const cant = num(raw?.cantidad) ?? num(r.cantidadOriginal) ?? 0;
  const precio = num(raw?.precio);
  const importe = num(r.importeNeto) ?? num(raw?.importe);
  const iva = num(raw?.alicuotaIva) ?? num(r.alicuotaDeducida);
  const base = { precio, desc, iva, importe };

  // las unidades por bulto: las del papel, o las que usó la interpretación
  let uxb: number | null = [num(raw?.unidadesPorBulto), num(r.unidadesPorBulto), num(r.bultoConsumido), num(raw?.unidadesDelCatalogo)]
    .find((x) => x != null && x > 1) ?? null;
  // «12 blísters» que la interpretación pasó a 24: cada uno trae 2
  if (uxb == null && r.decision === 'cantidad_corregida' && cant > 0 && num(r.cantidad) != null) {
    const q = num(r.cantidad)! / cant;
    if (Number.isInteger(q) && q > 1) uxb = q;
  }
  // BULTOS Y SUELTAS LEÍDOS (5/11/2026, Oxxon, Pronto Manzana «4 | 4»): el
  // lector devuelve aparte los bultos y las sueltas, y a veces la «cantidad» es
  // otra cosa (las unidades por bulto). Si con ellos la cuenta da el importe,
  // ese es el papel; antes se miraba solo la cantidad y salía «0 bultos, 8 sueltas».
  const bultosLeidos = num(raw?.bultos);
  const sueltasLeidas = num(raw?.unidadesSueltas) ?? 0;
  if (uxb != null && bultosLeidos != null && bultosLeidos > 0) {
    const leido = { bultos: bultosLeidos, uxb, sueltas: sueltasLeidas, ...base };
    if (cuentaDelPapel(leido).cierra) return leido;
  }
  if (uxb != null && cant > 0) {
    const comoBulto = cuentaDelPapel({ bultos: cant, uxb, sueltas: 0, ...base });
    const talCual = cuentaDelPapel({ bultos: 0, uxb: null, sueltas: cant, ...base });
    // son bultos si la cuenta cierra contando las de adentro (o se acerca más)
    const masCerca = importe != null && Math.abs(comoBulto.cuenta - importe) < Math.abs(talCual.cuenta - importe);
    if (comoBulto.cierra || (!talCual.cierra && masCerca)) return { bultos: cant, uxb, sueltas: 0, ...base };
    // la cantidad ya está en unidades: el ×N queda a la vista como dato
    return { bultos: 0, uxb, sueltas: cant, ...base };
  }
  return { bultos: 0, uxb: null, sueltas: cant > 0 ? cant : null, ...base };
}

/**
 * Cómo está entrando HOY un renglón, mirando su cantidad contra lo que dice el
 * papel: la decidió el lector, una persona en la tabla o una tarjeta, da igual.
 * Por decidir (null) si quedó un bulto pendiente.
 */
export function entraDeRenglon(fila: any, papel: Papel): EntraComo {
  const envase = num(fila?.envaseAplicado);
  if (envase != null && envase > 1) return { como: 'cajas', de: envase };
  if ((num(fila?.unidadesPorBulto) ?? 0) > 1) return null;
  const uxb = num(papel.uxb);
  const cant = num(fila?.cantidad);
  const u = unidadesDelPapel(papel);
  if (uxb != null && uxb > 1 && cant != null && cant > 0 && u > 0) {
    const cerca = (a: number, b: number) => Math.abs(a - b) <= 0.001 * Math.max(1, b);
    if (!cerca(cant, u)) {
      // 3 Fuet que son 3 cajas de 10, o 6 cajas de Paty ya abiertas en 24
      if (cerca(cant, u / uxb)) return { como: 'cajas', de: uxb };
      if (cerca(cant, u * uxb)) return { como: 'abiertas', de: uxb };
    }
  }
  return { como: 'unidades' };
}

/**
 * Lo que entra al stock desde lo que dice el papel. Devuelve el renglón con la
 * cantidad, el precio, el importe y la bonificación recalculados, y el bulto ya
 * decidido (nada queda «pendiente»): la cuenta la hizo una persona a la vista.
 */
export function aplicarPapel<T extends Record<string, any>>(fila: T, papel: Papel, entra: EntraComo): T {
  // Nadie dijo todavía cómo entra un renglón con bulto: se corrige lo del papel
  // y el bulto sigue pendiente (no se resuelve en silencio por una corrección
  // de precio o de descuento).
  if (entra === null && (num(papel.uxb) ?? 0) > 1) {
    return {
      ...fila,
      papel,
      cantidad: (num(papel.bultos) ?? 0) + (num(papel.sueltas) ?? 0),
      precio: num(papel.precio) ?? fila.precio,
      importe: papel.importe ?? fila.importe,
      bonificacionPct: papel.desc,
      alicuotaIva: papel.iva,
      unidadesPorBulto: num(papel.uxb),
      bultoAplicado: null,
      envaseAplicado: null,
    };
  }
  const unidades = unidadesDelPapel(papel);
  const precio = num(papel.precio);
  const comoCajas = entra?.como === 'cajas' && entra.de > 1 ? entra.de : null;
  const abiertas = entra?.como === 'abiertas' && entra.de > 1 ? entra.de : null;
  const cantidad = comoCajas ? redondear(unidades / comoCajas, 3) : abiertas ? unidades * abiertas : unidades;
  const precioStock = precio == null ? null : comoCajas ? redondear(precio * comoCajas) : abiertas ? redondear(precio / abiertas) : precio;
  const enBultos = !comoCajas && (num(papel.bultos) ?? 0) > 0 && (num(papel.uxb) ?? 0) > 1;
  return {
    ...fila,
    papel,
    cantidad,
    precio: precioStock ?? fila.precio,
    importe: papel.importe ?? fila.importe,
    bonificacionPct: papel.desc,
    alicuotaIva: papel.iva,
    // el bulto queda decidido a la vista: ni pendiente ni descartado
    unidadesPorBulto: null,
    bultoAplicado: abiertas ?? (enBultos ? num(papel.uxb) : null),
    bultoDescartado: null,
    bultoDescartadoComo: null,
    precioAntesDelBulto: null,
    cantidadCorregida: null,
    envaseAplicado: comoCajas,
  };
}

// ---- cambios pedidos por la IA (el chat de la factura) ----

/** Los nombres de campo que usa la IA → los del papel. */
const CAMPO_IA: Record<string, CampoPapel> = {
  bultos: 'bultos', unidadesPorBulto: 'uxb', sueltas: 'sueltas', precio: 'precio',
  descuentoPct: 'desc', alicuotaIva: 'iva', importe: 'importe',
};

/** El impuesto interno por unidad del papel que tiene cargado el renglón; null si no lo tiene. */
export function internoUnitarioDe(fila: any): number | null {
  if (!(Number(fila?.fraccionNeta) > 0)) return null;
  const unidades = unidadesDelPapel(fila.papel ?? papelDeLectura(fila));
  return unidades > 0 ? redondear((num(fila.internosDelPapel) ?? 0) / unidades) : 0;
}

/**
 * CIGARRILLOS Y TABACO (5/11/2026). El papel imprime por renglón el neto, el
 * IVA y el impuesto interno por unidad, y el «Precio Unit» es la suma de los
 * tres. Leandro: «¿toma el neto en vez del precio unitario?». El renglón queda
 * COMO EL PAPEL (precio = «Precio Unit», importe = «Total») y guarda aparte qué
 * parte del precio es neto y cuánto interno trae, para controlar el IVA y los
 * internos contra el pie y repartir la percepción.
 *
 * Si lo que quedó cargado como precio es el neto (pasó el 5/11 a las 16:41: el
 * chat lo había cambiado por su cuenta), vuelve al «Precio Unit»: un precio que
 * ya trae el interno adentro es siempre mayor que el interno.
 */
export function conInternoDelPapel<T extends Record<string, any>>(fila: T, interno: number): T | null {
  const papel: Papel = { ...(fila.papel ?? papelDeLectura(fila)) };
  const unidades = unidadesDelPapel(papel);
  const precio = num(papel.precio);
  if (!(unidades > 0) || precio == null || !(precio > 0) || !(interno >= 0)) return null;
  const alicuota = (num(papel.iva) ?? 0) > 0 ? (num(papel.iva) as number) : 21;
  const conIva = 1 + alicuota / 100;
  const eraNeto = interno > 0 && precio <= interno;
  const neto = eraNeto ? precio : (precio - interno) / conIva;
  if (!(neto > 0)) return null;
  const final = eraNeto ? redondear(precio * conIva + interno) : precio;
  if (eraNeto) {
    papel.precio = final;
    papel.importe = cuentaDelPapel({ ...papel, importe: null }).cuenta;
  }
  papel.iva = alicuota;
  return aplicarPapel(
    { ...fila, fraccionNeta: neto / final, netoDelPapel: redondear(neto), internosDelPapel: redondear(unidades * interno), llevaInternos: null },
    papel,
    entraDeRenglon(fila, papel),
  );
}

/**
 * Marca un renglón como DEVOLUCIÓN al proveedor, o lo vuelve a lo que era
 * (3/11/2026). Una devolución guarda cantidad, precio e importe en positivo: el
 * signo lo pone la marca. No tiene papel (no se cuadra como mercadería que
 * entra) y su «incluir» quiere decir «restar del stock». Al desmarcarla vuelve
 * exactamente a como estaba: si el lector la había tomado como descuento,
 * vuelve a ser descuento.
 */
export function marcarComoDevolucion<T extends Record<string, any>>(fila: T, si: boolean): T {
  if (!si) {
    if (!fila.esDevolucion) return fila;
    const { _antesDeDevolucion: antes, ...resto } = fila as any;
    return (antes
      ? { ...resto, ...antes, esDevolucion: false }
      : { ...resto, esDevolucion: false, incluir: false, papel: papelDeLectura(resto) }) as T;
  }
  if (fila.esDevolucion) return fila;
  const cantidad = Math.abs(num(fila.cantidad) ?? 0) || 1;
  const precio = Math.abs(num(fila.precio) ?? 0);
  const importe = Math.abs(num(fila.importe) ?? 0) || (precio ? cantidad * precio : null);
  return {
    ...fila,
    _antesDeDevolucion: { esDescuento: fila.esDescuento, noAplicar: fila.noAplicar, cantidad: fila.cantidad, precio: fila.precio, importe: fila.importe, papel: fila.papel, incluir: fila.incluir },
    esDevolucion: true, esDescuento: false, noAplicar: false,
    cantidad, precio, importe, papel: null,
    incluir: !!fila.sku && !fila.sugerido,
  };
}

export type CambioIA = { renglon: number; campo: string; valor: unknown; motivo?: string };
export type Registro = { renglon: number; campo: string; antes: unknown; despues: unknown; motivo: string };

/**
 * Aplica los cambios que propuso la IA sobre los renglones. `renglon` empieza
 * en 1, como lo ve la persona. Lo que no se entiende se descarta (y no rompe
 * nada): un renglón que no existe, un campo desconocido, un número inválido.
 */
export function aplicarCambiosIA<T extends Record<string, any>>(
  items: T[],
  cambios: CambioIA[],
  esDescuento: (fila: T) => boolean,
): { items: T[]; registros: Registro[]; descartados: CambioIA[] } {
  const nuevos = items.slice();
  const registros: Registro[] = [];
  const descartados: CambioIA[] = [];
  for (const c of cambios ?? []) {
    const k = Math.round(Number(c?.renglon)) - 1;
    const fila = nuevos[k];
    if (!fila) { descartados.push(c); continue; }
    const motivo = String(c.motivo ?? '').slice(0, 300);
    // devolución al proveedor (3/11/2026): se marca o desmarca en cualquier renglón
    if (c.campo === 'esDevolucion') {
      const despues = c.valor === true || c.valor === 'true';
      if (despues !== !!fila.esDevolucion) {
        registros.push({ renglon: k + 1, campo: 'esDevolucion', antes: !!fila.esDevolucion, despues, motivo });
        nuevos[k] = marcarComoDevolucion(fila, despues);
      }
      continue;
    }
    if (fila.esDevolucion) {
      // en una devolución, «ingresa» es «se resta del stock»
      if (c.campo === 'ingresa') {
        const despues = c.valor === true || c.valor === 'true';
        if (despues && !fila.sku) { descartados.push(c); continue; }
        registros.push({ renglon: k + 1, campo: 'restaDelStock', antes: fila.incluir === true, despues, motivo });
        nuevos[k] = { ...fila, incluir: despues };
        continue;
      }
      const n = c.campo === 'unidadesDevueltas' ? num(c.valor) : null;
      if (n == null || !(n > 0)) { descartados.push(c); continue; }
      registros.push({ renglon: k + 1, campo: 'unidadesDevueltas', antes: num(fila.cantidad), despues: n, motivo });
      nuevos[k] = { ...fila, cantidad: n };
      continue;
    }
    if (esDescuento(fila)) {
      if (c.campo !== 'noAplicar') { descartados.push(c); continue; }
      const despues = c.valor === true || c.valor === 'true';
      registros.push({ renglon: k + 1, campo: 'noAplicar', antes: !!fila.noAplicar, despues, motivo });
      nuevos[k] = { ...fila, noAplicar: despues };
      continue;
    }
    // LLEGÓ UNA PARTE (4/11/2026, el Pronto Manzana de Oxxon: facturadas 36,
    // llegaron 28). El papel y la plata no se tocan: al stock entran las que
    // llegaron y la factura espera la nota de crédito por las que faltaron.
    // «recibidas» = todas (o nada) borra la marca.
    if (c.campo === 'recibidas') {
      const n = c.valor == null || c.valor === '' ? null : num(c.valor);
      if (n != null && !(n >= 0)) { descartados.push(c); continue; }
      const facturadas = fila.papel || !fila.porPeso ? cuentaDelPapel(fila.papel ?? papelDeLectura(fila)).unidades : num(fila.cantidad) ?? 0;
      if (n != null && facturadas > 0 && n > facturadas) { descartados.push(c); continue; }
      const nuevo = n == null || n === facturadas ? null : n;
      registros.push({ renglon: k + 1, campo: 'recibidas', antes: num(fila.recibidoAMano), despues: nuevo, motivo });
      nuevos[k] = { ...fila, recibidoAMano: nuevo };
      continue;
    }
    // POR PESO (4/11/2026, el jamón de Oxxon): «le escribimos en el chat y no nos
    // da bola». El chat no tenía cómo pasar un renglón a kilos y el cambio se
    // descartaba callado. Con los kilos, la cantidad pasa a kg y el costo pasa a
    // ser por kilo; el importe del renglón no cambia (igual que «por peso» a mano).
    if (c.campo === 'kilos') {
      const kg = num(c.valor);
      if (kg == null || !(kg > 0)) { descartados.push(c); continue; }
      const importe = Math.abs(num(fila.importe) ?? 0) || (num(fila.cantidad) ?? 0) * Math.abs(num(fila.precio) ?? 0);
      if (!(importe > 0)) { descartados.push(c); continue; }
      registros.push({ renglon: k + 1, campo: 'kilos', antes: fila.porPeso ? num(fila.cantidad) : null, despues: kg, motivo });
      nuevos[k] = {
        ...fila,
        antesDePeso: fila.antesDePeso ?? { cantidad: fila.cantidad, precio: fila.precio, importe: fila.importe },
        cantidad: Math.round(kg * 1000) / 1000,
        precio: Math.round((importe / kg) * 100) / 100,
        importe,
        porPeso: true,
        cantidadCorregida: null,
        bultoConsumido: null,
      };
      continue;
    }
    // «no ingresó»: el renglón sigue en la factura tal cual (cuenta para el pie)
    // pero no entra al stock. No se tocan las cantidades del papel.
    if (c.campo === 'ingresa') {
      const despues = c.valor === true || c.valor === 'true';
      if (despues && !fila.sku) { descartados.push(c); continue; }
      registros.push({ renglon: k + 1, campo: 'ingresa', antes: fila.incluir !== false, despues, motivo });
      nuevos[k] = { ...fila, incluir: despues };
      continue;
    }
    // EL COSTO LO DICE LA PERSONA (5/11/2026, «el chat es poco obediente»): si
    // dice cuánto cuesta la unidad, ese es el costo de ese renglón. null lo saca.
    if (c.campo === 'costoFinal') {
      const n = c.valor == null || c.valor === '' ? null : num(c.valor);
      if (n != null && !(n > 0)) { descartados.push(c); continue; }
      registros.push({ renglon: k + 1, campo: 'costoFinal', antes: num(fila.costoManual), despues: n, motivo });
      nuevos[k] = { ...fila, costoManual: n };
      continue;
    }
    // paga impuestos internos o no (bebidas, alcohol, tabaco), cuando el papel
    // no lo imprime por renglón. null: que lo decida la cuenta.
    if (c.campo === 'llevaInternos') {
      const despues = c.valor == null || c.valor === '' ? null : c.valor === true || c.valor === 'true';
      registros.push({ renglon: k + 1, campo: 'llevaInternos', antes: fila.llevaInternos ?? null, despues, motivo });
      nuevos[k] = { ...fila, llevaInternos: despues };
      continue;
    }
    // CIGARRILLOS (5/11/2026): el papel imprime el impuesto interno por unidad y
    // el «Precio Unit» ya lo trae adentro, con el IVA. Ver conInternoDelPapel.
    if (c.campo === 'impuestoInternoUnitario') {
      const interno = c.valor == null || c.valor === '' ? null : num(c.valor);
      if (interno != null && !(interno >= 0)) { descartados.push(c); continue; }
      const antes = internoUnitarioDe(fila);
      if (interno == null) {
        registros.push({ renglon: k + 1, campo: 'impuestoInternoUnitario', antes, despues: null, motivo });
        nuevos[k] = { ...fila, fraccionNeta: null, netoDelPapel: null, internosDelPapel: null };
        continue;
      }
      const con = conInternoDelPapel(fila, interno);
      if (!con) { descartados.push(c); continue; }
      const antesPapel: Papel = fila.papel ?? papelDeLectura(fila);
      if (num(con.papel?.precio) !== num(antesPapel.precio)) registros.push({ renglon: k + 1, campo: 'precio', antes: antesPapel.precio, despues: con.papel.precio, motivo: 'El «Precio Unit» del papel: neto + IVA + impuesto interno' });
      if (num(con.papel?.importe) !== num(antesPapel.importe)) registros.push({ renglon: k + 1, campo: 'importe', antes: antesPapel.importe, despues: con.papel.importe, motivo: 'Cantidad × «Precio Unit»' });
      registros.push({ renglon: k + 1, campo: 'impuestoInternoUnitario', antes, despues: interno, motivo });
      nuevos[k] = con;
      continue;
    }
    const papel: Papel = { ...(fila.papel ?? papelDeLectura(fila)) };
    const entra: EntraComo = entraDeRenglon(fila, papel);
    if (c.campo === 'entraComo') {
      const de = num(papel.uxb);
      let nuevo: EntraComo | undefined;
      if (c.valor === 'cajas' && de != null && de > 1) nuevo = { como: 'cajas', de };
      else if ((c.valor === 'abiertas' || c.valor === 'abrir') && de != null && de > 1) nuevo = { como: 'abiertas', de };
      else if (c.valor === 'unidades') nuevo = { como: 'unidades' };
      if (!nuevo) { descartados.push(c); continue; }
      registros.push({ renglon: k + 1, campo: 'entraComo', antes: entraDeRenglon(fila, papel)?.como ?? null, despues: nuevo.como, motivo });
      nuevos[k] = aplicarPapel(fila, papel, nuevo);
      continue;
    }
    // se vende en paquetes de N (las Rodesias: caja de 36, paquetes de 3): entra en paquetes
    // y el costo es el de un paquete (10/10/2026)
    if (c.campo === 'unidadesPorVenta') {
      const n = num(c.valor);
      if (n == null || n <= 1 || !Number.isFinite(n)) { descartados.push(c); continue; }
      const nuevo: EntraComo = { como: 'cajas', de: n };
      registros.push({ renglon: k + 1, campo: 'entraComo', antes: entraDeRenglon(fila, papel)?.como ?? null, despues: `paquetes de ${n}`, motivo });
      nuevos[k] = aplicarPapel(fila, papel, nuevo);
      continue;
    }
    // «el importe es lo que da la cuenta» (5/11/2026): la persona dijo el descuento,
    // la cantidad o el precio y el importe leído quedó viejo. Manda su cuenta.
    if (c.campo === 'ajustarImporte') {
      const cuenta = cuentaDelPapel(papel).cuenta;
      if (c.valor === false || c.valor === 'false' || !(cuenta > 0)) { descartados.push(c); continue; }
      if (cuenta !== num(papel.importe)) registros.push({ renglon: k + 1, campo: 'importe', antes: papel.importe, despues: cuenta, motivo });
      papel.importe = cuenta;
      nuevos[k] = aplicarPapel(fila, papel, entra);
      continue;
    }
    const campo = CAMPO_IA[c.campo];
    const valor = c.valor == null ? null : num(c.valor);
    if (!campo || (c.valor != null && valor == null) || (valor != null && valor < 0)) { descartados.push(c); continue; }
    registros.push({ renglon: k + 1, campo, antes: papel[campo], despues: valor, motivo });
    papel[campo] = valor;
    nuevos[k] = aplicarPapel(fila, papel, entra);
  }
  return { items: nuevos, registros, descartados };
}

/** La tabla como la lee la IA: cada renglón con lo del papel, su cuenta y lo que entra al stock. */
export function tablaParaIA(
  items: any[],
  esDescuento: (fila: any) => boolean,
  destino: (idx: number) => string | null,
  // el costo final que ve la persona en pantalla y de dónde sale (22/10/2026: el
  // chat no lo veía y contestaba «ese 5587 no sale de mi tabla»)
  costo?: (idx: number) => { costoFinalConIva: number | null; comoSeCalcula: string | null } | null,
) {
  return items.map((fila, k) => {
    if (fila.esDevolucion) {
      return {
        renglon: k + 1, devolucion: true, codigo: fila.codigo ?? null, descripcion: fila.descripcion, producto: fila.nombre ?? null,
        unidadesQueSalen: num(fila.cantidad), precio: num(fila.precio), importeDevuelto: num(fila.importe),
        restaDelStock: fila.incluir === true && !!fila.sku,
      };
    }
    if (esDescuento(fila)) {
      return { renglon: k + 1, descuento: true, descripcion: fila.descripcion, importe: num(fila.importe), aplicaA: destino(k), noAplicar: !!fila.noAplicar };
    }
    const p: Papel = fila.papel ?? papelDeLectura(fila);
    const c = cuentaDelPapel(p);
    return {
      renglon: k + 1,
      codigo: fila.codigo ?? null,
      descripcion: fila.descripcion,
      producto: fila.nombre ?? null,
      bultos: p.bultos, unidadesPorBulto: p.uxb, sueltas: p.sueltas,
      precio: p.precio, descuentoPct: p.desc, alicuotaIva: p.iva, importe: p.importe,
      unidades: c.unidades, cuenta: c.cuenta, cierra: c.cierra,
      // el precio con el descuento del renglón ya aplicado (lo que la persona espera ver)
      ...((num(p.desc) ?? 0) !== 0 && (num(p.precio) ?? 0) > 0 ? { precioConDescuento: redondear((num(p.precio) as number) * (1 - Math.min(100, Math.abs(num(p.desc) as number)) / 100)) } : {}),
      // cigarrillos: el precio es el «Precio Unit» del papel; aparte, su neto y su interno
      ...(Number(fila.fraccionNeta) > 0 ? { precioConImpuestosAdentro: true, netoPorUnidad: Number(fila.netoDelPapel) || null, impuestoInternoUnitario: internoUnitarioDe(fila) ?? 0 } : {}),
      ...(fila.llevaInternos != null ? { llevaInternos: !!fila.llevaInternos } : {}),
      ...(Number(fila.costoManual) > 0 ? { costoFijadoPorLaPersona: Number(fila.costoManual) } : {}),
      entraComo: entraDeRenglon(fila, p)?.como ?? 'por decidir',
      entraDe: (entraDeRenglon(fila, p) as any)?.de ?? null,
      entraAlStock: { cantidad: num(fila.cantidad), costoNeto: num(fila.precio), porPeso: !!fila.porPeso },
      // la columna de kilos del papel, si la leyó: con eso se pasa a peso
      kgDelPapel: num(fila.kg),
      // llegó una parte: las unidades que entraron de verdad (null = llegaron todas)
      recibidas: num(fila.recibidoAMano),
      ingresa: fila.incluir !== false,
      bonificacionYaEnElPrecio: num(p.descIncluido),
      ...(costo?.(k) ?? {}),
    };
  });
}

// ---- freno de las reglas que se aplican solas ----

/** Lo que costaría la unidad con IVA, según cómo quedó el renglón. */
function costoAproximado(fila: Record<string, any>): number {
  const precio = num(fila?.precio) ?? 0;
  const desc = Math.min(100, Math.abs(num(fila?.bonificacionPct) ?? 0));
  const iva = (num(fila?.alicuotaIva) ?? 0) > 0 ? (num(fila.alicuotaIva) as number) : 21;
  return precio * (1 - desc / 100) * (1 + iva / 100);
}
/** Qué tan lejos queda del costo del catálogo la mejor lectura posible del renglón. */
function lejosDelCatalogo(fila: Record<string, any>, catalogo: number): number {
  const costo = costoAproximado(fila);
  if (!(costo > 0)) return Infinity;
  const n = num(fila?.unidadesPorBulto) ?? 0;
  // con el bulto todavía sin decidir, el renglón puede terminar en la caja o en la unidad
  const lecturas = n > 1 ? [costo, costo / n] : [costo];
  return Math.min(...lecturas.map((c) => Math.abs(Math.log(c / catalogo))));
}

/**
 * UNA REGLA NO PUEDE ROMPER UN RENGLÓN (5/11/2026, Leandro: «se lo explicamos y
 * tampoco, no podemos seguir así»). En Grupo Modo alguien dijo, mirando una
 * factura de cigarrillos, «las cantidades son por paquete»; la regla se guardó
 * para todo el proveedor y al abrir la factura siguiente se aplicó sola también
 * a las barras «X 10u»: les puso 1 por bulto y cada barra pasó a costar la caja
 * entera (+987 %). El lector las había leído bien.
 *
 * Después de un turno AUTOMÁTICO, cada renglón tocado se compara con el costo
 * del catálogo: si quedó a más del triple (o a menos de un tercio) y antes
 * estaba claramente más cerca, ese renglón vuelve a como se leyó. Lo que pide
 * una persona por el chat no pasa por acá: ahí manda ella.
 */
export function frenarReglasAbsurdas<T extends Record<string, any>>(
  antes: T[],
  despues: T[],
  registros: Registro[],
): { items: T[]; registros: Registro[]; frenados: number[] } {
  const items = despues.slice();
  const frenados: number[] = [];
  for (const k of [...new Set(registros.map((g) => g.renglon - 1))]) {
    const a = antes[k];
    const d = despues[k];
    const catalogo = num(a?.costoCatalogo) ?? 0;
    if (!a || !d || !(catalogo > 0)) continue;
    const lejosAntes = lejosDelCatalogo(a, catalogo);
    const lejosDespues = lejosDelCatalogo(d, catalogo);
    if (lejosDespues > Math.log(3) && lejosAntes < lejosDespues - Math.log(2)) {
      items[k] = a;
      frenados.push(k + 1);
    }
  }
  return { items, registros: registros.filter((g) => !frenados.includes(g.renglon)), frenados };
}

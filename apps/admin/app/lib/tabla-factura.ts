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
//
// UNA SOLA CUENTA, EN LA PANTALLA Y EN EL SERVIDOR (18/11/2026, Leandro:
// «siempre encontrás la falla pero nunca encontrás el problema de raíz»). El
// chat decidía en el servidor y la pantalla aplicaba después con esta cuenta,
// que el servidor no tenía: el chat contestaba sin saber qué había pasado con
// lo que mandaba. Este archivo viaja COPIADO a la API
// (apps/api/src/compras/panel/tabla-factura.ts, con scripts/copiar-cuenta-factura.sh)
// para que el chat pruebe cada cambio con la misma cuenta antes de contestar.
// Por eso NO puede importar nada: ni React ni otros archivos del panel. Después
// de tocarlo, corré ese script; un test y el candado de publicar frenan si las
// dos copias no son iguales.
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
  // «ABRIR» ES PARA LO QUE EL PAPEL CUENTA COMO CAJAS CERRADAS (18/11/2026, Oxxon:
  // «QF- PATY CLASICO X (4 UNID)», 1 bulto de 24 a precio de unidad. A «paty clásico
  // un bulto de 24 unidades» el chat mandó «abiertas» y el renglón pasó a 24 × 24 =
  // 576 al precio dividido; lo volvieron a mano). Si la cantidad está en «bultos»,
  // las de adentro ya están contadas (bultos × unidades por bulto) y el precio ya es
  // de cada una: abrir no multiplica de nuevo, entran esas unidades.
  const yaCuentaLasDeAdentro = (num(papel.bultos) ?? 0) > 0;
  const abiertas = entra?.como === 'abiertas' && entra.de > 1 && !yaCuentaLasDeAdentro ? entra.de : null;
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

// ---- cómo lo dice el papel: la unidad del renglón (18/11/2026) ----
// Leandro, con la factura de Luigi Bosca en la pantalla: «toma los bultos como
// suelto, y no se lo puede explicar». El papel decía «5 cajas de 6 a $355.041 la
// caja» y la pantalla mostraba «Bultos 0 · Sueltas 5». El stock entraba bien (30
// botellas): lo que estaba mal era lo que se le mostraba a la persona y al chat.
//
// LA RAÍZ. Esta cuenta nació con «bultos × unidades por bulto + sueltas, y el
// precio SIEMPRE por unidad». Cuando el precio impreso es el de la caja no tiene
// dónde ponerlo: guarda las cajas en «sueltas» (para que cantidad × precio dé el
// importe) y recuerda aparte que «entran abiertas». Ese truco interno era lo que
// se veía. Medido ese día: 63 renglones en 18 facturas de 15 proveedores, y la
// misma frase escrita al chat cuatro veces en tres días («lo que ponés como
// sueltas son bultos»): el chat acomodaba la entrada y la pantalla seguía
// diciendo «sueltas».
//
// Cómo lo resuelven los demás (foros de Odoo y ERPNext, sistemas de facturas de
// gastronomía): cada renglón tiene UNA cantidad, SU unidad y el precio DE ESA
// unidad («5 cajas a $X la caja; cada caja trae 6»). La unidad y el precio van
// siempre juntos. Acá eso es «precioPor»: 'unidad' o 'bulto'.
//
// La cuenta de adentro no cambia (ni lo ya registrado, ni la memoria de los
// artículos): cambia lo que se MUESTRA y lo que se ACEPTA, en la pantalla y en
// el chat, que pasan los dos por estas dos funciones.

export type VistaPapel = Papel & { precioPor: 'unidad' | 'bulto' };

/**
 * El renglón como lo dice el papel. Si el precio impreso es el del bulto, los
 * bultos van en «bultos» (no en «sueltas») y precioPor = 'bulto'.
 */
export function vistaDelPapel(fila: any, papelDado?: Papel | null): VistaPapel {
  const papel: Papel = papelDado ?? fila?.papel ?? papelDeLectura(fila);
  const uxb = num(papel.uxb) ?? 0;
  const sueltas = num(papel.sueltas) ?? 0;
  const enSueltas = uxb > 1 && (num(papel.bultos) ?? 0) === 0 && sueltas > 0;
  if (enSueltas && !fila?.porPeso) {
    const entra = entraDeRenglon(fila, papel);
    // cajas a precio de caja: se abren (entran las de adentro), o el producto del catálogo es la caja
    if (entra?.como === 'abiertas' || fila?.cuentaBultos === true || fila?.bultoDescartadoComo === 'caja') {
      return { ...papel, bultos: sueltas, sueltas: 0, precioPor: 'bulto' };
    }
  }
  return { ...papel, precioPor: 'unidad' };
}

/**
 * Cambia UN dato del renglón tal como lo ve la persona (la vista de arriba) y
 * devuelve el renglón recalculado. La usan la tabla de la pantalla, el chat y
 * el «deshacer»: una sola forma de cambiar el papel. Devuelve un texto si el
 * cambio no se puede hacer (el porqué).
 */
export function cambiarDatoDelPapel<T extends Record<string, any>>(fila: T, campo: CampoPapel | 'precioPor', valor: unknown): T | string {
  const papel: Papel = { ...(fila.papel ?? papelDeLectura(fila)) };
  const entra = entraDeRenglon(fila, papel);
  const vista = vistaDelPapel(fila, papel);
  const precio = num(papel.precio);
  if (campo === 'precioPor') {
    const uxb = num(papel.uxb) ?? 0;
    if (valor !== 'bulto' && valor !== 'unidad') return 'el precio es por «unidad» o por «bulto»';
    if (!(uxb > 1)) return 'el renglón no dice cuántas unidades trae el bulto: primero hay que poner las unidades por bulto';
    if (valor === vista.precioPor) return fila;
    if (valor === 'bulto') {
      // la cantidad del papel son bultos y el precio impreso es el de cada bulto: al stock entran las de adentro
      const b = num(papel.bultos) ?? 0;
      const s = num(papel.sueltas) ?? 0;
      if (b > 0 && s > 0) return 'el renglón tiene bultos y además unidades sueltas: con el precio por bulto no se puede saber cuánto valen las sueltas';
      return { ...aplicarPapel(fila, { ...papel, bultos: 0, sueltas: b > 0 ? b : s }, { como: 'abiertas', de: uxb }), cuentaBultos: true };
    }
    // el precio impreso es el de cada unidad y la cantidad son bultos
    return { ...aplicarPapel(fila, { ...papel, bultos: vista.bultos, sueltas: 0 }, { como: 'unidades' }), cuentaBultos: null };
  }
  const v = valor == null || valor === '' ? null : num(valor);
  if (valor != null && valor !== '' && v == null) return 'el valor tiene que ser un número';
  if (v != null && v < 0) return 'el valor no puede ser negativo';
  if (vista.precioPor === 'bulto' && (campo === 'bultos' || campo === 'sueltas' || campo === 'uxb')) {
    const nueva = { ...vista, [campo]: v };
    const uxb = num(nueva.uxb) ?? 0;
    const b = num(nueva.bultos) ?? 0;
    const s = num(nueva.sueltas) ?? 0;
    // se quedó sin «x N»: ya no hay bulto, la cantidad son unidades al precio impreso
    if (!(uxb > 1)) return { ...aplicarPapel(fila, { ...papel, uxb: null, bultos: 0, sueltas: b + s }, { como: 'unidades' }), cuentaBultos: null };
    // bultos a precio de bulto MÁS unidades sueltas: la misma plata dicha por unidad
    if (s > 0) {
      if (precio == null) return 'falta el precio del renglón';
      return { ...aplicarPapel(fila, { ...papel, uxb, bultos: b, sueltas: s, precio: redondear(precio / uxb, 4) }, { como: 'unidades' }), cuentaBultos: null };
    }
    // por dentro los bultos a precio de bulto van en «sueltas»; si se abrían, se siguen abriendo
    const sigue: EntraComo = entra?.como === 'abiertas' ? { como: 'abiertas', de: uxb } : { como: 'unidades' };
    return { ...aplicarPapel(fila, { ...papel, uxb, bultos: 0, sueltas: b }, sigue), cuentaBultos: true };
  }
  (papel as any)[campo] = v;
  return aplicarPapel(fila, papel, entra);
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

/** `porque`: por qué no se pudo aplicar, en palabras (lo pone aplicarCambiosIA al descartarlo). */
export type CambioIA = { renglon: number; campo: string; valor: unknown; motivo?: string; porque?: string };
export type Registro = { renglon: number; campo: string; antes: unknown; despues: unknown; motivo: string };

// ---- llegó una parte (4/11/2026) ----

/**
 * LO FACTURADO DE UN RENGLÓN, contado como entra al stock: los KILOS si va por
 * peso, las unidades del papel si no.
 *
 * 18/11/2026, Conallison: la carne se pasó a kilos por el chat (4,52 kg de rack)
 * y Ana dijo «entraron 3,475 kg». Se comparaba contra las unidades del papel
 * (1 pieza): 3,475 > 1 → «el valor no es válido para ese dato», tres veces, con
 * el chat contestando «ahora sí». La factura quedó sin cargar. Un renglón por
 * peso se mide en kilos en TODOS lados: acá, en lo que entra y en lo que falta.
 */
export function facturadoDe(fila: any): number {
  if (fila?.porPeso) return num(fila.cantidad) ?? 0;
  return fila?.papel ? cuentaDelPapel(fila.papel).unidades : num(fila?.cantidad) ?? 0;
}

/** Lo que faltó en la entrega (0 si llegó todo): lo facturado menos lo que entró. */
export function faltanteDe(fila: any): number {
  const r = num(fila?.recibidoAMano) ?? 0;
  const u = facturadoDe(fila);
  return r > 0 && u > 0 && r < u ? redondear(u - r, 3) : 0;
}

/** Lo que entra al stock: lo que llegó, en la unidad del stock. */
export function cantidadQueEntra(fila: any): number {
  const cant = num(fila?.cantidad) ?? 0;
  const u = facturadoDe(fila);
  const f = faltanteDe(fila);
  return f > 0 ? redondear(cant * ((u - f) / u), 3) : cant;
}

// ---- juntar renglones (18/11/2026) ----
// Distribuidora City factura los Saphirus un renglón por aroma (46 de 54) y ODB
// los tiene como tres productos: Textil, Difusor y Aerosol. Ana lo pidió el
// 10/11 («LO QUE QUIERO ES QUE SEA UN SOLO RENGLÓN») y otra vez el 18/11. No
// había cómo: el chat dejaba los demás renglones en cero, quedaban marcados «no
// cierra», el registro se trababa y hubo que volver todo atrás (20 minutos, 6
// mensajes). Ahora un renglón se junta con otro de verdad: el destino suma sus
// unidades y su importe (la plata de la factura no cambia) y el que se juntó
// deja de contar y de verse. Todo se puede separar.

const CAMPOS_DE_JUNTAR = ['papel', 'cantidad', 'precio', 'importe', 'bonificacionPct', 'alicuotaIva', 'unidadesPorBulto', 'bultoAplicado', 'bultoDescartado', 'bultoDescartadoComo', 'precioAntesDelBulto', 'cantidadCorregida', 'envaseAplicado', 'incluir'] as const;
const fotoDe = (fila: Record<string, any>) => Object.fromEntries(CAMPOS_DE_JUNTAR.map((c) => [c, fila[c] ?? null]));
const importeDe = (fila: Record<string, any>) => Math.abs(num(fila?.papel?.importe) ?? num(fila?.importe) ?? 0);

/** Por qué un renglón no se puede juntar con otro; null si se puede. */
function noSeJunta(fila: any, esDescuento: (f: any) => boolean): string | null {
  if (!fila) return 'ese renglón no existe';
  if (esDescuento(fila)) return 'es un renglón de descuento';
  if (fila.esDevolucion) return 'es una devolución';
  if (fila.juntadoEn) return `ya está junto con el renglón ${fila.juntadoEn}`;
  if (fila.porPeso) return 'va por peso';
  if (Number(fila.fraccionNeta) > 0) return 'trae el impuesto interno por unidad';
  if ((num(fila.unidadesPorBulto) ?? 0) > 1) return 'todavía no se decidió cómo entra su bulto';
  if (fila.devueltoAMano || (num(fila.recibidoAMano) ?? 0) > 0) return 'tiene marcado que no llegó entero';
  if (!((num(fila.cantidad) ?? 0) > 0)) return 'no tiene unidades';
  if (!(importeDe(fila) > 0)) return 'no tiene importe';
  // lo marca la pantalla al mandar las filas al chat: un descuento de otro renglón cae sobre este
  if (fila._conDescuentoEncima) return 'tiene un descuento aplicado en otro renglón de la factura';
  // ya lleva adentro lo sin cargo de otro renglón (21/11/2026): rehacerlo como suma común lo perdería
  if (Array.isArray(fila.regalos) && fila.regalos.length) return 'ya lleva adentro lo sin cargo de otro renglón: separalo primero';
  return null;
}

/** El destino como estaba antes de juntar nada, más lo que se le juntó. */
function conLoJuntado<T extends Record<string, any>>(base: T, junta: { renglon: number; unidades: number; importe: number }[]): T {
  if (!junta.length) return { ...base, junta: null, antesDeJuntar: null };
  const unidades = redondear((num(base.cantidad) ?? 0) + junta.reduce((s, x) => s + x.unidades, 0), 3);
  const importe = redondear(importeDe(base) + junta.reduce((s, x) => s + x.importe, 0));
  // el precio es el promedio de lo juntado; si con dos decimales la cuenta no da el importe, con cuatro
  let precio = redondear(importe / unidades);
  if (Math.abs(precio * unidades - importe) > tolerancia(importe)) precio = redondear(importe / unidades, 4);
  const papel: Papel = { bultos: 0, uxb: null, sueltas: unidades, precio, desc: null, iva: (base.papel ?? papelDeLectura(base)).iva, importe };
  return { ...aplicarPapel(base, papel, { como: 'unidades' }), junta, antesDeJuntar: fotoDe(base) };
}

/** Un renglón juntado vuelve a ser un renglón aparte, como estaba; el destino lo descuenta. */
export function separarRenglon<T extends Record<string, any>>(items: T[], k: number): T[] {
  const fila = items[k];
  if (!fila?.juntadoEn) return items;
  // lo sin cargo (o su «Descuento») se separa con todo lo sin cargo de ese renglón
  if (fila.regaloJuntado) return separarRegalos(items, Math.round(Number(fila.juntadoEn)) - 1);
  const nuevos = items.slice();
  const d = Math.round(Number(fila.juntadoEn)) - 1;
  nuevos[k] = { ...fila, ...(fila.antesDeJuntar ?? {}), juntadoEn: null, antesDeJuntar: null };
  const destino = nuevos[d];
  if (destino && Array.isArray(destino.junta)) {
    const base = { ...destino, ...(destino.antesDeJuntar ?? {}) };
    nuevos[d] = conLoJuntado(base, destino.junta.filter((x: any) => x.renglon !== k + 1));
  }
  return nuevos;
}

// ---- lo sin cargo entra junto con lo que se paga (21/11/2026) ----
// Distri-Sur imprime así «60 Ferrero T12 y te regalo 12»: un renglón con las 12
// a precio de lista, abajo un «Descuento» que lo anula entero y después el
// renglón de las 60 que se pagan. Anabella lo explicó cada vez («sumamos el
// renglón bonificado que trae 12 + el que trae 60 = 72, lo dividimos en cajas de
// 12, entran 6 cajas»; «el precio se bonifica, pero la cantidad se suma»). La
// pantalla mostraba dos renglones: el regalo a $0 y lo pago a precio lleno
// ($13.911 la caja), con cajas partidas (0,75 + 5,25 de T8). Recién al registrar
// el sistema los sumaba y promediaba: lo que se veía no era lo que entraba, y el
// chat no podía juntarlos («tiene un descuento encima»). 19/11: 47 minutos, 17
// mensajes, la factura sin registrar.
//
// Lo que dice la contabilidad (NIC 2: el costo de adquisición va neto de
// descuentos, rebajas y partidas similares; 1.000 a $2 más 50 sin cargo son
// 1.050 unidades por $2.000) y hacen Odoo y ERPNext: lo sin cargo es MÁS
// CANTIDAD del mismo artículo, por la misma plata. Acá: el renglón pago se queda
// con todas las unidades (60 + 12 = 72) y con su importe ($53.919,60), y lo sin
// cargo pasa a ser su bonificación (12 de 72 = 16,67 %). Así la cuenta del papel
// cierra, la caja cuesta $8.986,60 + impuestos y las cajas no se parten. El
// regalo y su «Descuento» suman cero: la plata de la factura no cambia.
//
// Se juntan solos al abrir la factura cuando es el mismo artículo (misma
// descripción, o el mismo producto vinculado) al mismo precio. Todo se separa
// con un toque; el chat también puede juntar o separar.

export type ParRegalo = {
  /** el renglón que va sin cargo (desde 0) */
  regalo: number;
  /** el renglón «Descuento» que lo anula (desde 0), o null si el 100 % está en el mismo renglón */
  descuento: number | null;
  /** dónde se junta (desde 0); si no se dice, el renglón pago del mismo artículo */
  en?: number | null;
};

const textoDelArticulo = (t: unknown) =>
  String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const papelDe = (fila: any): Papel => fila.papel ?? papelDeLectura(fila);

/** El renglón entero va sin cargo en el mismo renglón: 100 % de bonificación. */
export function esSinCargoEnElRenglon(fila: any): boolean {
  if (!fila || fila.esDescuento || fila.esDevolucion || fila.juntadoEn || fila.porPeso) return false;
  const p = papelDe(fila);
  return unidadesDelPapel(p) > 0 && (num(p.precio) ?? 0) > 0 && (num(p.desc) ?? 0) >= 99.5;
}

/** Por qué este renglón no puede recibir lo sin cargo de otro; null si puede. */
function noRecibeRegalo(fila: any, esDescuento: (f: any) => boolean): string | null {
  if (!fila) return 'ese renglón no existe';
  if (esDescuento(fila)) return 'es un renglón de descuento';
  if (fila.esDevolucion) return 'es una devolución';
  if (fila.juntadoEn) return `está junto con el renglón ${fila.juntadoEn}`;
  if (fila.porPeso) return 'va por peso';
  if (Number(fila.fraccionNeta) > 0) return 'trae el impuesto interno por unidad';
  if (fila.devueltoAMano || (num(fila.recibidoAMano) ?? 0) > 0) return 'tiene marcado que no llegó entero';
  if (Array.isArray(fila.junta) && fila.junta.length) return 'ya junta otros renglones: separalos primero';
  if (esSinCargoEnElRenglon(fila)) return 'también va sin cargo';
  const p = papelDe(fila);
  if (!(unidadesDelPapel(p) > 0) || !((num(p.importe) ?? 0) > 0)) return 'no tiene unidades pagas';
  return null;
}

/** Lo que el proveedor llama igual y cobra igual: el mismo artículo. */
function mismoArticulo(a: any, b: any): boolean {
  const pa = papelDe(a);
  const pb = papelDe(b);
  const precioA = num(pa.precio) ?? 0;
  const precioB = num(pb.precio) ?? 0;
  if (!(precioA > 0) || !(precioB > 0) || Math.abs(precioA - precioB) > Math.max(0.02, precioA * 0.003)) return false;
  const ivaA = num(pa.iva);
  const ivaB = num(pb.iva);
  if (ivaA != null && ivaB != null && ivaA !== ivaB) return false;
  const texto = textoDelArticulo(a.descripcion);
  return (!!texto && texto === textoDelArticulo(b.descripcion)) || (!!a.sku && a.sku === b.sku);
}

/**
 * Junta cada renglón sin cargo con el renglón pago del mismo artículo. Devuelve
 * los renglones y, por cada par que no se pudo juntar, el porqué. El renglón sin
 * cargo y su «Descuento» quedan en cero, con `juntadoEn` (no se dibujan ni
 * cuentan); el pago se queda con todas las unidades, su importe y la
 * bonificación que eso da. Lo de antes queda guardado para separarlo.
 */
export function juntarRegalos<T extends Record<string, any>>(
  items: T[],
  pares: ParRegalo[],
  esDescuento: (fila: T) => boolean,
): { items: T[]; juntados: { regalo: number; descuento: number | null; en: number; unidades: number }[]; noJuntados: { regalo: number; porque: string }[] } {
  const nuevos = items.slice();
  const juntados: { regalo: number; descuento: number | null; en: number; unidades: number }[] = [];
  const noJuntados: { regalo: number; porque: string }[] = [];
  const sonRegalo = new Set(pares.map((p) => p.regalo));
  for (const par of pares) {
    const g = par.regalo;
    const regalo = nuevos[g];
    const no = (porque: string) => noJuntados.push({ regalo: g, porque });
    if (!regalo || esDescuento(regalo) || regalo.esDevolucion) { no('no es un renglón de mercadería'); continue; }
    if (regalo.juntadoEn) { no(`ya está junto con el renglón ${regalo.juntadoEn}`); continue; }
    if (regalo.porPeso) { no('va por peso'); continue; }
    if (regalo.devueltoAMano || (num(regalo.recibidoAMano) ?? 0) > 0) { no('tiene marcado que no llegó entero'); continue; }
    const d = par.descuento;
    const desc = d != null ? nuevos[d] : null;
    if (d != null && (!desc || !esDescuento(desc) || desc.juntadoEn)) { no('el renglón de descuento no está'); continue; }
    if (d == null && !esSinCargoEnElRenglon(regalo)) { no('no va sin cargo'); continue; }
    const gp = papelDe(regalo);
    const uRegalo = unidadesDelPapel(gp);
    if (!(uRegalo > 0)) { no('no tiene unidades'); continue; }
    // dónde: el que se dijo, o el primero pago del mismo artículo después del descuento (así lo imprime
    // Distri-Sur), o si no hay, el más cercano de arriba
    let en: number | null = null;
    if (par.en != null) {
      const porque = noRecibeRegalo(nuevos[par.en], esDescuento);
      if (porque) { no(`el renglón ${par.en + 1} ${porque}`); continue; }
      if (!mismoArticulo(regalo, nuevos[par.en])) { no(`el renglón ${par.en + 1} no es el mismo artículo al mismo precio`); continue; }
      en = par.en;
    } else {
      const candidato = (k: number) => k !== g && !sonRegalo.has(k) && !noRecibeRegalo(nuevos[k], esDescuento) && mismoArticulo(regalo, nuevos[k]);
      const desde = Math.max(g, d ?? g) + 1;
      for (let k = desde; k < nuevos.length && en == null; k++) if (candidato(k)) en = k;
      for (let k = g - 1; k >= 0 && en == null; k--) if (candidato(k)) en = k;
      if (en == null) { no('no hay otro renglón del mismo artículo al mismo precio'); continue; }
    }
    const pago = nuevos[en];
    const pp = papelDe(pago);
    // Las unidades del regalo, dichas como las cuenta el pago. Con su importe impreso
    // (Distri-Sur: el «Descuento» va aparte) la cuenta las prueba. Con el 100 % en el
    // mismo renglón el importe es $0 y cualquier lectura «cierra»: «1» podía ser una caja
    // o seis botellas (Luigi Bosca 0175-00004531: 5 cajas pagas a precio de caja y 1 de
    // regalo leída como 6 botellas). Al mismo precio impreso, la columna Cantidad cuenta
    // lo mismo en los dos renglones: el regalo suma lo que dice esa columna.
    const regaloSinImporte = !((num(gp.importe) ?? 0) > 0);
    const enBultosElPago = (num(pp.bultos) ?? 0) > 0;
    const mismoBulto = enBultosElPago && (num(gp.bultos) ?? 0) > 0 && num(pp.uxb) === num(gp.uxb);
    const cuantos = (num(gp.bultos) ?? 0) + (num(gp.sueltas) ?? 0);
    const papel: Papel = regaloSinImporte
      ? (enBultosElPago ? { ...pp, bultos: (num(pp.bultos) ?? 0) + cuantos } : { ...pp, sueltas: (num(pp.sueltas) ?? 0) + cuantos })
      : mismoBulto
      ? { ...pp, bultos: (num(pp.bultos) ?? 0) + (num(gp.bultos) ?? 0), sueltas: (num(pp.sueltas) ?? 0) + (num(gp.sueltas) ?? 0) }
      : { ...pp, sueltas: (num(pp.sueltas) ?? 0) + uRegalo };
    const unidadesDelRegalo = redondear(unidadesDelPapel(papel) - unidadesDelPapel(pp), 3);
    const importe = num(pp.importe) as number;
    const lista = unidadesDelPapel(papel) * (num(pp.precio) as number);
    papel.importe = importe;
    papel.desc = redondear((1 - importe / lista) * 100, 6);
    // cómo entra (unidades, cajas de N, abiertas) sigue igual: ahora con todas las unidades
    const entra = entraDeRenglon(pago, pp);
    const regalos = [...(Array.isArray(pago.regalos) ? pago.regalos : []), { renglon: g + 1, descuento: d != null ? d + 1 : null, unidades: unidadesDelRegalo }];
    nuevos[en] = { ...aplicarPapel(pago, papel, entra), regalos, antesDelRegalo: pago.antesDelRegalo ?? fotoDe(pago) };
    const vacio: Papel = { ...gp, bultos: 0, sueltas: 0, importe: 0 };
    nuevos[g] = {
      ...aplicarPapel(regalo, vacio, { como: 'unidades' }),
      cantidad: 0, importe: 0, incluir: false,
      juntadoEn: en + 1, regaloJuntado: { descuento: d != null ? d + 1 : null }, antesDeJuntar: fotoDe(regalo),
    };
    if (d != null && desc) {
      nuevos[d] = {
        ...desc, cantidad: 0, precio: 0, importe: 0,
        juntadoEn: en + 1, regaloJuntado: { regalo: g + 1 },
        antesDeJuntar: { cantidad: desc.cantidad ?? null, precio: desc.precio ?? null, importe: desc.importe ?? null },
      };
    }
    juntados.push({ regalo: g, descuento: d, en, unidades: unidadesDelRegalo });
  }
  return { items: nuevos, juntados, noJuntados };
}

/** Lo sin cargo que tiene adentro un renglón vuelve a sus renglones, como estaban. */
export function separarRegalos<T extends Record<string, any>>(items: T[], k: number): T[] {
  const pago = items[k];
  if (!pago || !Array.isArray(pago.regalos) || !pago.regalos.length) return items;
  const nuevos = items.slice();
  const vuelve = (j: number | null) => {
    const f = j != null ? nuevos[j] : null;
    if (j == null || !f || Number(f.juntadoEn) !== k + 1 || !f.regaloJuntado) return;
    nuevos[j] = { ...f, ...(f.antesDeJuntar ?? {}), juntadoEn: null, antesDeJuntar: null, regaloJuntado: null };
  };
  for (const r of pago.regalos) {
    vuelve(Number(r.renglon) - 1);
    if (r.descuento != null) vuelve(Number(r.descuento) - 1);
  }
  nuevos[k] = { ...pago, ...(pago.antesDelRegalo ?? {}), regalos: null, antesDelRegalo: null };
  return nuevos;
}

/** Cuántas de las unidades del renglón van sin cargo (las que se le juntaron). */
export const sinCargoDe = (fila: any): number =>
  Array.isArray(fila?.regalos) ? fila.regalos.reduce((s: number, r: any) => s + (num(r?.unidades) ?? 0), 0) : 0;

/**
 * Los pares regalo → descuento de una factura, desde a qué renglón fue cada
 * rebaja (lo decide atribuirDescuentos, en el panel): las que anulan un renglón
 * entero («regalo») y los renglones con 100 % de bonificación.
 */
export function paresDeRegalo(items: any[], destinos: Map<number, { renglon: number; motivo: string }>): ParRegalo[] {
  const pares: ParRegalo[] = [];
  for (const [d, x] of destinos) if (x.motivo === 'regalo') pares.push({ regalo: x.renglon, descuento: d });
  items.forEach((f, k) => { if (esSinCargoEnElRenglon(f) && !pares.some((p) => p.regalo === k)) pares.push({ regalo: k, descuento: null }); });
  return pares.sort((a, b) => a.regalo - b.regalo);
}

/**
 * AL ABRIR LA FACTURA (21/11/2026): lo que leyó el sistema queda como vino (es la base
 * del borrador); encima de lo que ya hizo la persona (`b`, el borrador ya aplicado a
 * `filas`), cada renglón sin cargo se junta con su pago. El juntado queda en el
 * borrador como cualquier cambio, así que al volver a abrir ya está hecho y no se
 * repite. No se junta lo que la persona separó (cambio «sinCargo» en la constancia)
 * ni un par cuya cuenta ya tocó (lo de antes de este arreglo: queda como lo dejó).
 */
const CAMPOS_DE_LA_CUENTA = ['papel', 'cantidad', 'precio', 'importe', 'bonificacionPct', 'juntadoEn', 'junta', 'envaseAplicado', 'unidadesPorBulto', 'bultoAplicado', 'esDescuento', 'noAplicar', 'esDevolucion', 'recibidoAMano', 'devueltoAMano', 'incluir'];
export function regalosAlAbrir<T extends Record<string, any>>(
  filas: T[],
  b: { renglones?: { renglon: number; campos?: Record<string, unknown> }[]; cambios?: unknown[] } | null | undefined,
  destinos: Map<number, { renglon: number; motivo: string }>,
  esDescuento: (fila: T) => boolean,
): T[] {
  const tocados = new Set<number>((b?.renglones ?? [])
    .filter((r) => r?.campos && Object.keys(r.campos).some((k) => CAMPOS_DE_LA_CUENTA.includes(k)))
    .map((r) => Number(r.renglon)));
  const separados = new Set<number>((Array.isArray(b?.cambios) ? (b!.cambios as any[]) : [])
    .filter((c) => c?.campo === 'sinCargo' && !c.deshecho && c.renglon != null)
    .map((c) => Number(c.renglon) - 1));
  const prueba = juntarRegalos(filas, paresDeRegalo(filas, destinos), esDescuento);
  const libres = prueba.juntados.filter((j) => !separados.has(j.en) && ![j.regalo, j.descuento, j.en].some((k) => k != null && tocados.has(k)));
  if (libres.length === prueba.juntados.length) return prueba.items;
  return juntarRegalos(filas, libres.map((j) => ({ regalo: j.regalo, descuento: j.descuento, en: j.en })), esDescuento).items;
}

/**
 * Aplica los cambios que propuso la IA sobre los renglones. `renglon` empieza
 * en 1, como lo ve la persona. Lo que no se entiende se descarta (y no rompe
 * nada): un renglón que no existe, un campo desconocido, un número inválido.
 */
export function aplicarCambiosIA<T extends Record<string, any>>(
  items: T[],
  cambios: CambioIA[],
  esDescuento: (fila: T) => boolean,
): { items: T[]; registros: Registro[]; descartados: CambioIA[]; aceptados: CambioIA[] } {
  const nuevos = items.slice();
  const registros: Registro[] = [];
  const descartados: CambioIA[] = [];
  const rechazo = new Set<CambioIA>();
  // lo que no se aplica vuelve con el porqué: la pantalla se lo dice a la persona y al chat
  const descartar = (c: CambioIA, porque: string) => { descartados.push({ ...c, porque }); rechazo.add(c); };
  for (const c of cambios ?? []) {
    const k = Math.round(Number(c?.renglon)) - 1;
    const fila = nuevos[k];
    if (!fila) { descartar(c, 'ese renglón no existe'); continue; }
    const motivo = String(c.motivo ?? '').slice(0, 300);
    // JUNTAR RENGLONES (18/11/2026): este renglón pasa a estar sumado en otro.
    // «juntarEn» vacío lo separa. El destino puede ir juntando varios.
    if (c.campo === 'juntarEn') {
      if (c.valor == null || c.valor === '' || num(c.valor) === 0) {
        if (!fila.juntadoEn) { descartar(c, 'no está junto con ningún renglón'); continue; }
        registros.push({ renglon: k + 1, campo: 'juntarEn', antes: fila.juntadoEn, despues: null, motivo });
        const separados = separarRenglon(nuevos, k);
        for (let j = 0; j < nuevos.length; j++) nuevos[j] = separados[j];
        continue;
      }
      const d = Math.round(num(c.valor) ?? NaN) - 1;
      const destino = nuevos[d];
      if (!Number.isInteger(d) || !destino) { descartar(c, 'el renglón donde se junta no existe'); continue; }
      if (d === k) { descartar(c, 'un renglón no se junta consigo mismo'); continue; }
      // LO SIN CARGO (21/11/2026): un renglón regalado (anulado por un «Descuento», que la
      // pantalla marca con `_regaloDe`, o con 100 % en el mismo renglón) se junta como regalo:
      // suma unidades al pago del mismo artículo y la plata no cambia
      if ((fila._regaloDe != null && !fila.juntadoEn) || esSinCargoEnElRenglon(fila)) {
        const desc = fila._regaloDe != null ? Math.round(Number(fila._regaloDe)) : null;
        const r = juntarRegalos(nuevos, [{ regalo: k, descuento: desc, en: d }], esDescuento);
        if (!r.juntados.length) { descartar(c, r.noJuntados[0]?.porque ?? 'no se pudo juntar'); continue; }
        for (let j = 0; j < nuevos.length; j++) nuevos[j] = r.items[j];
        registros.push({ renglon: k + 1, campo: 'juntarEn', antes: null, despues: d + 1, motivo });
        // su «Descuento» también queda adentro: si algo frena el cambio, vuelven los tres juntos
        if (desc != null) registros.push({ renglon: desc + 1, campo: 'juntarEn', antes: null, despues: d + 1, motivo: motivo || 'el descuento que lo dejaba sin cargo' });
        continue;
      }
      if (Array.isArray(fila.junta) && fila.junta.length) { descartar(c, 'ese renglón ya junta a otros: juntá los demás en él'); continue; }
      const pega = noSeJunta(fila, esDescuento);
      if (pega) { descartar(c, pega); continue; }
      const pegaDestino = noSeJunta(destino, esDescuento);
      if (pegaDestino) { descartar(c, `el renglón ${d + 1} ${pegaDestino}`); continue; }
      const ivaDe = (f: any) => num((f.papel ?? papelDeLectura(f)).iva);
      if (ivaDe(fila) !== ivaDe(destino)) { descartar(c, `no tiene el mismo IVA que el renglón ${d + 1}`); continue; }
      // sin producto elegido toma el del destino; con producto, los dos tienen que entrar (o ninguno)
      const entra = (f: any) => f.incluir !== false && !!f.sku;
      if (fila.sku && !destino.sku) { descartar(c, `el renglón ${d + 1} no tiene producto elegido: juntalos en uno que lo tenga`); continue; }
      if (fila.sku && entra(fila) !== entra(destino)) { descartar(c, 'uno entra al stock y el otro no: no se pueden sumar'); continue; }
      const aporte = { renglon: k + 1, unidades: num(fila.cantidad) as number, importe: importeDe(fila) };
      const base = { ...destino, ...(destino.antesDeJuntar ?? {}) };
      nuevos[d] = conLoJuntado(base, [...(Array.isArray(destino.junta) ? destino.junta : []), aporte]);
      const papelVacio: Papel = { ...(fila.papel ?? papelDeLectura(fila)), bultos: 0, sueltas: 0, importe: 0 };
      nuevos[k] = { ...aplicarPapel(fila, papelVacio, { como: 'unidades' }), cantidad: 0, importe: 0, incluir: false, juntadoEn: d + 1, antesDeJuntar: fotoDe(fila) };
      registros.push({ renglon: k + 1, campo: 'juntarEn', antes: null, despues: d + 1, motivo });
      continue;
    }
    // un renglón juntado en otro ya no cuenta: antes de tocarlo hay que separarlo
    if (fila.juntadoEn) { descartar(c, `ese renglón está junto con el ${fila.juntadoEn}: el cambio va en ese, o separalo primero`); continue; }
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
        if (despues && !fila.sku) { descartar(c, 'la devolución no tiene producto del catálogo elegido'); continue; }
        registros.push({ renglon: k + 1, campo: 'restaDelStock', antes: fila.incluir === true, despues, motivo });
        nuevos[k] = { ...fila, incluir: despues };
        continue;
      }
      const n = c.campo === 'unidadesDevueltas' ? num(c.valor) : null;
      if (n == null || !(n > 0)) { descartar(c, 'en una devolución solo se pueden cambiar las unidades devueltas y si se resta del stock'); continue; }
      registros.push({ renglon: k + 1, campo: 'unidadesDevueltas', antes: num(fila.cantidad), despues: n, motivo });
      nuevos[k] = { ...fila, cantidad: n };
      continue;
    }
    if (esDescuento(fila)) {
      if (c.campo !== 'noAplicar') { descartar(c, 'en un renglón de descuento solo se puede elegir si se aplica o no'); continue; }
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
      if (c.valor != null && c.valor !== '' && (n == null || !(n >= 0))) { descartar(c, 'lo que entró tiene que ser un número'); continue; }
      // por peso se cuenta en kilos; si no, en las unidades del papel (18/11/2026, Conallison)
      const facturadas = fila.porPeso || fila.papel ? facturadoDe(fila) : cuentaDelPapel(papelDeLectura(fila)).unidades;
      const en = fila.porPeso ? 'kg' : 'unidades';
      if (n === 0) { descartar(c, 'si del renglón no entró nada, se marca que no ingresa («ingresa» = false)'); continue; }
      if (n != null && facturadas > 0 && n > facturadas + 0.0005) { descartar(c, `no pueden entrar más ${en} (${n.toLocaleString('es-AR')}) que las facturadas (${facturadas.toLocaleString('es-AR')})`); continue; }
      const nuevo = n == null || Math.abs(n - facturadas) <= 0.0005 ? null : n;
      registros.push({ renglon: k + 1, campo: 'recibidas', antes: num(fila.recibidoAMano), despues: nuevo, motivo });
      // si llegó una parte, el renglón no volvió entero (9/11/2026, Playadito pintada
      // con «-1»: el lector la marcó devuelta toda): entra lo recibido
      const llegoAlgo = n == null || n > 0;
      nuevos[k] = fila.devueltoAMano && llegoAlgo
        ? { ...fila, recibidoAMano: nuevo, devueltoAMano: false, incluir: !!fila.sku && !fila.sugerido }
        : { ...fila, recibidoAMano: nuevo };
      continue;
    }
    // POR PESO (4/11/2026, el jamón de Oxxon): «le escribimos en el chat y no nos
    // da bola». El chat no tenía cómo pasar un renglón a kilos y el cambio se
    // descartaba callado. Con los kilos, la cantidad pasa a kg y el costo pasa a
    // ser por kilo; el importe del renglón no cambia (igual que «por peso» a mano).
    if (c.campo === 'kilos') {
      // SACARLE EL PESO (9/11/2026: el chat dijo «les saqué el peso» a los quesos
      // fraccionados y no se aplicó): «kilos» vacío o 0 lo vuelve a unidades. Si
      // pasó a peso en esta pantalla, vuelve a como estaba; si lo leyó así el
      // lector, las unidades salen del papel y el precio, de importe ÷ unidades.
      if (c.valor == null || c.valor === '' || num(c.valor) === 0) {
        if (!fila.porPeso) { descartar(c, 'el renglón no va por peso'); continue; }
        let vuelta: Record<string, any> | null = null;
        if (fila.antesDePeso) vuelta = { ...fila.antesDePeso };
        else {
          const unidades = cuentaDelPapel(fila.papel ?? papelDeLectura(fila)).unidades;
          const importe = Math.abs(num(fila.importe) ?? 0);
          if (unidades > 0 && importe > 0) vuelta = { cantidad: unidades, precio: Math.round((importe / unidades) * 100) / 100, importe };
        }
        if (!vuelta) { descartar(c, 'no se sabe cuántas unidades tenía antes de pasar a peso'); continue; }
        registros.push({ renglon: k + 1, campo: 'kilos', antes: num(fila.cantidad), despues: null, motivo });
        nuevos[k] = { ...fila, ...vuelta, porPeso: false, antesDePeso: null, cantidadCorregida: null, bultoConsumido: null };
        continue;
      }
      const kg = num(c.valor);
      if (kg == null || !(kg > 0)) { descartar(c, 'los kilos tienen que ser un número mayor a cero'); continue; }
      const importe = Math.abs(num(fila.importe) ?? 0) || (num(fila.cantidad) ?? 0) * Math.abs(num(fila.precio) ?? 0);
      if (!(importe > 0)) { descartar(c, 'el renglón no tiene importe: sin eso no se puede sacar el precio por kilo'); continue; }
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
      if (despues && !fila.sku) { descartar(c, 'el renglón no tiene producto del catálogo elegido'); continue; }
      registros.push({ renglon: k + 1, campo: 'ingresa', antes: fila.incluir !== false, despues, motivo });
      nuevos[k] = { ...fila, incluir: despues };
      continue;
    }
    // EL COSTO LO DICE LA PERSONA (5/11/2026, «el chat es poco obediente»): si
    // dice cuánto cuesta la unidad, ese es el costo de ese renglón. null lo saca.
    if (c.campo === 'costoFinal') {
      const n = c.valor == null || c.valor === '' ? null : num(c.valor);
      if (n != null && !(n > 0)) { descartar(c, 'el costo tiene que ser un número mayor a cero'); continue; }
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
      if (interno != null && !(interno >= 0)) { descartar(c, 'el impuesto interno tiene que ser un número'); continue; }
      const antes = internoUnitarioDe(fila);
      if (interno == null) {
        registros.push({ renglon: k + 1, campo: 'impuestoInternoUnitario', antes, despues: null, motivo });
        nuevos[k] = { ...fila, fraccionNeta: null, netoDelPapel: null, internosDelPapel: null };
        continue;
      }
      const con = conInternoDelPapel(fila, interno);
      if (!con) { descartar(c, 'con ese impuesto interno el precio del renglón no da un neto válido'); continue; }
      const antesPapel: Papel = fila.papel ?? papelDeLectura(fila);
      if (num(con.papel?.precio) !== num(antesPapel.precio)) registros.push({ renglon: k + 1, campo: 'precio', antes: antesPapel.precio, despues: con.papel.precio, motivo: 'El «Precio Unit» del papel: neto + IVA + impuesto interno' });
      if (num(con.papel?.importe) !== num(antesPapel.importe)) registros.push({ renglon: k + 1, campo: 'importe', antes: antesPapel.importe, despues: con.papel.importe, motivo: 'Cantidad × «Precio Unit»' });
      registros.push({ renglon: k + 1, campo: 'impuestoInternoUnitario', antes, despues: interno, motivo });
      nuevos[k] = con;
      continue;
    }
    // LA UNIDAD DEL RENGLÓN (18/11/2026): «el precio es por bulto», «son cajas, no sueltas»
    if (c.campo === 'precioPor') {
      const antes = vistaDelPapel(fila).precioPor;
      const r = cambiarDatoDelPapel(fila, 'precioPor', c.valor);
      if (typeof r === 'string') { descartar(c, r); continue; }
      if (r !== fila) registros.push({ renglon: k + 1, campo: 'precioPor', antes, despues: String(c.valor), motivo });
      nuevos[k] = r;
      continue;
    }
    const papel: Papel = { ...(fila.papel ?? papelDeLectura(fila)) };
    const entra: EntraComo = entraDeRenglon(fila, papel);
    if (c.campo === 'entraComo') {
      const de = num(papel.uxb);
      let nuevo: EntraComo | undefined;
      if (c.valor === 'cajas' && de != null && de > 1) nuevo = { como: 'cajas', de };
      // con la cantidad en «bultos» las de adentro ya están contadas: «abrir» es que entren esas unidades
      else if ((c.valor === 'abiertas' || c.valor === 'abrir') && de != null && de > 1) nuevo = (num(papel.bultos) ?? 0) > 0 ? { como: 'unidades' } : { como: 'abiertas', de };
      else if (c.valor === 'unidades') nuevo = { como: 'unidades' };
      if (!nuevo) { descartar(c, 'el renglón no tiene unidades por bulto'); continue; }
      registros.push({ renglon: k + 1, campo: 'entraComo', antes: entraDeRenglon(fila, papel)?.como ?? null, despues: nuevo.como, motivo });
      // si el renglón contaba bultos a precio de bulto y pasa a entrar tal cual (el producto es la caja), sigue contando bultos
      const contabaBultos = vistaDelPapel(fila, papel).precioPor === 'bulto';
      nuevos[k] = { ...aplicarPapel(fila, papel, nuevo), ...(contabaBultos && nuevo.como === 'unidades' ? { cuentaBultos: true } : {}) };
      continue;
    }
    // se vende en paquetes de N (las Rodesias: caja de 36, paquetes de 3): entra en paquetes
    // y el costo es el de un paquete (10/10/2026)
    if (c.campo === 'unidadesPorVenta') {
      const n = num(c.valor);
      if (n == null || n <= 1 || !Number.isFinite(n)) { descartar(c, 'las unidades por paquete tienen que ser más de una'); continue; }
      // ABRIR Y AGRUPAR A LA VEZ (10/11/2026, la Rhodesia: «1 caja × 36» que se vende
      // de a 3). El papel contaba la CAJA como suelta, a precio de caja: agrupar de
      // a 3 daba 1 ÷ 3 = 0,333 paquetes, porque el «abrir la caja» de antes se
      // pisaba. Si las unidades de adentro se agrupan exacto en paquetes de N, el
      // papel se reescribe igual que dice («1 bulto × 36 a precio de unidad»: la
      // misma plata) y recién ahí se agrupa: 36 ÷ 3 = 12 paquetes.
      const uxb = num(papel.uxb) ?? 0;
      const cuentaCajas = (num(papel.bultos) ?? 0) === 0 && (num(papel.sueltas) ?? 0) > 0 && uxb > n && uxb % n === 0;
      const papelAbierto: Papel = cuentaCajas && num(papel.precio) != null
        ? { ...papel, bultos: num(papel.sueltas), sueltas: 0, precio: redondear((num(papel.precio) as number) / uxb) }
        : papel;
      if (papelAbierto !== papel) registros.push({ renglon: k + 1, campo: 'precio', antes: papel.precio, despues: papelAbierto.precio, motivo: `la caja de ${uxb} se abre: precio por unidad (la plata no cambia)` });
      const nuevo: EntraComo = { como: 'cajas', de: n };
      registros.push({ renglon: k + 1, campo: 'entraComo', antes: entraDeRenglon(fila, papel)?.como ?? null, despues: `paquetes de ${n}`, motivo });
      nuevos[k] = aplicarPapel(fila, papelAbierto, nuevo);
      continue;
    }
    // «el importe es lo que da la cuenta» (5/11/2026): la persona dijo el descuento,
    // la cantidad o el precio y el importe leído quedó viejo. Manda su cuenta.
    if (c.campo === 'ajustarImporte') {
      const cuenta = cuentaDelPapel(papel).cuenta;
      if (c.valor === false || c.valor === 'false' || !(cuenta > 0)) { descartar(c, 'la cuenta del renglón da cero: no hay importe que poner'); continue; }
      if (cuenta !== num(papel.importe)) registros.push({ renglon: k + 1, campo: 'importe', antes: papel.importe, despues: cuenta, motivo });
      papel.importe = cuenta;
      nuevos[k] = aplicarPapel(fila, papel, entra);
      continue;
    }
    const campo = CAMPO_IA[c.campo];
    const valor = c.valor == null ? null : num(c.valor);
    if (!campo) { descartar(c, 'ese dato no se puede cambiar en un renglón'); continue; }
    if ((c.valor != null && valor == null) || (valor != null && valor < 0)) { descartar(c, 'el valor tiene que ser un número y no puede ser negativo'); continue; }
    // el dato se cambia como lo ve la persona: en un renglón con precio por bulto, «bultos» son los bultos
    const cambiado = cambiarDatoDelPapel(fila, campo, valor);
    if (typeof cambiado === 'string') { descartar(c, cambiado); continue; }
    registros.push({ renglon: k + 1, campo, antes: vistaDelPapel(fila, papel)[campo], despues: valor, motivo });
    nuevos[k] = cambiado;
  }
  // «aceptados»: los cambios tal como vinieron, sin los que se descartaron (el chat los vuelve a mandar a la pantalla)
  return { items: nuevos, registros, descartados, aceptados: (cambios ?? []).filter((c) => !rechazo.has(c)) };
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
    // el «Descuento» que anulaba un renglón sin cargo, ya juntado con lo pago (21/11/2026)
    if (esDescuento(fila) && fila.juntadoEn && fila.regaloJuntado) {
      return { renglon: k + 1, descuento: true, descripcion: fila.descripcion, juntadoEnElRenglon: fila.juntadoEn, nota: `dejaba sin cargo el renglón ${fila.regaloJuntado.regalo}; ya está adentro del renglón ${fila.juntadoEn} como su bonificación` };
    }
    if (esDescuento(fila)) {
      return { renglon: k + 1, descuento: true, descripcion: fila.descripcion, importe: num(fila.importe), aplicaA: destino(k), noAplicar: !!fila.noAplicar };
    }
    if (fila.juntadoEn && fila.regaloJuntado) {
      return { renglon: k + 1, descripcion: fila.descripcion, juntadoEnElRenglon: fila.juntadoEn, nota: 'iba sin cargo: sus unidades están sumadas en ese renglón, que se queda con la plata que se pagó' };
    }
    // juntado en otro renglón (18/11/2026): ya no cuenta, sus unidades y su plata están allá
    if (fila.juntadoEn) {
      return { renglon: k + 1, descripcion: fila.descripcion, juntadoEnElRenglon: fila.juntadoEn, nota: 'ya no cuenta ni entra al stock: sus unidades y su importe están sumados en ese renglón' };
    }
    const p: Papel = fila.papel ?? papelDeLectura(fila);
    const c = cuentaDelPapel(p);
    // como lo dice el papel: con precio por bulto, los bultos van en «bultos» (18/11/2026)
    const v = vistaDelPapel(fila, p);
    const porBulto = v.precioPor === 'bulto';
    return {
      renglon: k + 1,
      codigo: fila.codigo ?? null,
      descripcion: fila.descripcion,
      producto: fila.nombre ?? null,
      ...(Array.isArray(fila.junta) && fila.junta.length ? { juntaLosRenglones: fila.junta.map((x: any) => x.renglon) } : {}),
      // lleva adentro lo sin cargo del mismo artículo (21/11/2026): las unidades son pagas + sin cargo y el % es lo sin cargo
      ...(sinCargoDe(fila) > 0 ? {
        sinCargo: { unidades: sinCargoDe(fila), pagas: redondear(c.unidades - sinCargoDe(fila), 3), deLosRenglones: fila.regalos.flatMap((r: any) => [r.renglon, r.descuento].filter((x: any) => x != null)) },
      } : {}),
      // no está en el papel: lo agregó una persona o el chat en esta pantalla
      ...(fila.agregado ? { agregadoEnPantalla: true } : {}),
      bultos: v.bultos, unidadesPorBulto: v.uxb, sueltas: v.sueltas,
      precio: v.precio, precioPor: v.precioPor, descuentoPct: p.desc, alicuotaIva: p.iva, importe: p.importe,
      // por bulto: las unidades son las de adentro (bultos × unidades por bulto) y la cuenta es bultos × precio
      unidades: porBulto ? (num(v.bultos) ?? 0) * (num(v.uxb) ?? 1) : c.unidades, cuenta: c.cuenta, cierra: c.cierra,
      ...(porBulto && (num(v.precio) ?? 0) > 0 ? { precioDeCadaUnidad: redondear((num(v.precio) as number) / (num(v.uxb) as number)) } : {}),
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
      // llegó una parte: lo que entró de verdad, en kilos si va por peso y si no en unidades (null = llegó todo)
      recibidas: num(fila.recibidoAMano),
      ...(faltanteDe(fila) > 0 ? { facturado: facturadoDe(fila), faltaron: faltanteDe(fila), entraAlStockLoQueLlego: cantidadQueEntra(fila) } : {}),
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
  // se mira cada renglón tocado y, si se juntó en otro, también ese (su precio pasa a ser el promedio)
  const tocados = registros.flatMap((g) => (g.campo === 'juntarEn' && g.despues != null ? [g.renglon - 1, Number(g.despues) - 1] : [g.renglon - 1]));
  for (const k of [...new Set(tocados)]) {
    const a = antes[k];
    const d = despues[k];
    const catalogo = num(a?.costoCatalogo) ?? 0;
    if (!a || !d || !(catalogo > 0)) continue;
    const lejosAntes = lejosDelCatalogo(a, catalogo);
    const lejosDespues = lejosDelCatalogo(d, catalogo);
    if (lejosDespues > Math.log(3) && lejosAntes < lejosDespues - Math.log(2)) {
      frenados.push(k + 1);
    }
  }
  // lo juntado se frena entero: si vuelve el destino, vuelven los que se le sumaron (y al revés)
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const g of registros) {
      if (g.campo !== 'juntarEn' || g.despues == null) continue;
      const par = [g.renglon, Number(g.despues)];
      if (par.some((n) => frenados.includes(n)) && !par.every((n) => frenados.includes(n))) {
        for (const n of par) if (!frenados.includes(n)) frenados.push(n);
        cambio = true;
      }
    }
  }
  for (const n of frenados) items[n - 1] = antes[n - 1];
  const sacados = (g: Registro) => frenados.includes(g.renglon) || (g.campo === 'juntarEn' && frenados.includes(Number(g.despues)));
  return { items, registros: registros.filter((g) => !sacados(g)), frenados: frenados.sort((a, b) => a - b) };
}

// ---- renglones agregados (13/11/2026) ----
// El chat le dijo a la persona «agregá dos renglones con el botón de agregar
// renglón de la tabla», y ese botón no existía: la factura de Artesano quedó
// $55.000 abajo. Ahora se agregan desde la tabla («Agregar renglón») y desde el
// chat («renglonesNuevos»). Van SIEMPRE al final: así los números de los
// renglones leídos no se mueven (el borrador y la constancia de cambios los
// usan) y el borrador los guarda enteros.

export type DatosRenglonNuevo = { descripcion: string; cantidad: number; precio: number };

/**
 * Un renglón nuevo, sin producto vinculado (no entra al stock hasta que se
 * elige uno), con su cuenta del papel: cantidad × precio = importe. El IVA sale
 * del renglón que se parte o al que se parece (`plantilla`); si no hay, del
 * primero de mercadería.
 */
export function renglonAgregado(plantilla: Record<string, any> | null | undefined, datos: DatosRenglonNuevo, por: string, id: string) {
  const cantidad = Math.max(0, num(datos.cantidad) ?? 0);
  const precio = Math.max(0, num(datos.precio) ?? 0);
  const iva = num(plantilla?.papel?.iva) ?? num(plantilla?.alicuotaIva);
  const papel: Papel = { bultos: null, uxb: null, sueltas: cantidad, precio, desc: null, iva, importe: redondear(cantidad * precio) };
  const fila = {
    descripcion: String(datos.descripcion ?? '').trim() || 'Renglón agregado',
    codigo: null, sku: '', nombre: null, variacionPct: null, sugerido: false, motivoIa: null, avisoMedida: null,
    margenPct: plantilla?.margenPct ?? '',
    cantidad, precio, importe: papel.importe, porPeso: false, kg: null,
    esDescuento: false, esDevolucion: false, devueltoAMano: false, recibidoAMano: null,
    descuentoPct: null, bonificacionPct: null, puedePorPeso: false,
    alicuotaIva: iva, alicuotaCatalogo: null, costoCatalogo: null, precioActual: null, alicuotaElegida: null,
    unidadesPorBulto: null, bultoAplicado: null, bultoDescartado: null, bultoDescartadoComo: null, bultoAuto: false,
    razonBulto: null, bultoOrigen: null, cantidadAlternativa: null, cantidadCorregida: null, bultoConsumido: null,
    importeConIvaLeido: null, internosDelPapel: null, netoDelPapel: null, fraccionNeta: null, envaseAplicado: null,
    // sin producto no entra al stock: se elige en el renglón (o lo vincula el chat)
    incluir: false,
    papel,
    agregado: { id, por, cuando: new Date().toISOString() },
  };
  return aplicarPapel(fila, papel, { como: 'unidades' });
}

/** ¿Lo agregó alguien en esta pantalla (no lo leyó el sistema)? */
export const esRenglonAgregado = (fila: any) => !!fila?.agregado;

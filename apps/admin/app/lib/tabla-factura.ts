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
  // la cantidad del papel: la que leyó el lector (la interpretación pudo corregirla)
  const cant = num(raw?.cantidad) ?? num(r.cantidadOriginal) ?? 0;
  const precio = num(raw?.precio);
  const importe = num(r.importeNeto) ?? num(raw?.importe);
  const desc = num(raw?.bonificacionPct) ?? num(r.bonificacionPct);
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
    if (esDescuento(fila)) {
      if (c.campo !== 'noAplicar') { descartados.push(c); continue; }
      const despues = c.valor === true || c.valor === 'true';
      registros.push({ renglon: k + 1, campo: 'noAplicar', antes: !!fila.noAplicar, despues, motivo });
      nuevos[k] = { ...fila, noAplicar: despues };
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
export function tablaParaIA(items: any[], esDescuento: (fila: any) => boolean, destino: (idx: number) => string | null) {
  return items.map((fila, k) => {
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
      entraComo: entraDeRenglon(fila, p)?.como ?? 'por decidir',
    };
  });
}

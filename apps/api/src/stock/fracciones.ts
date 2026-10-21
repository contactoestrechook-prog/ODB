// Cuentas de la pantalla Fraccionar (21/10/2026), separadas del servicio para
// poder probarlas sin base: cuántas presentaciones alcanzan con lo que hay en
// el pozo, qué cantidades son válidas (unidades enteras o kilos) y cómo se
// arma el historial a partir de los movimientos de stock.

// Tolerancia para kilos: 0,3 kg / 0,1 kg da 2,9999999999999996 en coma
// flotante y sin esto "alcanzaba para 2" cuando alcanza para 3.
const EPSILON = 1e-9;

/** Cuántas presentaciones enteras se pueden armar con lo que hay en el pozo. */
export function alcanzaPara(stockPozo: unknown, unidadesPorPresentacion: unknown): number {
  const stock = Number(stockPozo);
  const unidades = Number(unidadesPorPresentacion);
  if (!Number.isFinite(stock) || !Number.isFinite(unidades) || stock <= 0 || unidades <= 0) return 0;
  return Math.max(0, Math.floor(stock / unidades + EPSILON));
}

/** Redondea a 3 decimales (gramos) sin arrastrar el error de la coma flotante. */
export function aGramos(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Lo que lleva una presentación o lo que entra al pozo. En un pozo por unidad
 * tiene que ser entero (no hay media docena de un huevo); en uno por kilo se
 * aceptan hasta 3 decimales (0,250 kg). Acepta coma decimal ("0,25").
 * Devuelve el número o un texto con el problema.
 */
export function leerCantidad(
  valor: unknown,
  porPeso: boolean,
  { que = 'La cantidad', maximo }: { que?: string; maximo?: number } = {},
): { ok: true; valor: number } | { ok: false; error: string } {
  const texto = typeof valor === 'string' ? valor.trim().replace(',', '.') : valor;
  const n = texto === '' || texto == null ? NaN : Number(texto);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${que} tiene que ser mayor que 0` };
  if (!porPeso && !Number.isInteger(n)) {
    return { ok: false, error: `${que} va en unidades enteras (este pozo se cuenta por unidad, no por kilo)` };
  }
  const redondo = porPeso ? aGramos(n) : n;
  if (redondo <= 0) return { ok: false, error: `${que} es demasiado chica: el mínimo es 0,001 kg (1 gramo)` };
  if (maximo != null && redondo > maximo) return { ok: false, error: `${que} es demasiado grande para una sola vez (máximo ${maximo})` };
  return { ok: true, valor: redondo };
}

/**
 * Precio escrito como lo escribe la gente acá: "2.500" son dos mil quinientos
 * (no dos con cincuenta), "2.500,50" y "2500,5" también valen. null si no es
 * un precio mayor que 0.
 */
export function leerPrecio(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null;
  let t = String(valor ?? '').replace(/[$\s]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ---------------------------------------------------------------- historial

export type FilaMovimiento = {
  id: number | string;
  cantidad: number | string;
  motivo: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  creado_en: string;
  producto: { id?: string; sku: string; nombre: string; fraccion_de?: string | null; vendido_por_peso?: boolean | null } | null;
  usuario: { nombre: string } | null;
};

export type EntradaHistorial = {
  id: string;
  tipo: 'armado' | 'apertura' | 'carga';
  cuando: string;
  quien: string | null;
  pozo: { sku: string; nombre: string; porPeso: boolean };
  presentacion: { sku: string; nombre: string } | null;
  /** cuántas presentaciones se armaron o abrieron (null en una carga del pozo) */
  paquetes: number | null;
  /** cuánto salió del pozo (armado) o entró (apertura, carga), siempre positivo */
  unidades: number;
  motivo: string | null;
};

// La fila de la presentación dentro de una operación de fraccionamiento. La
// presentación es la que tiene fraccion_de; si después la sacaron del grupo,
// se reconoce por el texto que escribe fraccionar_producto en el motivo.
function esFilaPresentacion(f: FilaMovimiento): boolean {
  if (f.producto?.fraccion_de) return true;
  const m = f.motivo ?? '';
  return /^Fraccionamiento: armado desde /.test(m) || /^Desarme: .+ vuelven al pozo de /.test(m);
}

/**
 * Agrupa los movimientos (los más nuevos primero) por operación: un armado o
 * una apertura son dos renglones (el pozo y la presentación) con el mismo
 * referencia_id; una carga del pozo es uno solo. Las operaciones que quedaron
 * a medias en el corte de la consulta se descartan.
 */
export function armarHistorial(filas: FilaMovimiento[], limite = 30): EntradaHistorial[] {
  const orden: string[] = [];
  const porOperacion = new Map<string, FilaMovimiento[]>();
  for (const f of filas) {
    const clave = `${f.referencia_tipo ?? ''}:${f.referencia_id ?? f.id}`;
    if (!porOperacion.has(clave)) {
      porOperacion.set(clave, []);
      orden.push(clave);
    }
    porOperacion.get(clave)!.push(f);
  }

  const salida: EntradaHistorial[] = [];
  for (const clave of orden) {
    const grupo = porOperacion.get(clave)!;
    const primera = grupo[0];
    if (!primera.producto) continue;

    if (primera.referencia_tipo === 'carga_pozo') {
      salida.push({
        id: clave,
        tipo: 'carga',
        cuando: primera.creado_en,
        quien: primera.usuario?.nombre ?? null,
        pozo: { sku: primera.producto.sku, nombre: primera.producto.nombre, porPeso: !!primera.producto.vendido_por_peso },
        presentacion: null,
        paquetes: null,
        unidades: Math.abs(Number(primera.cantidad)),
        motivo: (primera.motivo ?? '').replace(/^Carga del pozo:\s*/, '') || null,
      });
    } else {
      const pres = grupo.find(esFilaPresentacion);
      const pozo = grupo.find((f) => f !== pres);
      if (!pres?.producto || !pozo?.producto) continue; // operación cortada por el límite
      const cantidad = Number(pres.cantidad);
      salida.push({
        id: clave,
        tipo: cantidad > 0 ? 'armado' : 'apertura',
        cuando: pres.creado_en,
        quien: pres.usuario?.nombre ?? pozo.usuario?.nombre ?? null,
        pozo: { sku: pozo.producto.sku, nombre: pozo.producto.nombre, porPeso: !!pozo.producto.vendido_por_peso },
        presentacion: { sku: pres.producto.sku, nombre: pres.producto.nombre },
        paquetes: Math.abs(cantidad),
        unidades: Math.abs(Number(pozo.cantidad)),
        motivo: null,
      });
    }
    if (salida.length >= limite) break;
  }
  return salida;
}

/**
 * Texto claro para el "Stock insuficiente" de la base: dice si faltó pozo
 * (al armar) o presentaciones armadas (al abrir), en lugar de "la operación
 * dejaría -24 unidades". Con el stock real a mano usar explicarFaltante, que
 * además distingue el pozo en negativo.
 */
export function errorDeFraccionamiento(mensaje: string, cantidad: number): string {
  if (!/Stock insuficiente/i.test(mensaje)) return mensaje;
  return cantidad > 0
    ? 'No alcanza lo que hay en el pozo para armar esa cantidad. Cargá el pozo o abrí una presentación más grande.'
    : 'No hay tantas armadas en esta sucursal para pasar al pozo.';
}

/** "0,86 kg" o "12 unidades", como lo dice la pantalla. */
export function cantidadDelPozo(n: number, porPeso: boolean): string {
  const texto = Math.abs(n).toLocaleString('es-AR', { maximumFractionDigits: porPeso ? 3 : 0 });
  const signo = n < 0 ? '-' : '';
  if (porPeso) return `${signo}${texto} kg`;
  return `${signo}${texto} ${Math.abs(n) === 1 ? 'unidad' : 'unidades'}`;
}

/**
 * Por qué la base dijo "Stock insuficiente", con el stock de la sucursal a la
 * vista. registrar_movimiento rechaza todo lo que deje un stock en negativo,
 * incluso una suma: con el pozo en -0,86 kg (se vendió más de lo que entró),
 * abrir un cuarto lo deja en -0,61 y también se rechaza. Antes eso salía como
 * "No hay tantas armadas", aunque las hubiera.
 */
export function explicarFaltante({
  cantidad,
  unidades,
  stockPozo,
  stockPresentacion,
  porPeso,
}: {
  /** presentaciones: > 0 armar, < 0 abrir */
  cantidad: number;
  /** lo que lleva cada presentación */
  unidades: number;
  stockPozo: number;
  stockPresentacion: number;
  porPeso: boolean;
}): string {
  const mueve = aGramos(Math.abs(cantidad) * unidades);
  if (cantidad > 0) {
    if (stockPozo < 0) {
      return `El pozo está en ${cantidadDelPozo(stockPozo, porPeso)} (se vendió más de lo que entró): cargá el pozo para dejarlo en cero y después armá.`;
    }
    return `No alcanza lo que hay en el pozo: hay ${cantidadDelPozo(stockPozo, porPeso)} y para esa cantidad hacen falta ${cantidadDelPozo(mueve, porPeso)}. Cargá el pozo o abrí una presentación más grande.`;
  }
  const abrir = Math.abs(cantidad);
  if (stockPresentacion < abrir) {
    return `No hay tantas armadas en esta sucursal para pasar al pozo: hay ${Math.max(0, stockPresentacion).toLocaleString('es-AR', { maximumFractionDigits: 3 })}.`;
  }
  const despues = aGramos(stockPozo + mueve);
  if (despues < 0) {
    return `El pozo está en ${cantidadDelPozo(stockPozo, porPeso)} (se vendió más de lo que entró) y con lo que abrís quedaría en ${cantidadDelPozo(despues, porPeso)}: el stock no puede quedar en negativo. Cargá al menos ${cantidadDelPozo(-despues, porPeso)} al pozo, o abrí más.`;
  }
  return 'No hay stock suficiente para esa operación.';
}

/** Cuánto hay que cargar para que el pozo no siga en negativo (0 si ya alcanza). */
export function faltaParaCero(stockPozo: number, carga: number): number {
  const despues = aGramos(stockPozo + carga);
  return despues < 0 ? aGramos(-despues) : 0;
}

// ------------------------------------------------------------- lo armado

/** Pedidos que todavía tienen la mercadería reservada (cancelar_pedido la devuelve). */
export const ESTADOS_PEDIDO_ABIERTO = ['recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino'] as const;

/**
 * Lo armado de una presentación: el stock positivo de cada sucursal MÁS lo
 * reservado en pedidos abiertos. La reserva baja el stock, pero si el pedido
 * se cancela vuelve al mismo producto: si mientras tanto cambió lo que lleva,
 * al abrirla volvería al pozo con la cuenta nueva.
 */
export function describirArmadas(
  stock: { cantidad: number | string; sucursal_id: string }[],
  reservas: { cantidad: number | string; pedido: { sucursal_id: string } | null }[],
  nombreSucursal: (id: string) => string,
): { total: number; reservadas: number; donde: string } {
  const enStock = new Map<string, number>();
  for (const f of stock) {
    const n = Number(f.cantidad);
    if (n > 0) enStock.set(f.sucursal_id, (enStock.get(f.sucursal_id) ?? 0) + n);
  }
  const reservadas = new Map<string, number>();
  for (const r of reservas) {
    const n = Number(r.cantidad);
    const suc = r.pedido?.sucursal_id;
    if (suc && n > 0) reservadas.set(suc, (reservadas.get(suc) ?? 0) + n);
  }
  const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const partes = [
    ...[...enStock].map(([suc, n]) => `${num(n)} en ${nombreSucursal(suc)}`),
    ...[...reservadas].map(([suc, n]) => `${num(n)} reservada${n === 1 ? '' : 's'} en pedidos de ${nombreSucursal(suc)}`),
  ];
  const donde = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : (partes[0] ?? '');
  const totalReservadas = [...reservadas.values()].reduce((s, n) => s + n, 0);
  const total = [...enStock.values()].reduce((s, n) => s + n, 0) + totalReservadas;
  return { total, reservadas: totalReservadas, donde };
}

/**
 * El costo de una presentación cuando cambia lo que lleva: lo que lleva × el
 * costo del pozo (una docena cuesta 12 huevos). Si el pozo no tiene costo,
 * se escala el que tenía (30 → 12 lleva: el 40 %). null: no hay con qué.
 */
export function costoSegunLleva({
  costoPozo,
  costoActual,
  antes,
  nuevo,
}: {
  costoPozo: unknown;
  costoActual: unknown;
  antes: number;
  nuevo: number;
}): number | null {
  const redondo = (n: number) => Math.round(n * 100) / 100;
  const pozo = Number(costoPozo);
  if (costoPozo != null && Number.isFinite(pozo) && pozo > 0) return redondo(pozo * nuevo);
  const actual = Number(costoActual);
  if (costoActual != null && Number.isFinite(actual) && actual > 0 && antes > 0) return redondo((actual * nuevo) / antes);
  return null;
}

// ------------------------------------------------------ el sistema viejo

/**
 * Sant Thomas sigue vendiendo con el sistema viejo y su stock se pisa con la
 * planilla en cada carga (scripts/sistema-viejo/aplicar.sql lleva cada
 * producto con código del sistema viejo al número de la planilla). Lo que se
 * arme o se abra en ODB sobre esos productos lo borra la carga siguiente, y
 * el pozo (que la planilla no trae) queda con la diferencia: huevos contados
 * dos veces o desaparecidos.
 */
export function textoSistemaViejo(sucursal: string, productos: string[], carga: { referencia: string; fecha: string }): string {
  const cuando = new Date(carga.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  const que = productos.length === 1 ? `«${productos[0]}» lo trae` : `${productos.map((p) => `«${p}»`).join(' y ')} los trae`;
  return (
    `En ${sucursal} el stock de ${que} la planilla del sistema viejo (última carga ${carga.referencia}, el ${cuando}): ` +
    'lo que se arme, se abra o se cargue acá lo pisa la carga siguiente. Mientras esta sucursal venda con el sistema viejo, se fracciona allá.'
  );
}

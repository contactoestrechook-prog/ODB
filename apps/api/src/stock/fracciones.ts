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
 * dejaría -24 unidades".
 */
export function errorDeFraccionamiento(mensaje: string, cantidad: number): string {
  if (!/Stock insuficiente/i.test(mensaje)) return mensaje;
  return cantidad > 0
    ? 'No alcanza lo que hay en el pozo para armar esa cantidad. Cargá el pozo o abrí una presentación más grande.'
    : 'No hay tantas armadas en esta sucursal para pasar al pozo.';
}

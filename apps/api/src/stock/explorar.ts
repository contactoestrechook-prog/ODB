// Stock navegable (Leandro, 10/11/2026: «tiene que tener muchos más filtros…
// mucho más navegable»). Los filtros viajan en la dirección del panel con estas
// mismas claves y se pasan tal cual a stock_explorar (db/migracion-stock-explorar.sql),
// que filtra, ordena y recorta en la base.

export const ESTADOS_STOCK = ['negativo', 'sin_stock', 'bajo_minimo', 'se_termina', 'sin_movimiento', 'sobra', 'normal'] as const;
export const ORDENES_STOCK = ['nombre', 'sku', 'rubro', 'marca', 'estado', 'stock', 'valor', 'costo', 'venta', 'dias', 'minimo'] as const;
export const POR_PAGINA = 50;
// el Excel sale entero, hasta este tope (el catálogo activo ronda los 11.000)
export const TOPE_EXCEL = 20000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsultaStock = {
  filtros: Record<string, unknown>;
  orden: string;
  desc: boolean;
  pagina: number;
};

function lista(v: unknown, vale: (x: string) => boolean): string[] {
  return String(v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && vale(x));
}

function cifra(v: unknown): number | undefined {
  if (v == null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const siNo = (v: unknown) => (v === 'si' || v === 'no' ? v : undefined);

// Lo que llega en la dirección → lo que entiende la base. Lo que no se
// reconoce se ignora (una dirección vieja o tocada a mano no rompe la pantalla).
export function leerConsulta(q: Record<string, unknown>): ConsultaStock {
  const filtros: Record<string, unknown> = {};
  const texto = String(q.q ?? '').trim();
  if (texto) filtros.q = texto.slice(0, 120);
  if (UUID.test(String(q.suc ?? ''))) filtros.sucursal = q.suc;
  if (UUID.test(String(q.prov ?? ''))) filtros.proveedor = q.prov;
  const rubros = lista(q.rubro, (x) => x === 'sin' || UUID.test(x));
  if (rubros.length) filtros.rubros = rubros;
  const marcas = lista(q.marca, (x) => x === 'sin' || UUID.test(x));
  if (marcas.length) filtros.marcas = marcas;
  const estados = lista(q.estado, (x) => (ESTADOS_STOCK as readonly string[]).includes(x));
  if (estados.length) filtros.estados = estados;
  if (siNo(q.peso)) filtros.peso = q.peso;
  if (siNo(q.barras)) filtros.barras = q.barras;
  if (q.activo === 'no' || q.activo === 'todos') filtros.activo = q.activo;
  for (const k of ['cant_min', 'cant_max', 'valor_min', 'valor_max', 'venta_min', 'venta_max']) {
    const n = cifra(q[k]);
    if (n !== undefined) filtros[k] = n;
  }
  const orden = (ORDENES_STOCK as readonly string[]).includes(String(q.orden)) ? String(q.orden) : 'nombre';
  const pagina = Math.max(1, Math.floor(cifra(q.pag) ?? 1));
  return { filtros, orden, desc: q.dir === 'desc', pagina };
}

export const NOMBRE_ESTADO: Record<string, string> = {
  negativo: 'Negativo',
  sin_stock: 'Sin stock',
  bajo_minimo: 'Bajo mínimo',
  se_termina: 'Se termina',
  sin_movimiento: 'Sin movimiento',
  sobra: 'Sobra',
  normal: 'Normal',
};

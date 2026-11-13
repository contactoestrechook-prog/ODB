// ============================================================
// LA ENTRADA DE «INVENTARIO DE PRODUCTO» (Leandro, 13/11/2026: «le podríamos
// dar una mejora superlativa… ¿no te parece que está súper pobre?»).
//
// Antes la entrada era un buscador y diez productos con dos números. Ahora
// muestra cómo está el stock entero de un vistazo (cuánto alcanza lo que hay
// en cada sucursal) y listas para recorrer producto por producto con la ficha
// abierta al lado: los que más se venden, los que se venden y no hay, los que
// se terminan esta semana, los que sobran, los que no se venden y los números
// que hay que revisar.
//
// Todo sale de la misma lectura que Mesa de compras, el Analista y los
// informes (abastecimiento/motor.ts): el ritmo, la cobertura y la alerta no se
// recalculan. Funciones puras; se prueban en entrada.spec.ts.
// ============================================================

export type FilaMotor = {
  producto_id: string;
  sku: string;
  nombre: string;
  categoria: string | null;
  sucursal_id: string;
  stock: number | string | null;
  en_camino: number | string | null;
  ritmo_dia: number | string | null;
  cobertura_dias: number | string | null;
  alerta: string | null;
  ultimo_costo: number | string | null;
};

/** Cuánto alcanza lo que hay en una sucursal. */
export const TRAMOS = ['sin_stock', 'semana', 'mes', 'meses', 'de_mas', 'sin_ventas'] as const;
export type Tramo = (typeof TRAMOS)[number];

/** Las listas de la entrada: la de siempre, una por tramo y los números raros. */
export const VISTAS = ['se_vende', ...TRAMOS, 'revisar'] as const;
export type Vista = (typeof VISTAS)[number];

export const esVista = (v: unknown): v is Vista => typeof v === 'string' && (VISTAS as readonly string[]).includes(v);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numONada = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * El tramo de una sucursal. Se vende = el motor le da ritmo. «Sin stock» es
 * que no hay en la góndola (aunque haya algo en camino); la cobertura, la del
 * motor (cuenta lo que está en camino, igual que la ficha). Lo que no hay y no
 * se vende no cae en ningún tramo: no hay nada que mirar.
 */
export function tramoDe(stock: number, ritmo: number, cobertura: number | null): Tramo | null {
  if (ritmo > 0) {
    if (stock <= 0) return 'sin_stock';
    const dias = cobertura ?? stock / ritmo;
    if (dias <= 7) return 'semana';
    if (dias <= 30) return 'mes';
    if (dias <= 120) return 'meses';
    return 'de_mas';
  }
  return stock > 0 ? 'sin_ventas' : null;
}

const es3 = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 3 });

/**
 * Por qué un número de stock no puede ser cierto: negativo, o con decimales en
 * un producto que se vende por unidad (1.979,942 facturas). null si está bien.
 */
export function motivoParaRevisar(stock: number, porPeso: boolean): string | null {
  if (stock < 0) return `Stock negativo: ${es3(stock)}`;
  if (!porPeso && Math.abs(stock - Math.round(stock)) > 1e-6) return `Tiene ${es3(stock)} y se vende por unidad`;
  return null;
}

export type SucursalDeFila = {
  id: string;
  stock: number;
  enCamino: number;
  ritmo: number;
  cobertura: number | null;
  alerta: string | null;
  tramo: Tramo | null;
};

export type FilaEntrada = {
  sku: string;
  nombre: string;
  rubro: string | null;
  porPeso: boolean;
  /** unidades por día en las sucursales que se miran */
  ritmo: number;
  /** lo que vale el stock a costo en las sucursales que se miran; null si no se ve plata */
  valor: number | null;
  /** todas las sucursales, aunque se mire una sola: así se ve si en la otra hay */
  sucursales: SucursalDeFila[];
  motivo: string | null;
};

export type ResumenVista = { total: number; valor: number | null; filas: FilaEntrada[] };

export type Entrada = {
  sucursales: { id: string; nombre: string }[];
  /** la sucursal que se mira; null = todas */
  sucursal: string | null;
  conPlata: boolean;
  foto: { conStock: number; valor: number | null };
  /** cuántos productos caen en cada tramo, sucursal por sucursal (siempre las dos) */
  alcance: { sucursalId: string; total: number; tramos: Record<Tramo, { n: number; valor: number | null }> }[];
  vistas: Record<Vista, ResumenVista>;
};

type Producto = { id: string; sku: string; nombre: string; rubro: string | null; porPeso: boolean; costo: number; filas: SucursalDeFila[] };

const vacioDeTramos = (conPlata: boolean) =>
  Object.fromEntries(TRAMOS.map((t) => [t, { n: 0, valor: conPlata ? 0 : null }])) as Record<Tramo, { n: number; valor: number | null }>;

/**
 * Arma la entrada a partir de las filas del motor (producto × sucursal).
 * `porPeso`: los productos que se venden por peso; `costos`: el costo del
 * catálogo, para lo que el motor no trae con último costo de compra.
 */
export function armarEntrada(opciones: {
  filas: FilaMotor[];
  sucursales: { id: string; nombre: string }[];
  porPeso: Set<string>;
  costos: Map<string, number>;
  sucursal: string | null;
  conPlata: boolean;
  porVista?: number;
  /** si va, solo esta lista, desde ese renglón (para «ver más») */
  soloVista?: Vista;
  desde?: number;
}): Entrada {
  const { filas, sucursales, porPeso, costos, conPlata } = opciones;
  const porVista = opciones.porVista ?? 50;
  const ids = new Set(sucursales.map((s) => s.id));
  const sucursal = opciones.sucursal && ids.has(opciones.sucursal) ? opciones.sucursal : null;
  const orden = new Map(sucursales.map((s, i) => [s.id, i]));

  // ---------- un producto con sus sucursales ----------
  const productos = new Map<string, Producto>();
  for (const f of filas) {
    if (!ids.has(f.sucursal_id)) continue;
    let p = productos.get(f.producto_id);
    if (!p) {
      p = {
        id: f.producto_id, sku: f.sku, nombre: f.nombre, rubro: f.categoria ?? null, porPeso: porPeso.has(f.producto_id),
        costo: num(f.ultimo_costo) || costos.get(f.producto_id) || 0, filas: [],
      };
      productos.set(f.producto_id, p);
    }
    const stock = r3(num(f.stock));
    const ritmo = r2(num(f.ritmo_dia));
    const cobertura = numONada(f.cobertura_dias);
    p.filas.push({
      id: f.sucursal_id, stock, enCamino: r3(num(f.en_camino)), ritmo, cobertura: cobertura == null ? null : r2(cobertura),
      alerta: f.alerta ?? null, tramo: tramoDe(stock, ritmo, cobertura),
    });
  }

  // ---------- cuánto alcanza, sucursal por sucursal ----------
  const alcance = sucursales.map((s) => ({ sucursalId: s.id, total: 0, tramos: vacioDeTramos(conPlata) }));
  const deAlcance = new Map(alcance.map((a) => [a.sucursalId, a]));
  let conStock = 0;
  let valorTotal = 0;

  type Candidato = { fila: FilaEntrada; dias: number };
  const candidatos = Object.fromEntries(VISTAS.map((v) => [v, [] as Candidato[]])) as Record<Vista, Candidato[]>;
  const valorDe = Object.fromEntries(VISTAS.map((v) => [v, 0])) as Record<Vista, number>;

  for (const p of productos.values()) {
    p.filas.sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0));
    for (const sf of p.filas) {
      if (!sf.tramo) continue;
      const a = deAlcance.get(sf.id)!;
      a.total++;
      a.tramos[sf.tramo].n++;
      if (conPlata) a.tramos[sf.tramo].valor = (a.tramos[sf.tramo].valor ?? 0) + Math.max(0, sf.stock) * p.costo;
    }

    const mira = sucursal ? p.filas.filter((sf) => sf.id === sucursal) : p.filas;
    if (!mira.length) continue;
    const stockMirado = mira.reduce((t, sf) => t + Math.max(0, sf.stock), 0);
    const valor = stockMirado * p.costo;
    if (stockMirado > 0) {
      conStock++;
      valorTotal += valor;
    }
    const motivo = mira.map((sf) => motivoParaRevisar(sf.stock, p.porPeso)).find(Boolean) ?? null;
    const fila: FilaEntrada = {
      sku: p.sku, nombre: p.nombre, rubro: p.rubro, porPeso: p.porPeso,
      ritmo: r2(mira.reduce((t, sf) => t + sf.ritmo, 0)),
      valor: conPlata ? Math.round(valor) : null,
      sucursales: p.filas, motivo,
    };
    const meter = (v: Vista, dias = 0) => {
      candidatos[v].push({ fila, dias });
      valorDe[v] += valor;
    };
    if (fila.ritmo > 0) meter('se_vende');
    for (const t of TRAMOS) {
      const enTramo = mira.filter((sf) => sf.tramo === t);
      if (enTramo.length) meter(t, Math.min(...enTramo.map((sf) => sf.cobertura ?? (sf.ritmo > 0 ? sf.stock / sf.ritmo : Infinity))));
    }
    if (motivo) meter('revisar');
  }

  // ---------- el orden de cada lista: lo que más importa arriba ----------
  const porRitmo = (a: Candidato, b: Candidato) => b.fila.ritmo - a.fila.ritmo || a.fila.nombre.localeCompare(b.fila.nombre);
  const porDias = (a: Candidato, b: Candidato) => a.dias - b.dias || porRitmo(a, b);
  const porPlata = (a: Candidato, b: Candidato) =>
    (conPlata ? (b.fila.valor ?? 0) - (a.fila.valor ?? 0) : 0) || b.dias - a.dias || a.fila.nombre.localeCompare(b.fila.nombre);
  const stockDe = (c: Candidato) => c.fila.sucursales.reduce((t, sf) => t + Math.abs(sf.stock), 0);
  const ORDEN: Record<Vista, (a: Candidato, b: Candidato) => number> = {
    se_vende: porRitmo,
    sin_stock: porRitmo, // lo que más se vende arriba: es lo que más se pierde
    semana: porDias,
    mes: porDias,
    meses: porDias,
    de_mas: porPlata, // la plata más parada arriba
    sin_ventas: (a, b) => (conPlata ? (b.fila.valor ?? 0) - (a.fila.valor ?? 0) : 0) || stockDe(b) - stockDe(a) || a.fila.nombre.localeCompare(b.fila.nombre),
    revisar: (a, b) => stockDe(b) - stockDe(a) || a.fila.nombre.localeCompare(b.fila.nombre),
  };

  const desde = Math.max(0, Math.floor(opciones.desde ?? 0));
  const vistas = Object.fromEntries(VISTAS.map((v) => {
    const lista = candidatos[v];
    const recorte = !opciones.soloVista || opciones.soloVista === v;
    const filasVista = recorte ? [...lista].sort(ORDEN[v]).slice(opciones.soloVista ? desde : 0, (opciones.soloVista ? desde : 0) + porVista).map((c) => c.fila) : [];
    return [v, { total: lista.length, valor: conPlata ? Math.round(valorDe[v]) : null, filas: filasVista }];
  })) as Record<Vista, ResumenVista>;

  for (const a of alcance) for (const t of TRAMOS) if (a.tramos[t].valor != null) a.tramos[t].valor = Math.round(a.tramos[t].valor!);

  return {
    sucursales, sucursal, conPlata,
    foto: { conStock, valor: conPlata ? Math.round(valorTotal) : null },
    alcance,
    vistas,
  };
}

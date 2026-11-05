// La medición del armado (op salón, 5/11/2026): de cada pedido asignado, cuánto
// tardó en arrancar (asignado → primer producto al carro), cuánto tardó en armar
// (primer producto → «Terminé») y el ritmo (segundos por producto cargado).

export type PedidoMedido = {
  asignado_a: string | null;
  asignado_en: string | null;
  armado_terminado_en: string | null;
  carro: { creado_en: string; cantidad: number }[];
};

export type TiempoPreparador = {
  usuarioId: string;
  pedidos: number;
  /** minutos promedio de asignado a terminado */
  minTotal: number | null;
  /** minutos promedio de asignado al primer producto en el carro */
  minArranque: number | null;
  /** segundos promedio entre producto y producto */
  segPorProducto: number | null;
  productos: number;
};

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const prom = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const red = (n: number | null, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Medidas de UN pedido; null en lo que todavía no se puede medir. */
export function medirPedido(p: PedidoMedido) {
  const asignado = ms(p.asignado_en);
  const fin = ms(p.armado_terminado_en);
  const marcas = p.carro.map((c) => ms(c.creado_en)).filter(Number.isFinite).sort((a, b) => a - b);
  const primero = marcas[0];
  const ultimo = marcas[marcas.length - 1];
  const total = Number.isFinite(asignado) && Number.isFinite(fin) && fin >= asignado ? (fin - asignado) / 60000 : null;
  const arranque = Number.isFinite(asignado) && primero != null && primero >= asignado ? (primero - asignado) / 60000 : null;
  // el ritmo se mide entre cargas: con una sola carga no hay ritmo
  const segPorProducto = marcas.length >= 2 ? (ultimo - primero) / 1000 / (marcas.length - 1) : null;
  return { total, arranque, segPorProducto, cargas: marcas.length };
}

/** Por preparador, solo con los pedidos que terminó. Los más rápidos primero. */
export function tiemposPorPreparador(pedidos: PedidoMedido[]): TiempoPreparador[] {
  const grupos = new Map<string, ReturnType<typeof medirPedido>[]>();
  for (const p of pedidos) {
    if (!p.asignado_a || !p.armado_terminado_en) continue;
    const lista = grupos.get(p.asignado_a) ?? [];
    lista.push(medirPedido(p));
    grupos.set(p.asignado_a, lista);
  }
  return [...grupos.entries()]
    .map(([usuarioId, m]) => ({
      usuarioId,
      pedidos: m.length,
      minTotal: red(prom(m.map((x) => x.total).filter((x): x is number => x != null))),
      minArranque: red(prom(m.map((x) => x.arranque).filter((x): x is number => x != null))),
      segPorProducto: red(prom(m.map((x) => x.segPorProducto).filter((x): x is number => x != null)), 0),
      productos: m.reduce((a, x) => a + x.cargas, 0),
    }))
    .sort((a, b) => (a.minTotal ?? Infinity) - (b.minTotal ?? Infinity));
}

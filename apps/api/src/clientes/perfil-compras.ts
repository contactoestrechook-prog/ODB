// Perfil de compra de un cliente (Leandro, 24/10/2026: «promedio de compra en
// tickets de últimos 6 meses, qué productos compra, qué días fuertes»).
// Los números los calcula perfil_compras() en la base, con lo del Crack
// (compras_cliente_historico) y las ventas de NÚCLEO con cliente.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export type PerfilCompras = {
  tickets: number;
  total: number;
  ticketPromedio: number;
  cadaDias: number | null;
  primera: string | null;
  ultima: string | null;
  /** tickets por día de la semana, de domingo a sábado */
  porDia: number[];
  /** los días que más compra (los que superan el promedio), nombrados */
  diasFuertes: string[];
  porMes: { mes: string; tickets: number; total: number }[];
  medios: { medio: string; tickets: number }[];
  productos: { codigo: string | null; nombre: string; unidades: number; total: number; veces: number }[];
};

/** Lo que devuelve perfil_compras(), listo para mostrar. */
export function resumirPerfil(p: any, productos = 8): PerfilCompras {
  const porDia = DIAS.map((_, i) => Number(p.por_dia?.[String(i)] ?? 0));
  const max = Math.max(...porDia);
  const prom = porDia.reduce((a, b) => a + b, 0) / 7;
  // fuertes: los que están arriba del promedio y a no menos del 70 % del mejor, de mayor a menor (hasta 3)
  const diasFuertes = porDia
    .map((n, i) => ({ n, i }))
    .filter((d) => d.n > 0 && d.n > prom && d.n >= max * 0.7)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((d) => DIAS[d.i]);
  return {
    tickets: Number(p.tickets ?? 0),
    total: Number(p.total ?? 0),
    ticketPromedio: Number(p.ticket_promedio ?? 0),
    cadaDias: p.cada_dias != null ? Number(p.cada_dias) : null,
    primera: p.primera ?? null,
    ultima: p.ultima ?? null,
    porDia,
    diasFuertes,
    porMes: (p.por_mes ?? []).map((m: any) => ({ mes: m.mes, tickets: Number(m.tickets), total: Number(m.total) })),
    medios: Object.entries(p.medios ?? {}).map(([medio, n]) => ({ medio, tickets: Number(n) })).sort((a, b) => b.tickets - a.tickets),
    productos: (p.productos ?? []).slice(0, productos).map((x: any) => ({ codigo: x.codigo ?? null, nombre: x.nombre, unidades: Number(x.unidades), total: Number(x.total), veces: Number(x.veces) })),
  };
}

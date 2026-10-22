// Parte de un período de ventas_historicas (ventas del sistema anterior) que cae
// dentro de la ventana del tablero, prorrateada por días.
//
// El tablero suma las ventas de ODB de los últimos 30 días y el histórico: si se
// sumaba el período ENTERO (por ejemplo el 21/9–20/10 de Sant Thomas), apenas la
// sucursal empieza a vender en ODB las dos fuentes cuentan los mismos días y el
// ritmo llega al doble (la cobertura de stock da la mitad y el producto sale en
// rojo sin estar en riesgo). Prorrateando, cada fuente aporta solo los días que
// le tocan: el histórico, los de antes del cambio; ODB, los de después.
const DIA = 86_400_000;
const aDia = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);

export function historicoEnVentana(
  fila: { desde: string; hasta: string; unidades: number | string },
  ventana: { desde: string; hasta: string },
): number {
  const d = aDia(fila.desde), h = aDia(fila.hasta);
  const dias = Math.max(1, Math.round((h - d) / DIA) + 1);
  const ini = Math.max(d, aDia(ventana.desde)), fin = Math.min(h, aDia(ventana.hasta));
  if (fin < ini) return 0;
  const dentro = Math.round((fin - ini) / DIA) + 1;
  return (Number(fila.unidades) * dentro) / dias;
}

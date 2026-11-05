// EL SUGERIDO QUE SE EXPLICA (4/11/2026, módulo de compras «50 veces más pro»).
// La pantalla decía «sugerido 3» y nada más: nadie sabía de dónde salía, y no
// descontaba lo que ya estaba pedido. Ahora el número viene con su cuenta, en
// palabras: cuánto se vende, cuánto hay, para cuánto alcanza, cuánto hay en
// camino y cuánto conviene pedir (en bultos, si el producto tiene bulto).
//
// La regla es la misma de siempre (cubrir N días con la venta de los últimos
// 30, o el mínimo cargado si pide más), menos lo que está en camino.

export type DatosSugerido = {
  stock: number;
  /** unidades por día, promedio de los últimos días de venta */
  porDia: number;
  minimo: number;
  reposicion: number;
  /** ya pedido y sin recibir */
  enCamino: number;
  unidadesPack: number;
};

const numero = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
const plural = (n: number, uno: string, muchos: string) => (n === 1 ? uno : muchos);

export function explicarSugerido(d: DatosSugerido, diasCobertura: number, diasVenta = 30): { sugerido: number; sugeridoBultos: number | null; explicacion: string } {
  const stock = Number(d.stock) || 0;
  const porDia = Math.max(0, Number(d.porDia) || 0);
  const enCamino = Math.max(0, Number(d.enCamino) || 0);
  const pack = Math.round(Number(d.unidadesPack) || 1);
  const porVenta = Math.ceil(porDia * diasCobertura);
  const porMinimo = Number(d.reposicion) > 0 ? Number(d.reposicion) : Math.max(0, Number(d.minimo) || 0) * 2;
  const objetivo = Math.max(porVenta, porMinimo);
  const falta = Math.max(0, Math.ceil(objetivo - stock));
  const neto = Math.max(0, falta - enCamino);
  const sugeridoBultos = pack > 1 && neto > 0 ? Math.ceil(neto / pack) : null;
  const sugerido = sugeridoBultos != null ? sugeridoBultos * pack : neto;

  const partes: string[] = [];
  partes.push(porDia > 0
    ? `Se venden unos ${numero(Math.round(porDia * 7 * 10) / 10)} por semana`
    : `No tuvo ventas en los últimos ${diasVenta} días`);
  partes.push(porDia > 0 && stock > 0
    ? `hay ${numero(stock)}, que alcanzan para ${Math.floor(stock / porDia)} ${plural(Math.floor(stock / porDia), 'día', 'días')}`
    : `hay ${numero(stock)}`);
  let cuenta = `${partes[0]} y ${partes[1]}.`;
  if (objetivo > 0) {
    cuenta += porMinimo > porVenta
      ? ` El mínimo cargado pide tener ${numero(objetivo)}.`
      : ` Para cubrir ${diasCobertura} días hacen falta ${numero(objetivo)}.`;
  }
  if (enCamino > 0) cuenta += ` Ya hay ${numero(enCamino)} en camino.`;
  if (sugerido > 0) {
    cuenta += ` Conviene pedir ${numero(sugerido)}`;
    if (sugeridoBultos != null) cuenta += ` (${sugeridoBultos} ${plural(sugeridoBultos, 'bulto', 'bultos')} de ${pack})`;
    cuenta += '.';
  } else if (falta > 0 && enCamino >= falta) {
    cuenta += ' Con lo que está en camino alcanza: no hace falta pedir más.';
  } else {
    cuenta += ' No hace falta pedir.';
  }
  return { sugerido, sugeridoBultos, explicacion: cuenta };
}

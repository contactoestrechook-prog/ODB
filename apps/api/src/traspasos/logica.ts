// TRASPASOS ENTRE LOCALES (10/11/2026): las cuentas que no dependen de la base,
// con pruebas en logica.spec.ts.

/** Días de venta que un local tiene que tener cubiertos con lo que pide. */
export const DIAS_A_CUBRIR = 14;

export type FilaSugerencia = {
  productoId: string;
  sku: string;
  nombre: string;
  stockOrigen: number;
  stockDestino: number;
  /** lo que el destino quiere tener como mínimo (punto de reposición o stock mínimo) */
  minimoDestino: number;
  minimoOrigen: number;
  vendidas30Destino: number;
  vendidas30Origen: number;
};

export type Sugerencia = FilaSugerencia & { necesita: number; sobra: number; sugerido: number; diasCubiertosDestino: number | null };

/**
 * QUÉ PEDIR: lo que al destino le falta para su mínimo o para DIAS_A_CUBRIR
 * días de venta, siempre que al origen le sobre (le queda su propio mínimo y
 * sus días de venta). Nunca se sugiere vaciar el otro local.
 */
export function sugerirTraspaso(filas: FilaSugerencia[], dias = DIAS_A_CUBRIR): Sugerencia[] {
  const salida: Sugerencia[] = [];
  for (const f of filas) {
    const ventaDiariaDestino = Math.max(0, f.vendidas30Destino) / 30;
    const ventaDiariaOrigen = Math.max(0, f.vendidas30Origen) / 30;
    const objetivoDestino = Math.max(f.minimoDestino || 0, Math.ceil(ventaDiariaDestino * dias));
    const reservaOrigen = Math.max(f.minimoOrigen || 0, Math.ceil(ventaDiariaOrigen * dias));
    const necesita = Math.max(0, objetivoDestino - Math.max(0, f.stockDestino));
    const sobra = Math.max(0, Math.floor(f.stockOrigen - reservaOrigen));
    const sugerido = Math.floor(Math.min(necesita, sobra));
    if (sugerido < 1) continue;
    salida.push({
      ...f, necesita, sobra, sugerido,
      diasCubiertosDestino: ventaDiariaDestino > 0 ? Math.round((Math.max(0, f.stockDestino) / ventaDiariaDestino) * 10) / 10 : null,
    });
  }
  // primero lo que se termina antes en el destino (sin stock y vendiendo, arriba)
  return salida.sort((a, b) => (a.diasCubiertosDestino ?? 999) - (b.diasCubiertosDestino ?? 999) || b.necesita - a.necesita);
}

export type ItemTraspaso = { cantidad: number | null; cantidad_recibida: number | null; resolucion?: string | null; costo_unitario?: number | null };

/** Lo que llegó distinto: negativo = faltó, positivo = sobró. */
export function diferenciaDe(i: ItemTraspaso): number {
  if (i.cantidad_recibida == null) return 0;
  return Math.round((Number(i.cantidad_recibida) - Number(i.cantidad ?? 0)) * 1000) / 1000;
}

/** Lo enviado, valorizado al costo de cuando salió. */
export function valorDe(items: ItemTraspaso[]): number {
  return Math.round(items.reduce((s, i) => s + Number(i.cantidad ?? 0) * Number(i.costo_unitario ?? 0), 0) * 100) / 100;
}

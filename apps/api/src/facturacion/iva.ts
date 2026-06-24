// Motor de IVA — lógica de negocio PURA: recibe datos y devuelve datos, sin tocar
// la base ni la red ni la UI. Por eso se puede testear de forma aislada (iva.spec.ts).
// Los precios entran SIEMPRE con IVA incluido; acá se abre neto + IVA por alícuota.

export type ItemComprobante = {
  sku?: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number; // SIEMPRE final con IVA incluido; el neto se calcula acá
  alicuota?: number; // 21 | 10.5 | 0
};

export type IvaDetalle = { alicuota: number; base: number; monto: number };
export type IvaCalculado = { neto: number; iva: number; total: number; ivaDetalle: IvaDetalle[] };

// error de dominio (no depende de Nest): el caller decide cómo mapearlo a HTTP
export class RenglonInvalidoError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calcula neto, IVA y total a partir de renglones con precio final.
 * @param opts.forzarSinIva remitos u otros sin discriminar IVA → todo va a neto, IVA 0.
 */
export function calcularIva(items: ItemComprobante[], opts: { forzarSinIva?: boolean } = {}): IvaCalculado {
  const porAlicuota = new Map<number, { base: number; monto: number }>();
  let neto = 0, iva = 0, total = 0;
  for (const i of items) {
    const cantidad = Number(i.cantidad);
    const precio = Number(i.precioUnitario);
    if (!(cantidad > 0) || !(precio >= 0)) {
      throw new RenglonInvalidoError(`Renglón inválido: ${i.descripcion}`);
    }
    const alicuota = opts.forzarSinIva ? 0 : Number(i.alicuota ?? 21);
    const renglon = precio * cantidad;
    const base = alicuota > 0 ? renglon / (1 + alicuota / 100) : renglon;
    const montoIva = renglon - base;
    total += renglon;
    neto += base;
    iva += montoIva;
    if (alicuota > 0) {
      const acc = porAlicuota.get(alicuota) ?? { base: 0, monto: 0 };
      acc.base += base;
      acc.monto += montoIva;
      porAlicuota.set(alicuota, acc);
    }
  }
  return {
    neto: r2(neto),
    iva: r2(iva),
    total: r2(total),
    ivaDetalle: [...porAlicuota.entries()].map(([alicuota, v]) => ({ alicuota, base: r2(v.base), monto: r2(v.monto) })),
  };
}

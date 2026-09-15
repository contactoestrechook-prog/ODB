// ============================================================
// EN QUÉ UNIDAD ENTRA CADA RENGLÓN AL STOCK (2026-09-15)
//
// La factura y el stock no hablan el mismo idioma, y cada proveedor lo escribe
// distinto. Los tres casos reales de ODB:
//
//  · Ferrero: la factura trae el BOCADITO ($827) y la casa vende la CAJA de 12
//    → 60 unidades = 5 cajas a $9.929,88.
//  · Congelados: "LANG. PELADO CRUDO x 250 grs" 5 × $18.210 es por KILO, y el
//    producto viene empaquetado de 250 g → 5 kg = 20 paquetes a $4.552,50.
//  · Lo normal: la factura ya viene en la unidad de stock y no hay nada que hacer.
//
// Acá solo se PROPONE la conversión; aplicarla es decisión de quien carga.
// Función pura, sin React: la prueban los tests de la API
// (apps/api/src/compras/presentacion.spec.ts).
// ============================================================

const normalizar = (t: string) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Unidades que trae el envase del catálogo: "x 12 un", "T24", "Blister 2U". */
export function unidadesDeEnvase(nombre: string | null | undefined): number | null {
  const t = normalizar(nombre ?? '');
  if (!t) return null;
  for (const m of t.matchAll(/\bx\s*(\d{1,3})([.,]\d+)?\s*([a-z]*)/g)) {
    const n = Number(m[1]);
    if (m[2] || n < 2 || n > 60) continue; // "x 12.5 gr" es gramaje
    if (/^(cc|ml|cm3|l|lt|lts|litros?|g|gr|grs|grms|gramos?|kg|k|kilos?)$/.test(m[3] ?? '')) continue;
    return n;
  }
  const bandeja = t.match(/\bt(\d{1,2})\b/);
  if (bandeja && Number(bandeja[1]) >= 2 && Number(bandeja[1]) <= 60) return Number(bandeja[1]);
  const porUnidades = t.match(/\b(\d{1,3})\s*(?:u|un|uni|unid|unidades?)\b/);
  if (porUnidades && Number(porUnidades[1]) >= 2 && Number(porUnidades[1]) <= 60) return Number(porUnidades[1]);
  return null;
}

/** Cuántos gramos trae el paquete del catálogo: "x 250 grs", "500g", "x 1 kg". */
export function gramosDeEnvase(nombre: string | null | undefined): number | null {
  const t = normalizar(nombre ?? '');
  if (!t) return null;
  const kg = t.match(/(\d{1,3})([.,](\d{1,3}))?\s*(kg|kilos?|k)\b/);
  if (kg) {
    const n = Number(`${kg[1]}.${kg[3] ?? 0}`) * 1000;
    if (n >= 50 && n <= 30000) return n;
  }
  const gr = t.match(/(\d{2,5})\s*(g|gr|grs|grms|gramos?)\b/);
  if (gr) {
    const n = Number(gr[1]);
    if (n >= 50 && n <= 30000) return n;
  }
  return null;
}

export type Renglon = {
  descripcion?: string | null;
  nombreCatalogo?: string | null;
  cantidad: number;
  precio: number;
  /** costo actual del producto en el catálogo, en SU unidad de stock */
  costoCatalogo?: number | null;
};

export type Conversion = {
  tipo: 'unidades_a_envase' | 'kilo_a_paquete';
  /** unidades por envase, o gramos del paquete */
  factor: number;
  cantidadNueva: number;
  precioNuevo: number;
  motivo: string;
};

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * ¿La factura viene en otra unidad que la del stock? Devuelve la conversión que
 * habría que proponer, o null si el renglón ya está en la unidad correcta.
 */
export function conversionSugerida(r: Renglon): Conversion | null {
  const cantidad = Number(r.cantidad);
  const precio = Number(r.precio);
  if (!(cantidad > 0) || !(precio > 0) || !r.nombreCatalogo) return null;
  const costo = Number(r.costoCatalogo) || 0;
  const papel = normalizar(r.descripcion ?? '');

  // 1 — la factura trae unidades sueltas y el catálogo es un envase de N
  const unidades = unidadesDeEnvase(r.nombreCatalogo);
  if (unidades && cantidad >= unidades && Number.isInteger(cantidad / unidades)) {
    const pareceUnidad = costo > 0
      ? Math.abs(precio * unidades - costo) < Math.abs(precio - costo)
      : /\b(unidad|unid|un|u)\b/.test(papel);
    if (pareceUnidad) {
      return {
        tipo: 'unidades_a_envase',
        factor: unidades,
        cantidadNueva: cantidad / unidades,
        precioNuevo: redondear(precio * unidades),
        motivo: `el producto es el envase de ${unidades} y la factura trae unidades sueltas`,
      };
    }
  }

  // 2 — la factura cobra por KILO y el producto va empaquetado (congelados,
  //     fiambres porcionados). El precio por kilo es el de varios paquetes
  //     juntos, así que contra el costo del catálogo se nota enseguida.
  const gramos = gramosDeEnvase(r.nombreCatalogo);
  if (gramos && gramos < 1000) {
    const porKilo = 1000 / gramos;
    const cantidadNueva = redondear(cantidad * porKilo);
    const precioNuevo = redondear(precio * (gramos / 1000));
    const pareceKilo = costo > 0
      ? Math.abs(precioNuevo - costo) < Math.abs(precio - costo)
      : /\b(kg|kilos?|x\s*kg|por kilo|granel)\b/.test(papel) || porKilo === Math.round(porKilo);
    if (pareceKilo && cantidadNueva > cantidad) {
      return {
        tipo: 'kilo_a_paquete',
        factor: gramos,
        cantidadNueva,
        precioNuevo,
        motivo: `la factura cobra por kilo y el producto viene en paquetes de ${gramos} g`,
      };
    }
  }

  return null;
}

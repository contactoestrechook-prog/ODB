export type Producto = {
  id?: string;
  sku: string;
  nombre: string;
  imagenUrl: string | null;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  descuentoComunidad?: boolean;
  categoria: string | null;
  categoriaId?: string | null;
  marca: string | null;
  esAlcohol?: boolean;
  graduacion?: number | null;
  volumenMl?: number | null;
  unidadesPack?: number | null;
  descripcion?: string | null;
  stockTotal?: number;
  vendidoPorPeso?: boolean;
};

export const pesos = (n: any) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("es-AR"));

export const descuentoPct = (p: Producto): number | null => {
  if (p.precioLista && p.precio && Number(p.precio) < Number(p.precioLista)) {
    return Math.round((1 - Number(p.precio) / Number(p.precioLista)) * 100);
  }
  return null;
};

// Se vende por peso: la marca del producto, o "x fracción" en el nombre (así
// los nombra el sistema viejo). Su precio es por kilo y hay que decirlo: sin el
// "/ kg", "Jamón crudo $82.800" parece el precio de un paquete.
export const porKilo = (p: { vendidoPorPeso?: boolean; nombre?: string | null }) =>
  !!p.vendidoPorPeso || /\bx\s*fracci[oó]n\b|fraccionad|\bx\s*kg\b/i.test(String(p.nombre ?? ""));

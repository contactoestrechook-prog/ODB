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
};

export const pesos = (n: any) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("es-AR"));

export const descuentoPct = (p: Producto): number | null => {
  if (p.precioLista && p.precio && Number(p.precio) < Number(p.precioLista)) {
    return Math.round((1 - Number(p.precio) / Number(p.precioLista)) * 100);
  }
  return null;
};

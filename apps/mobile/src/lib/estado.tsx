import { createContext, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';

// En el celular real, reemplazar localhost por la IP de la máquina que corre la API
export const API = Platform.OS === 'web' ? 'http://localhost:3001' : 'http://192.168.0.10:3001';

export const COLORES = {
  rojo: '#B82D25',
  rojoOscuro: '#932A1F',
  negro: '#000000',
  blanco: '#FFFFFF',
  crema: '#F0EBE2',
};

export type Producto = {
  imagenUrl: string | null;
  sku: string;
  nombre: string;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  esAlcohol: boolean;
  categoria: string | null;
};

type Cliente = {
  dni: string;
  tipo: string;
  nombre?: string | null;
  puntos?: number;
  token?: string;
  verificado?: boolean;
};
type Renglon = Producto & { cantidad: number };

type Estado = {
  cliente: Cliente | null;
  setCliente: (c: Cliente | null) => void;
  carrito: Renglon[];
  agregar: (p: Producto) => void;
  quitar: (sku: string) => void;
  vaciar: () => void;
  total: number;
};

const Contexto = createContext<Estado>(null as any);

export function EstadoProvider({ children }: { children: React.ReactNode }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [carrito, setCarrito] = useState<Renglon[]>([]);

  const valor = useMemo<Estado>(
    () => ({
      cliente,
      setCliente,
      carrito,
      agregar: (p) =>
        setCarrito((c) => {
          const existe = c.find((r) => r.sku === p.sku);
          if (existe) return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + 1 } : r));
          return [...c, { ...p, cantidad: 1 }];
        }),
      quitar: (sku) =>
        setCarrito((c) =>
          c
            .map((r) => (r.sku === sku ? { ...r, cantidad: r.cantidad - 1 } : r))
            .filter((r) => r.cantidad > 0),
        ),
      vaciar: () => setCarrito([]),
      total: carrito.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0),
    }),
    [cliente, carrito],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useEstado = () => useContext(Contexto);

export const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  descuentoComunidad?: boolean;
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

export type MovimientoCta = { concepto: string; debe: number; haber: number; creado_en: string };
export type Cuenta = {
  habilitada: boolean;
  saldo: number;
  limite: number;
  disponible: number | null;
  movimientos: MovimientoCta[];
};
export type Notificacion = { id: number; titulo: string; cuerpo: string; leida: boolean; creado_en: string };

type Estado = {
  cliente: Cliente | null;
  setCliente: (c: Cliente | null) => void;
  carrito: Renglon[];
  agregar: (p: Producto) => void;
  quitar: (sku: string) => void;
  vaciar: () => void;
  total: number;
  cuenta: Cuenta | null;
  notif: { noLeidas: number; lista: Notificacion[] };
  refrescarCuenta: () => Promise<void>;
  marcarLeidas: () => Promise<void>;
};

const Contexto = createContext<Estado>(null as any);

export function EstadoProvider({ children }: { children: React.ReactNode }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [notif, setNotif] = useState<{ noLeidas: number; lista: Notificacion[] }>({ noLeidas: 0, lista: [] });
  const tokenRef = useRef<string | undefined>(undefined);
  tokenRef.current = cliente?.token;

  async function refrescarCuenta() {
    const token = tokenRef.current;
    if (!token) {
      setCuenta(null);
      setNotif({ noLeidas: 0, lista: [] });
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [rc, rn] = await Promise.all([
        fetch(`${API}/mi/cuenta`, { headers }),
        fetch(`${API}/mi/notificaciones`, { headers }),
      ]);
      if (rc.ok) setCuenta(await rc.json());
      if (rn.ok) {
        const d = await rn.json();
        setNotif({ noLeidas: d.noLeidas, lista: d.notificaciones });
      }
    } catch {
      // sin red: se reintenta en el próximo ciclo
    }
  }

  async function marcarLeidas() {
    const token = tokenRef.current;
    if (!token || notif.noLeidas === 0) return;
    setNotif((n) => ({ noLeidas: 0, lista: n.lista.map((x) => ({ ...x, leida: true })) }));
    try {
      await fetch(`${API}/mi/notificaciones/leidas`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }

  // al loguearse (o cambiar de token) carga la cuenta y arranca un poll suave
  useEffect(() => {
    refrescarCuenta();
    if (!cliente?.token) return;
    const id = setInterval(refrescarCuenta, 45000);
    return () => clearInterval(id);
  }, [cliente?.token]);

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
      cuenta,
      notif,
      refrescarCuenta,
      marcarLeidas,
    }),
    [cliente, carrito, cuenta, notif],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useEstado = () => useContext(Contexto);

export const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

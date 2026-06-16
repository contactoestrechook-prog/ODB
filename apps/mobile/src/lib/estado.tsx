import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API } from './config';
import { registrarPush } from './push';

export { API };

// Persistencia segura de la sesión (SecureStore en el celu, localStorage en web)
const SESION_KEY = 'odb_cliente';
const sesionStore = {
  async get(): Promise<string | null> {
    try { return Platform.OS === 'web' ? (typeof localStorage !== 'undefined' ? localStorage.getItem(SESION_KEY) : null) : await SecureStore.getItemAsync(SESION_KEY); } catch { return null; }
  },
  async set(v: string) { try { if (Platform.OS === 'web') localStorage?.setItem(SESION_KEY, v); else await SecureStore.setItemAsync(SESION_KEY, v); } catch {} },
  async del() { try { if (Platform.OS === 'web') localStorage?.removeItem(SESION_KEY); else await SecureStore.deleteItemAsync(SESION_KEY); } catch {} },
};
const tokenVigente = (token?: string) => {
  if (!token) return false;
  try { const p = JSON.parse(globalThis.atob(token.split('.')[1])); return !p.exp || p.exp * 1000 > Date.now(); } catch { return true; }
};

export const COLORES = {
  rojo: '#B82D25',
  rojoOscuro: '#932A1F',
  negro: '#000000',
  blanco: '#FFFFFF',
  crema: '#F0EBE2',
};

export type Producto = {
  id?: string;
  imagenUrl: string | null;
  descuentoComunidad?: boolean;
  sku: string;
  nombre: string;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  esAlcohol: boolean;
  categoria: string | null;
  stockTotal?: number;
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
  agregarVarios: (items: { p: Producto; cantidad: number }[]) => void;
  quitar: (sku: string) => void;
  vaciar: () => void;
  total: number;
  cuenta: Cuenta | null;
  notif: { noLeidas: number; lista: Notificacion[] };
  refrescarCuenta: () => Promise<void>;
  marcarLeidas: () => Promise<void>;
  favoritos: Set<string>;
  esFavorito: (id?: string) => boolean;
  alternarFavorito: (id?: string) => void;
};

const Contexto = createContext<Estado>(null as any);

export function EstadoProvider({ children }: { children: React.ReactNode }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [notif, setNotif] = useState<{ noLeidas: number; lista: Notificacion[] }>({ noLeidas: 0, lista: [] });
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const tokenRef = useRef<string | undefined>(undefined);
  tokenRef.current = cliente?.token;
  const [hidratado, setHidratado] = useState(false);

  // Al abrir la app: recupera la sesión guardada (si el token sigue vigente).
  useEffect(() => {
    (async () => {
      const raw = await sesionStore.get();
      if (raw) {
        try {
          const c = JSON.parse(raw);
          if (c?.token && tokenVigente(c.token)) setCliente(c);
          else await sesionStore.del();
        } catch { await sesionStore.del(); }
      }
      setHidratado(true);
    })();
  }, []);

  // Persiste (o borra) la sesión cada vez que cambia, una vez hidratado.
  useEffect(() => {
    if (!hidratado) return;
    if (cliente?.token) sesionStore.set(JSON.stringify(cliente));
    else sesionStore.del();
  }, [cliente, hidratado]);

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

  async function cargarFavoritos() {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const r = await fetch(`${API}/mi/favoritos`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const cards = await r.json();
        setFavoritos(new Set((cards ?? []).map((c: any) => c.id).filter(Boolean)));
      }
    } catch {}
  }

  function alternarFavorito(id?: string) {
    const token = tokenRef.current;
    if (!token || !id) return;
    setFavoritos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    fetch(`${API}/mi/favoritos/${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
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

  // al loguearse (o cambiar de token) carga la cuenta, registra el push
  // del dispositivo y arranca un poll suave
  useEffect(() => {
    refrescarCuenta();
    if (!cliente?.token) {
      setFavoritos(new Set());
      return;
    }
    registrarPush(cliente.token);
    cargarFavoritos();
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
      // "Volver a comprar": suma varios productos al carrito de una (con su cantidad)
      agregarVarios: (items) =>
        setCarrito((c) => {
          const mapa = new Map(c.map((r) => [r.sku, { ...r }]));
          for (const { p, cantidad } of items) {
            if (!p?.sku || !cantidad) continue;
            const ex = mapa.get(p.sku);
            if (ex) ex.cantidad += cantidad;
            else mapa.set(p.sku, { ...p, cantidad });
          }
          return [...mapa.values()];
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
      favoritos,
      esFavorito: (id) => !!id && favoritos.has(id),
      alternarFavorito,
    }),
    [cliente, carrito, cuenta, notif, favoritos],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useEstado = () => useContext(Contexto);

export const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

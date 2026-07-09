import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API } from './config';
import { configurarApi, apiGet, apiPost } from './api';
import { registrarPush } from './push';

export { API };

// Almacén seguro genérico (SecureStore en el celu, localStorage en web).
function almacen(clave: string) {
  return {
    async get(): Promise<string | null> {
      try {
        return Platform.OS === 'web'
          ? typeof localStorage !== 'undefined'
            ? localStorage.getItem(clave)
            : null
          : await SecureStore.getItemAsync(clave);
      } catch {
        return null;
      }
    },
    async set(v: string) {
      try {
        if (Platform.OS === 'web') localStorage?.setItem(clave, v);
        else await SecureStore.setItemAsync(clave, v);
      } catch {}
    },
    async del() {
      try {
        if (Platform.OS === 'web') localStorage?.removeItem(clave);
        else await SecureStore.deleteItemAsync(clave);
      } catch {}
    },
  };
}

// Persistencia de la sesión y del carrito (para que no se pierda al cerrar la app)
const sesionStore = almacen('odb_cliente');
const carritoStore = almacen('odb_carrito');
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
  cerrarSesion: () => void;
  sesionExpirada: boolean;
  limpiarAvisoSesion: () => void;
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
  const [sesionExpirada, setSesionExpirada] = useState(false);
  const tokenRef = useRef<string | undefined>(undefined);
  const [hidratado, setHidratado] = useState(false);

  // Cierra la sesión (logout manual o token expirado). `expirada` muestra el aviso.
  function cerrarSesion(expirada = false) {
    setCliente(null);
    setCuenta(null);
    setNotif({ noLeidas: 0, lista: [] });
    setFavoritos(new Set());
    if (expirada) setSesionExpirada(true);
  }

  // Espejo del token para closures estables (el api client lo lee por request).
  // Declarado ANTES de los demás efectos: en un mismo commit corre primero.
  useEffect(() => {
    tokenRef.current = cliente?.token;
  }, [cliente?.token]);

  // Registra el cliente HTTP una sola vez: cómo leer el token (lazy, siempre
  // el vigente vía tokenRef) y qué hacer ante un 401/403.
  useEffect(() => {
    configurarApi({
      getToken: () => tokenRef.current,
      onUnauthorized: () => cerrarSesion(true),
    });
  }, []);

  // Al abrir la app: recupera la sesión guardada (si el token sigue vigente) y
  // el carrito persistido.
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
      const rawCarrito = await carritoStore.get();
      if (rawCarrito) {
        try {
          const items = JSON.parse(rawCarrito);
          if (Array.isArray(items)) setCarrito(items);
        } catch { await carritoStore.del(); }
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

  // Persiste el carrito para que sobreviva al cierre de la app.
  useEffect(() => {
    if (!hidratado) return;
    if (carrito.length) carritoStore.set(JSON.stringify(carrito));
    else carritoStore.del();
  }, [carrito, hidratado]);

  async function refrescarCuenta() {
    const token = tokenRef.current;
    if (!token) {
      setCuenta(null);
      setNotif({ noLeidas: 0, lista: [] });
      return;
    }
    try {
      const [c, n] = await Promise.all([
        apiGet<Cuenta>('/mi/cuenta'),
        apiGet<{ noLeidas: number; notificaciones: Notificacion[] }>('/mi/notificaciones'),
      ]);
      setCuenta(c);
      setNotif({ noLeidas: n.noLeidas, lista: n.notificaciones });
    } catch {
      // sin red o token expirado: el api client ya maneja el 401; se reintenta al próximo ciclo
    }
  }

  async function cargarFavoritos() {
    if (!tokenRef.current) return;
    try {
      const cards = await apiGet<{ id?: string }[]>('/mi/favoritos');
      setFavoritos(new Set((cards ?? []).map((c) => c.id).filter(Boolean) as string[]));
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
    apiPost(`/mi/favoritos/${id}`).catch(() => {});
  }

  async function marcarLeidas() {
    const token = tokenRef.current;
    if (!token || notif.noLeidas === 0) return;
    setNotif((n) => ({ noLeidas: 0, lista: n.lista.map((x) => ({ ...x, leida: true })) }));
    try {
      await apiPost('/mi/notificaciones/leidas');
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
      cerrarSesion: () => cerrarSesion(false),
      sesionExpirada,
      limpiarAvisoSesion: () => setSesionExpirada(false),
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
    [cliente, carrito, cuenta, notif, favoritos, sesionExpirada],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useEstado = () => useContext(Contexto);

export const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

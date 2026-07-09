import { API } from './config';

// Cliente HTTP único de la app. Centraliza: base URL, header Authorization,
// timeout, parseo de errores y — clave para producción — el manejo de sesión
// expirada (401/403 → cierra la sesión y lleva al login).

let obtenerToken: () => string | undefined = () => undefined;
let alExpirar: () => void = () => {};

// El EstadoProvider registra acá cómo leer el token y qué hacer cuando expira.
export function configurarApi(opts: { getToken: () => string | undefined; onUnauthorized: () => void }) {
  obtenerToken = opts.getToken;
  alExpirar = opts.onUnauthorized;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
  /** true si el fallo fue de red/timeout (no una respuesta del servidor). */
  get esRed() {
    return this.status === 0;
  }
}

// --- Señal de conectividad (sin dependencias): la infiere del propio tráfico.
// Un fallo de red/timeout marca offline; cualquier respuesta del servidor
// (aunque sea un error HTTP) marca online.
type EstadoRed = 'online' | 'offline';
let estadoRed: EstadoRed = 'online';
const oyentesRed = new Set<(e: EstadoRed) => void>();

export function onEstadoRed(cb: (e: EstadoRed) => void): () => void {
  oyentesRed.add(cb);
  cb(estadoRed);
  return () => oyentesRed.delete(cb);
}

function marcarRed(e: EstadoRed) {
  if (estadoRed === e) return;
  estadoRed = e;
  for (const cb of oyentesRed) cb(e);
}

type Opciones = Omit<RequestInit, 'signal' | 'body'> & {
  auth?: boolean;
  timeoutMs?: number;
  body?: any;
};

export async function api<T = any>(path: string, opciones: Opciones = {}): Promise<T> {
  const { auth = true, timeoutMs = 12000, headers, body, ...resto } = opciones;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const h: Record<string, string> = { ...(headers as Record<string, string>) };
  if (body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (auth) {
    const t = obtenerToken();
    if (t) h.Authorization = `Bearer ${t}`;
  }

  try {
    const res = await fetch(`${API}${path}`, {
      ...resto,
      headers: h,
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    });
    marcarRed('online'); // el servidor respondió (aunque sea con error HTTP)

    if ((res.status === 401 || res.status === 403) && auth) {
      alExpirar();
      throw new ApiError(res.status, 'Tu sesión expiró. Ingresá de nuevo.');
    }

    const texto = await res.text();
    let data: any = null;
    if (texto) {
      try {
        data = JSON.parse(texto);
      } catch {
        data = texto;
      }
    }

    if (!res.ok) {
      const m = data && typeof data === 'object' ? data.message ?? data.error : null;
      throw new ApiError(res.status, Array.isArray(m) ? m.join(', ') : String(m ?? `Error ${res.status}`));
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    marcarRed('offline');
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new ApiError(0, 'La conexión tardó demasiado. Reintentá.');
    }
    throw new ApiError(0, 'Sin conexión. Revisá tu internet.');
  } finally {
    clearTimeout(timer);
  }
}

export const apiGet = <T = any>(path: string, o?: Opciones) => api<T>(path, { ...o, method: 'GET' });
export const apiPost = <T = any>(path: string, body?: any, o?: Opciones) =>
  api<T>(path, { ...o, method: 'POST', body });

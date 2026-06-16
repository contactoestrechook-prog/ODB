import { cookies } from "next/headers";

export const API = process.env.API_URL ?? "http://localhost:3001";

// Fetch a la API ODB reenviando el token del cliente (cookie) para que el
// catálogo venga con los precios de SU segmento.
export async function api(path: string, init?: RequestInit) {
  const t = (await cookies()).get("odb_cliente")?.value;
  return fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });
}

export async function apiJson<T = any>(path: string, fallback: T): Promise<T> {
  try {
    const r = await api(path);
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

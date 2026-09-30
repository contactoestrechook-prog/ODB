"use client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const STORAGE_KEY = "gc_admin_key";

export function getAdminKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setAdminKey(key: string) {
  window.localStorage.setItem(STORAGE_KEY, key);
}

export function cerrarSesion() {
  window.localStorage.removeItem(STORAGE_KEY);
}

// Wrapper de fetch que agrega la clave de administrador (Fase 1: un solo
// usuario, ver auth/admin-key.guard.ts en gastro-api). Si el server responde
// 401, limpia la clave guardada para que el AdminGate vuelva a pedirla.
export async function api(path: string, init?: RequestInit) {
  const key = getAdminKey();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    cerrarSesion();
    window.location.reload();
    throw new Error("Clave inválida");
  }
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(texto || `Error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

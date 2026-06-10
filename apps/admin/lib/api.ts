import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function apiFetch(path: string, init?: RequestInit) {
  const token = (await cookies()).get('odb_token')?.value;
  return fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export { API };

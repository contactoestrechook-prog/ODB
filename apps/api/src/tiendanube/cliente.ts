// Cliente REST de Tienda Nube (Nuvemshop) · IO puro. Lee credenciales del entorno;
// si no están, queda inerte (configurado()=false) y el módulo no rompe.
//   TIENDANUBE_STORE_ID      id de la tienda
//   TIENDANUBE_ACCESS_TOKEN  token de acceso de la app instalada

import { fetchConTimeout } from '../comun/http';

const BASE = 'https://api.tiendanube.com/v1';

export function tnConfig() {
  return {
    storeId: process.env.TIENDANUBE_STORE_ID || '',
    token: process.env.TIENDANUBE_ACCESS_TOKEN || '',
  };
}
export function tnConfigurado() {
  const { storeId, token } = tnConfig();
  return !!(storeId && token);
}

async function tnFetch(path: string, init: RequestInit = {}) {
  const { storeId, token } = tnConfig();
  if (!storeId || !token) throw new Error('Tienda Nube no está configurada (faltan TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN)');
  const res = await fetchConTimeout(`${BASE}/${storeId}${path}`, {
    ...init,
    headers: {
      Authentication: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ODB Premium Market (soporte@odb.com.ar)',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Tienda Nube ${res.status}: ${detalle.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const tnGet = (path: string) => tnFetch(path, { method: 'GET' });
export const tnPost = (path: string, body: any) => tnFetch(path, { method: 'POST', body: JSON.stringify(body) });
export const tnPut = (path: string, body: any) => tnFetch(path, { method: 'PUT', body: JSON.stringify(body) });

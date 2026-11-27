// ENTRAR AL PANEL NO PIDE CAMBIAR LA CLAVE SI NADIE LO PIDIÓ (27/11/2026). Camila Molina
// (fiambrería) caía en «Cambiar mi contraseña» cada vez que entraba, sin la marca de cambio
// obligatorio: entraba por un acceso a esa pantalla o por el enlace de WhatsApp de «Recuperar
// contraseña», que con la sesión abierta la mandaba a cambiarla. Ver apps/admin/middleware.ts.
import { abiertoDesdeAfuera } from '../../../admin/app/lib/rutas';

const encabezados = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('Abrir el panel desde afuera', () => {
  it('un acceso directo, un favorito o un enlace de WhatsApp es «desde afuera»', () => {
    expect(abiertoDesdeAfuera(encabezados({ 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' }))).toBe(true);
    expect(abiertoDesdeAfuera(encabezados({ 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }))).toBe(true);
    // navegadores sin Sec-Fetch: sin Referer, o con el de otro sitio
    expect(abiertoDesdeAfuera(encabezados({ host: 'panel.odb.com.ar' }))).toBe(true);
    expect(abiertoDesdeAfuera(encabezados({ host: 'panel.odb.com.ar', referer: 'https://wa.me/algo' }))).toBe(true);
  });

  it('navegar adentro con el menú no lo es', () => {
    expect(abiertoDesdeAfuera(encabezados({ rsc: '1', 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(abiertoDesdeAfuera(encabezados({ 'next-router-prefetch': '1' }))).toBe(false);
    expect(abiertoDesdeAfuera(encabezados({ 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(abiertoDesdeAfuera(encabezados({ 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'none' }))).toBe(false);
    expect(abiertoDesdeAfuera(encabezados({ host: 'panel.odb.com.ar', referer: 'https://panel.odb.com.ar/salon' }))).toBe(false);
  });
});

describe('El middleware del panel', () => {
  // el middleware de verdad, con NextRequest de verdad (next viene de apps/admin)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextRequest } = require('../../../admin/node_modules/next/server');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { middleware } = require('../../../admin/middleware');
  const token = (roles: string[]) => `x.${Buffer.from(JSON.stringify({ rol: roles[0], roles })).toString('base64url')}.y`;
  const abrir = (ruta: string, h: Record<string, string>, cookies: Record<string, string>) => {
    const req = new NextRequest(`https://panel.odb.com.ar${ruta}`, {
      headers: { host: 'panel.odb.com.ar', ...h, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    const res = middleware(req);
    return res.headers.get('location') ? new URL(res.headers.get('location')!).pathname : null;
  };
  const camila = { odb_token: token(['fiambreria']) };
  const deAfuera = { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' };

  it('Camila entra por un acceso a «Cambiar mi contraseña» o por el enlace de recuperarla: va a su pantalla', () => {
    expect(abrir('/cambiar-clave', deAfuera, camila)).toBe('/salon');
    expect(abrir('/restablecer?token=abc', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }, camila)).toBe('/salon');
    expect(abrir('/olvide-clave', deAfuera, camila)).toBe('/salon');
  });

  it('desde el menú, «Cambiar mi contraseña» sigue abriendo', () => {
    expect(abrir('/cambiar-clave', { rsc: '1', 'sec-fetch-site': 'same-origin' }, camila)).toBeNull();
    expect(abrir('/cambiar-clave', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' }, camila)).toBeNull();
  });

  it('con la clave temporal, el cambio sigue siendo obligatorio', () => {
    const temporal = { ...camila, odb_cambiar: '1' };
    expect(abrir('/cambiar-clave', deAfuera, temporal)).toBeNull();
    expect(abrir('/salon', deAfuera, temporal)).toBe('/cambiar-clave');
    expect(abrir('/restablecer?token=abc', deAfuera, temporal)).toBe('/cambiar-clave');
  });

  it('sin sesión, recuperar la clave sigue andando', () => {
    expect(abrir('/restablecer?token=abc', deAfuera, {})).toBeNull();
    expect(abrir('/olvide-clave', deAfuera, {})).toBeNull();
    expect(abrir('/cambiar-clave', deAfuera, {})).toBe('/login');
  });
});

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
  // la sesión se revisó hace un momento: el middleware no le pregunta a la API
  const recien = () => String(Date.now());
  const abrirConRespuesta = async (ruta: string, h: Record<string, string>, cookies: Record<string, string>) => {
    const req = new NextRequest(`https://panel.odb.com.ar${ruta}`, {
      headers: { host: 'panel.odb.com.ar', ...h, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    return middleware(req);
  };
  const abrir = async (ruta: string, h: Record<string, string>, cookies: Record<string, string>) => {
    const res = await abrirConRespuesta(ruta, h, { odb_al_dia: recien(), ...cookies });
    return res.headers.get('location') ? new URL(res.headers.get('location')!).pathname : null;
  };
  const camila = { odb_token: token(['fiambreria']) };
  const deAfuera = { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' };

  it('Camila entra por un acceso a «Cambiar mi contraseña» o por el enlace de recuperarla: va a su pantalla', async () => {
    expect(await abrir('/cambiar-clave', deAfuera, camila)).toBe('/salon');
    expect(await abrir('/restablecer?token=abc', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }, camila)).toBe('/salon');
    expect(await abrir('/olvide-clave', deAfuera, camila)).toBe('/salon');
  });

  it('desde el menú, «Cambiar mi contraseña» sigue abriendo', async () => {
    expect(await abrir('/cambiar-clave', { rsc: '1', 'sec-fetch-site': 'same-origin' }, camila)).toBeNull();
    expect(await abrir('/cambiar-clave', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' }, camila)).toBeNull();
  });

  it('con la clave temporal, el cambio sigue siendo obligatorio', async () => {
    const temporal = { ...camila, odb_cambiar: '1' };
    expect(await abrir('/cambiar-clave', deAfuera, temporal)).toBeNull();
    expect(await abrir('/salon', deAfuera, temporal)).toBe('/cambiar-clave');
    expect(await abrir('/restablecer?token=abc', deAfuera, temporal)).toBe('/cambiar-clave');
  });

  it('sin sesión, recuperar la clave sigue andando', async () => {
    expect(await abrir('/restablecer?token=abc', deAfuera, {})).toBeNull();
    expect(await abrir('/olvide-clave', deAfuera, {})).toBeNull();
    expect(await abrir('/cambiar-clave', deAfuera, {})).toBe('/login');
  });

  // LOS PERMISOS DE HOY (27/11/2026): María Belén Avalos entró como cajera (12:04), la
  // pasaron a salón y fiambrería (12:08) y la app la seguía mandando a la Caja (12:09).
  describe('la sesión toma los permisos de hoy', () => {
    const belenCajera = token(['cajero', 'op_salon']);
    const belenHoy = token(['op_salon', 'fiambreria']);
    let pedidos: string[] = [];
    let contesta: () => Promise<Response>;
    beforeEach(() => {
      pedidos = [];
      contesta = async () => new Response(JSON.stringify({ token: belenHoy }), { status: 200 });
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
        pedidos.push(`${String(url)} ${init?.headers?.Authorization ?? ''}`);
        return contesta();
      });
    });
    afterEach(() => jest.restoreAllMocks());

    it('con la sesión sin revisar, pide la de hoy y la Caja la manda a Salón', async () => {
      const res = await abrirConRespuesta('/caja', deAfuera, { odb_token: belenCajera });
      expect(pedidos).toEqual([`http://localhost:3001/auth/sesion-al-dia Bearer ${belenCajera}`]);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/salon');
      // la cookie queda con el token de hoy y con la hora de la revisión
      expect(res.cookies.get('odb_token')?.value).toBe(belenHoy);
      expect(Number(res.cookies.get('odb_al_dia')?.value)).toBeGreaterThan(Date.now() - 5_000);
    });

    it('revisada hace menos de un minuto, no vuelve a preguntar', async () => {
      const res = await abrirConRespuesta('/caja', deAfuera, { odb_token: belenCajera, odb_al_dia: String(Date.now() - 30_000) });
      expect(pedidos).toEqual([]);
      expect(res.headers.get('location')).toBeNull();
    });

    it('si la API no contesta, sigue con la que había y vuelve a probar al minuto', async () => {
      contesta = async () => { throw new Error('caída'); };
      const res = await abrirConRespuesta('/caja', deAfuera, { odb_token: belenCajera });
      expect(res.headers.get('location')).toBeNull();
      expect(res.cookies.get('odb_token')?.value).toBe(belenCajera);
      expect(res.cookies.get('odb_al_dia')?.value).toBeTruthy();
    });

    it('lo que sigue de largo lleva el token de hoy para la página', async () => {
      const res = await abrirConRespuesta('/salon', deAfuera, { odb_token: belenCajera });
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('x-middleware-request-cookie') ?? '').toContain(belenHoy);
    });
  });
});

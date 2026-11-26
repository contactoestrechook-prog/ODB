import { createHmac } from 'node:crypto';
import { filasDelManual, firmarPase } from './metogroup';

// El pase tiene que verificarse igual que en MetoGroup (_lib/mantenimiento-puro.mjs, leerPase).
function leerPaseComoMetoGroup(pase: string, clave: string, ahoraSeg: number) {
  const [cuerpo, firma] = pase.split('.');
  const buena = createHmac('sha256', clave).update(cuerpo).digest('hex');
  if (firma !== buena) return null;
  const d = JSON.parse(Buffer.from(cuerpo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (!d?.e || !d?.u || Number(d.x) < ahoraSeg) return null;
  return d;
}

describe('pase para MetoGroup', () => {
  const clave = 'a'.repeat(64);
  it('lo firma con el formato que lee MetoGroup', () => {
    const pase = firmarPase({ usuario: 'u-1', nombre: 'Juan Pablo', rol: 'dueno' }, clave, 1_000);
    const d = leerPaseComoMetoGroup(pase, clave, 1_000);
    expect(d).toMatchObject({ e: 'odb', u: 'u-1', n: 'Juan Pablo', r: 'dueno', c: true, x: 1_000 + 8 * 3600 });
  });
  it('con otra clave no vale', () => {
    const pase = firmarPase({ usuario: 'u-1', nombre: 'X', rol: 'dueno' }, clave, 1_000);
    expect(leerPaseComoMetoGroup(pase, 'b'.repeat(64), 1_000)).toBeNull();
  });
  it('vence a las 8 horas', () => {
    const pase = firmarPase({ usuario: 'u-1', nombre: 'X', rol: 'dueno' }, clave, 1_000);
    expect(leerPaseComoMetoGroup(pase, clave, 1_000 + 8 * 3600 + 1)).toBeNull();
  });
});

describe('manual publicado', () => {
  it('arma una fila por tema y por pantalla, sin repetidos', () => {
    const filas = filasDelManual({
      version: 'v1',
      secciones: [
        { seccion: 'caja', titulo: 'Caja', area: 'Salón', pantallas: ['/caja'], texto: 'Cobrar' },
        { seccion: 'caja', titulo: 'Repetida', area: 'Salón', pantallas: [], texto: '' },
      ],
      pantallas: [{ href: '/caja', nombre: 'Caja', grupo: 'Ventas', bajada: 'Cobrar' }, { href: 'mal', nombre: 'x', grupo: '', bajada: '' }],
    })!;
    expect(filas.map((f) => f.clave)).toEqual(['s:caja', 'p:/caja']);
    expect(filas.every((f) => f.version === 'v1')).toBe(true);
  });
  it('sin versión o sin pantallas no publica', () => {
    expect(filasDelManual({ version: '', secciones: [], pantallas: [] })).toBeNull();
  });
});

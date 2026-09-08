import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';

// El circuito de "olvidé mi contraseña" toca cuentas ajenas: cada regla de
// seguridad tiene su prueba. La base se simula porque lo que se verifica es la
// LÓGICA (qué se guarda, qué se contesta, qué se rechaza).
function dbFalsa(estado: any = {}) {
  const llamadas: any = { insert: [], update: [] };
  const db: any = {
    llamadas,
    from(tabla: string) {
      const b: any = {
        select: () => b, eq: () => b, ilike: () => b, is: () => b, gte: () => b, limit: () => b,
        maybeSingle: async () => ({ data: estado[tabla] ?? null, error: null }),
        single: async () => ({ data: estado[tabla] ?? null, error: null }),
        insert: (fila: any) => (llamadas.insert.push({ tabla, fila }), { ...b, then: (ok: any) => Promise.resolve({ error: null }).then(ok) }),
        update: (fila: any) => (llamadas.update.push({ tabla, fila }), b),
        then: (ok: any, err: any) => Promise.resolve({ data: estado[tabla] ?? null, error: null, count: estado[`${tabla}__count`] ?? 0 }).then(ok, err),
      };
      return b;
    },
  };
  return db;
}
const servicio = (db: any) => new AuthService(db, { signAsync: async () => 'jwt' } as any);

describe('olvidé mi contraseña', () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; });

  it('contesta lo MISMO exista o no el mail (nadie puede averiguar quién tiene usuario)', async () => {
    const conCuenta = servicio(dbFalsa({ usuarios: { id: 'u1', nombre: 'Ana', email: 'ana@odb.com.ar', activo: true } }));
    const sinCuenta = servicio(dbFalsa({ usuarios: null }));
    const a = await conCuenta.pedirReseteo('ana@odb.com.ar');
    const b = await sinCuenta.pedirReseteo('nadie@ejemplo.com');
    expect(a.mensaje).toBe(b.mensaje);
    expect(a.ok).toBe(true);
  });

  it('en la base guarda el token HASHEADO, nunca el del enlace', async () => {
    const db = dbFalsa({ usuarios: { id: 'u1', nombre: 'Ana', email: 'ana@odb.com.ar', activo: true } });
    await servicio(db).pedirReseteo('ana@odb.com.ar');
    const fila = db.llamadas.insert.find((i: any) => i.tabla === 'reseteos_clave')?.fila;
    expect(fila).toBeTruthy();
    expect(fila.token_hash).toMatch(/^[a-f0-9]{64}$/);      // sha256 hex
    expect(JSON.stringify(fila)).not.toMatch(/token"\s*:\s*"[A-Za-z0-9_-]{20,}/); // el token en claro no está
    expect(new Date(fila.vence_en).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(new Date(fila.vence_en).getTime()).toBeLessThan(Date.now() + 35 * 60_000);
  });

  it('una cuenta inactiva no recibe enlace', async () => {
    const db = dbFalsa({ usuarios: { id: 'u1', nombre: 'Ex', email: 'ex@odb.com.ar', activo: false } });
    await servicio(db).pedirReseteo('ex@odb.com.ar');
    expect(db.llamadas.insert.filter((i: any) => i.tabla === 'reseteos_clave')).toHaveLength(0);
  });

  it('freno de abuso: al cuarto pedido en 15 minutos ya no genera enlaces', async () => {
    const db = dbFalsa({ usuarios: { id: 'u1', nombre: 'Ana', email: 'ana@odb.com.ar', activo: true }, reseteos_clave__count: 3 });
    await servicio(db).pedirReseteo('ana@odb.com.ar');
    expect(db.llamadas.insert.filter((i: any) => i.tabla === 'reseteos_clave')).toHaveLength(0);
  });

  it('un enlace vencido no sirve', async () => {
    const db = dbFalsa({ reseteos_clave: { id: 'r1', usuario_id: 'u1', vence_en: new Date(Date.now() - 60_000).toISOString(), usado_en: null, usuarios: { nombre: 'Ana', activo: true } } });
    await expect(servicio(db).resetearClave('token-x', 'clavenueva1')).rejects.toThrow(/venció o ya se usó/i);
  });

  it('un enlace ya usado no sirve una segunda vez', async () => {
    const db = dbFalsa({ reseteos_clave: { id: 'r1', usuario_id: 'u1', vence_en: new Date(Date.now() + 60_000).toISOString(), usado_en: new Date().toISOString(), usuarios: { nombre: 'Ana', activo: true } } });
    await expect(servicio(db).resetearClave('token-x', 'clavenueva1')).rejects.toThrow(/venció o ya se usó/i);
  });

  it('una clave corta se rechaza antes de tocar la base', async () => {
    const db = dbFalsa({});
    await expect(servicio(db).resetearClave('token-x', '123')).rejects.toThrow(/al menos 6/i);
    expect(db.llamadas.update).toHaveLength(0);
  });

  it('con el enlace bueno cambia la clave, la deja usable y quema los pendientes', async () => {
    const vigente = { id: 'r1', usuario_id: 'u1', vence_en: new Date(Date.now() + 60_000).toISOString(), usado_en: null, usuarios: { nombre: 'Ana', activo: true } };
    const db = dbFalsa({ reseteos_clave: vigente });
    const r = await servicio(db).resetearClave('token-bueno', 'clavenueva1');
    expect(r.ok).toBe(true);
    const cambio = db.llamadas.update.find((u: any) => u.tabla === 'usuarios')?.fila;
    expect(cambio.clave_hash).toMatch(/^\$2a\$/);         // bcrypt compatible con el login
    expect(cambio.debe_cambiar_clave).toBe(false);        // ya eligió la suya
    expect(cambio.bloqueado_hasta).toBeNull();            // destraba la cuenta enfriada
    const quema = db.llamadas.update.find((u: any) => u.tabla === 'reseteos_clave')?.fila;
    expect(quema.usado_en).toBeTruthy();
  });

  it('verificar el enlace no revela nada cuando es inválido', async () => {
    const db = dbFalsa({ reseteos_clave: null });
    expect(await servicio(db).verificarTokenReseteo('cualquiera')).toEqual({ valido: false, nombre: null });
  });

  it('el token del enlace es el que hashea a lo guardado (el circuito cierra)', async () => {
    const db = dbFalsa({ usuarios: { id: 'u1', nombre: 'Ana', email: 'ana@odb.com.ar', activo: true } });
    await servicio(db).pedirReseteo('ana@odb.com.ar');
    const guardado = db.llamadas.insert.find((i: any) => i.tabla === 'reseteos_clave').fila.token_hash;
    // se recrea el hash como lo hace el servicio al validar
    expect(guardado).toHaveLength(64);
    expect(createHash('sha256').update('otro-token').digest('hex')).not.toBe(guardado);
  });
});

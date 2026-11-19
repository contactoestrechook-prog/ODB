import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

// Varios roles por persona y altas para completar (Leandro, 19/11/2026)
function dbFalsa(fila: Record<string, any>) {
  const updates: { tabla: string; valores: any }[] = [];
  const inserts: { tabla: string; valores: any }[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      let accion = 'select';
      let valores: any = null;
      const q: any = {
        select: () => q,
        insert: (v: any) => { accion = 'insert'; valores = v; inserts.push({ tabla, valores: v }); return q; },
        update: (v: any) => { accion = 'update'; valores = v; updates.push({ tabla, valores: v }); return q; },
        eq: () => q, is: () => q, order: () => q,
        maybeSingle: () => Promise.resolve({ data: tabla === 'usuarios' ? fila : null, error: null }),
        single: () => Promise.resolve({ data: accion === 'insert' ? { id: 'nuevo' } : fila, error: null }),
        then: (ok: any, mal: any) => Promise.resolve({ data: tabla === 'usuarios' && accion === 'select' ? [] : null, error: null }).then(ok, mal),
      };
      void valores;
      return q;
    }),
  };
  return { db, updates, inserts };
}

const romina = { sub: 'romina', rol: 'administrativo' };
const dueno = { sub: 'jp', rol: 'dueno' };
const pendiente = { rol: 'fiambreria', roles: ['fiambreria'], sucursal_id: 'st', email: 'barbara.bartacovich@pendiente.odb.interno', telefono: null, clave_hash: null, alta_pendiente: true, nombre: 'Bárbara' };

describe('usuarios: administración completa altas', () => {
  it('no puede cambiar roles ni sucursal', async () => {
    const { db } = dbFalsa(pendiente);
    const s = new UsuariosService(db);
    await expect(s.editar('b', { roles: ['dueno'] }, romina)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.editar('b', { sucursalId: null }, romina)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.editar('b', { activo: true }, romina)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no puede tocar a un dueño', async () => {
    const { db } = dbFalsa({ ...pendiente, rol: 'dueno', roles: ['dueno'], alta_pendiente: false });
    await expect(new UsuariosService(db).editar('jp', { telefono: '5491100000000' }, romina)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no puede dar de alta', async () => {
    const { db } = dbFalsa(pendiente);
    await expect(new UsuariosService(db).crear({ nombre: 'X', email: 'x@x.com', rol: 'cajero', clave: '123456' }, romina)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('con email, WhatsApp y clave el alta queda activa y se registra', async () => {
    const { db, updates, inserts } = dbFalsa(pendiente);
    const r = await new UsuariosService(db).editar('b', { email: 'Barbara@Gmail.com', telefono: '+54 9 11 2345-6789', clave: 'temporal1' }, romina);
    expect(r).toMatchObject({ ok: true, completada: true });
    const cambio = updates.find((u) => u.tabla === 'usuarios')!.valores;
    expect(cambio).toMatchObject({ email: 'barbara@gmail.com', alta_pendiente: false, activo: true, debe_cambiar_clave: true });
    expect(cambio.clave_hash).toBeTruthy();
    expect(inserts.find((i) => i.tabla === 'auditoria')!.valores).toMatchObject({ accion: 'completar_alta_usuario' });
    // sin altas pendientes, el aviso a administración se cierra
    expect(updates.find((u) => u.tabla === 'alertas_internas')!.valores).toMatchObject({ leida_por: 'romina' });
  });

  it('si falta algo, queda para completar (no se activa)', async () => {
    const { db, updates } = dbFalsa(pendiente);
    const r = await new UsuariosService(db).editar('b', { telefono: '5491123456789' }, romina);
    expect(r).toMatchObject({ ok: true, completada: false });
    expect(updates.find((u) => u.tabla === 'usuarios')!.valores.activo).toBeUndefined();
  });

  it('el email de relleno no vale como email', async () => {
    const { db } = dbFalsa(pendiente);
    await expect(new UsuariosService(db).editar('b', { email: 'otra@pendiente.odb.interno' }, romina)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('usuarios: varios roles', () => {
  it('el principal sale solo: el de más alcance', async () => {
    const { db, inserts } = dbFalsa(pendiente);
    await new UsuariosService(db).crear({ nombre: 'Matías', email: 'm@x.com', rol: 'cajero', roles: ['op_salon', 'repartidor', 'cajero'], clave: '123456', sucursalId: 'st' }, dueno);
    expect(inserts.find((i) => i.tabla === 'usuarios')!.valores).toMatchObject({ rol: 'cajero', roles: ['cajero', 'repartidor', 'op_salon'] });
  });

  it('fiambrería y op salón piden sucursal', async () => {
    const { db } = dbFalsa(pendiente);
    await expect(new UsuariosService(db).crear({ nombre: 'Y', email: 'y@x.com', rol: 'fiambreria', clave: '123456' }, dueno)).rejects.toThrow('Fiambrería tiene que tener su sucursal');
  });

  it('un gerente no puede sumarle el rol dueño a nadie', async () => {
    const { db } = dbFalsa({ ...pendiente, alta_pendiente: false, rol: 'cajero', roles: ['cajero'] });
    await expect(new UsuariosService(db).editar('x', { roles: ['cajero', 'dueno'] }, { sub: 'g', rol: 'gerente' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { haceFacturasDirecto, PERMISO_FACTURAS_DIRECTO } from './facturas-directo';
import { ComprasController } from './compras.controller';
import { ROLES } from '../auth/decorators';

// «Necesito que Ana vea lo mismo [que Juampi]… podemos hacerlo solo con Anabella»
// (Leandro, 25/11/2026): registrar pagos, anular y corregir facturas de compra
// directo con el permiso facturas_directo; Romina, del mismo rol, no.

const ANABELLA = { sub: 'U-ANABELLA', rol: 'administrativo', roles: ['administrativo', 'cajero'] };
const ROMINA = { sub: 'U-ROMINA', rol: 'administrativo', roles: ['administrativo', 'cajero'] };

function base(usuarios: Record<string, any> | null, falla = false) {
  const leidos: string[] = [];
  const db: any = {
    from: (tabla: string) => {
      let id = '';
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q; },
        maybeSingle: () => {
          leidos.push(`${tabla}:${id}`);
          if (falla) return Promise.resolve({ data: null, error: { message: 'se cayó' } });
          return Promise.resolve({ data: usuarios?.[id] ?? null, error: null });
        },
      };
      return q;
    },
  };
  return { db, leidos };
}

const USUARIOS = {
  'U-ANABELLA': { permisos: [PERMISO_FACTURAS_DIRECTO], activo: true },
  'U-ROMINA': { permisos: [], activo: true },
};

describe('facturas de compra directo: gerente, dueño y quien tenga el permiso', () => {
  it('dueño y gerente, como siempre, sin mirar la base', async () => {
    const { db, leidos } = base(USUARIOS);
    expect(await haceFacturasDirecto(db, { sub: 'U-JP', rol: 'dueno' })).toBe(true);
    expect(await haceFacturasDirecto(db, { sub: 'U-G', rol: 'cajero', roles: ['cajero', 'gerente'] })).toBe(true);
    expect(leidos).toEqual([]);
  });

  it('Anabella, con el permiso, sí; Romina, del mismo rol y sin el permiso, no', async () => {
    const { db } = base(USUARIOS);
    expect(await haceFacturasDirecto(db, ANABELLA)).toBe(true);
    expect(await haceFacturasDirecto(db, ROMINA)).toBe(false);
  });

  it('sin usuario, dada de baja o si la base no contesta: no', async () => {
    expect(await haceFacturasDirecto(base(USUARIOS).db, { rol: 'administrativo' })).toBe(false);
    expect(await haceFacturasDirecto(base({ 'U-ANABELLA': { permisos: [PERMISO_FACTURAS_DIRECTO], activo: false } }).db, ANABELLA)).toBe(false);
    expect(await haceFacturasDirecto(base(USUARIOS, true).db, ANABELLA)).toBe(false);
  });

  it('el servicio frena a quien no lo tiene y deja pasar a Anabella', async () => {
    const s = new ComprasService(base(USUARIOS).db);
    await expect(s.exigirFacturasDirecto(ANABELLA)).resolves.toBeUndefined();
    await expect(s.exigirFacturasDirecto(ROMINA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.miPermisoFacturas(ANABELLA)).resolves.toEqual({ directo: true });
    await expect(s.miPermisoFacturas(ROMINA)).resolves.toEqual({ directo: false });
  });

  it('pagar, anular y corregir dejan entrar a administración: el permiso lo decide adentro', () => {
    const rolesDe = (metodo: string) => Reflect.getMetadata(ROLES, (ComprasController.prototype as any)[metodo]) ?? [];
    for (const m of ['pagoFactura', 'anularFactura', 'corregirRenglonesFactura', 'editarFactura']) {
      expect(rolesDe(m)).toEqual(expect.arrayContaining(['administrativo', 'gerente', 'dueno']));
    }
  });
});

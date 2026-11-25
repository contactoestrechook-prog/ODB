import { ForbiddenException } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { pagaYAnulaFacturas, PERMISO_PAGAR_ANULAR } from './pagar-anular-facturas';
import { ComprasController } from './compras.controller';
import { ROLES } from '../auth/decorators';

// «Necesito que Ana vea lo mismo [que Juampi]… solo con Anabella… solamente con
// respecto a las imágenes que te pasé, claramente no todo» (Leandro, 25/11/2026):
// registrar pagos y anular facturas de compra directo con el permiso
// pagar_anular_facturas. Corregir sigue siendo de gerencia y dueños. Romina no.

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
  'U-ANABELLA': { permisos: [PERMISO_PAGAR_ANULAR], activo: true },
  'U-ROMINA': { permisos: [], activo: true },
};

const rolesDeRuta = (metodo: string) => Reflect.getMetadata(ROLES, (ComprasController.prototype as any)[metodo]) ?? [];

describe('registrar pagos y anular facturas: gerente, dueño y quien tenga el permiso', () => {
  it('dueño y gerente, como siempre, sin mirar la base', async () => {
    const { db, leidos } = base(USUARIOS);
    expect(await pagaYAnulaFacturas(db, { sub: 'U-JP', rol: 'dueno' })).toBe(true);
    expect(await pagaYAnulaFacturas(db, { sub: 'U-G', rol: 'cajero', roles: ['cajero', 'gerente'] })).toBe(true);
    expect(leidos).toEqual([]);
  });

  it('Anabella, con el permiso, sí; Romina, del mismo rol y sin el permiso, no', async () => {
    const { db } = base(USUARIOS);
    expect(await pagaYAnulaFacturas(db, ANABELLA)).toBe(true);
    expect(await pagaYAnulaFacturas(db, ROMINA)).toBe(false);
  });

  it('el permiso viejo («facturas_directo», de más) ya no sirve', async () => {
    expect(await pagaYAnulaFacturas(base({ 'U-ANABELLA': { permisos: ['facturas_directo'], activo: true } }).db, ANABELLA)).toBe(false);
  });

  it('sin usuario, dada de baja o si la base no contesta: no', async () => {
    expect(await pagaYAnulaFacturas(base(USUARIOS).db, { rol: 'administrativo' })).toBe(false);
    expect(await pagaYAnulaFacturas(base({ 'U-ANABELLA': { permisos: [PERMISO_PAGAR_ANULAR], activo: false } }).db, ANABELLA)).toBe(false);
    expect(await pagaYAnulaFacturas(base(USUARIOS, true).db, ANABELLA)).toBe(false);
  });

  it('el servicio frena a quien no lo tiene y deja pasar a Anabella', async () => {
    const s = new ComprasService(base(USUARIOS).db);
    await expect(s.exigirPagarAnular(ANABELLA)).resolves.toBeUndefined();
    await expect(s.exigirPagarAnular(ROMINA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.miPermisoFacturas(ANABELLA)).resolves.toEqual({ pagaYAnula: true });
    await expect(s.miPermisoFacturas(ROMINA)).resolves.toEqual({ pagaYAnula: false });
  });

  it('pagar y anular dejan entrar a administración (el permiso lo decide adentro); corregir, no', () => {
    for (const m of ['pagoFactura', 'anularFactura']) {
      expect(rolesDeRuta(m)).toEqual(expect.arrayContaining(['administrativo', 'gerente', 'dueno']));
    }
    for (const m of ['editarFactura', 'corregirRenglonesFactura']) {
      expect(rolesDeRuta(m)).toEqual(['gerente', 'dueno']);
    }
  });
});

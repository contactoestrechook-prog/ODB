import { ForbiddenException } from '@nestjs/common';
import { cambiosMovimiento, movimientoNuevo, periodoValido, totalesCaja, type Movimiento } from './caja-dueno';
import { CajaDuenoService } from './caja-dueno.service';
import { CajaDuenoController } from './caja-dueno.controller';
import { ROLES } from '../auth/decorators';

// La hoja del Excel de Juan Pablo (captura del 25/11/2026): tiene que dar lo mismo.
const CUADROS = [
  { id: 'otros', nombre: 'OTROS', orden: 1 },
  { id: 'reparto', nombre: 'REPARTO', orden: 2 },
  { id: 'st', nombre: 'CAJA ST THOMAS', orden: 3 },
];
let n = 0;
const ing = (cuadroId: string, fecha: string, motivo: string, monto: number): Movimiento => ({ id: `m${++n}`, tipo: 'ingreso', cuadroId, fecha, motivo, monto });
const egr = (fecha: string, motivo: string, monto: number): Movimiento => ({ id: `m${++n}`, tipo: 'egreso', cuadroId: null, fecha, motivo, monto });
const EXCEL: Movimiento[] = [
  ing('otros', '2026-11-10', 'Fruit', 10511300), ing('otros', '2026-11-10', 'Reingreso', 11000000),
  ing('reparto', '2026-11-07', 'arqueo', 62000), ing('reparto', '2026-11-07', 'Romina Escribana', 91000),
  ing('st', '2026-11-06', 'Inicio', 1123000), ing('st', '2026-11-07', 'Retiro', 5100000),
  egr('2026-11-07', 'CCU', 686000), egr('2026-11-07', 'Leo', 756000), egr('2026-11-07', 'Retiro', 4000000),
];

describe('caja del dueño: las cuentas del Excel', () => {
  it('cada cuadro, TOTAL INGRESOS, TOTAL EGRESOS y el Total dan lo mismo que la hoja', () => {
    const t = totalesCaja(CUADROS, EXCEL);
    expect(t.porCuadro).toEqual({ otros: 21511300, reparto: 153000, st: 6223000 });
    expect(t.totalIngresos).toBe(27887300);
    expect(t.totalEgresos).toBe(5442000);
    expect(t.total).toBe(22445300);
  });

  it('los centavos no se pierden al sumar', () => {
    const t = totalesCaja(CUADROS, [ing('otros', '2026-11-01', 'a', 0.1), ing('otros', '2026-11-01', 'b', 0.2), egr('2026-11-01', 'c', 0.3)]);
    expect(t.totalIngresos).toBe(0.3);
    expect(t.total).toBe(0);
  });

  it('mirando un período, lo de antes entra como saldo anterior y el Total sigue siendo el mismo', () => {
    const antes = EXCEL.filter((m) => m.fecha < '2026-11-10');
    const desde = EXCEL.filter((m) => m.fecha >= '2026-11-10');
    const anterior = totalesCaja(CUADROS, antes).total;
    const t = totalesCaja(CUADROS, desde, anterior);
    expect(t.saldoAnterior).toBe(934000);
    expect(t.totalIngresos).toBe(21511300);
    expect(t.totalEgresos).toBe(0);
    expect(t.total).toBe(22445300);
  });
});

describe('caja del dueño: lo que se carga', () => {
  it('un ingreso necesita cuadro, fecha y monto; el motivo puede ir vacío', () => {
    expect(movimientoNuevo({ tipo: 'ingreso', cuadroId: 'st', fecha: '2026-11-25', motivo: '  Retiro  ', monto: 5100000 }))
      .toEqual({ tipo: 'ingreso', cuadroId: 'st', fecha: '2026-11-25', motivo: 'Retiro', monto: 5100000 });
    expect(movimientoNuevo({ tipo: 'ingreso', fecha: '2026-11-25', monto: 1 })).toBe('Elegí en qué cuadro entra.');
    expect(movimientoNuevo({ tipo: 'egreso', cuadroId: 'st', fecha: '2026-11-25', monto: 1 })).toMatchObject({ cuadroId: null });
    expect(movimientoNuevo({ tipo: 'egreso', fecha: '2026-02-30', monto: 1 })).toBe('Poné la fecha.');
    expect(movimientoNuevo({ tipo: 'egreso', fecha: '2026-11-25', monto: 0 })).toBe('Poné el monto (mayor a cero).');
    expect(movimientoNuevo({ tipo: 'otro', fecha: '2026-11-25', monto: 1 })).toBe('Elegí si entra o sale.');
  });

  it('al corregir, solo cambia lo que vino', () => {
    expect(cambiosMovimiento({ monto: 686000.456 })).toEqual({ monto: 686000.46 });
    expect(cambiosMovimiento({ motivo: 'CCU' })).toEqual({ motivo: 'CCU' });
    expect(cambiosMovimiento({})).toBe('No hay nada para cambiar.');
  });

  it('el período: fechas reales y en orden', () => {
    expect(periodoValido({})).toEqual({ desde: null, hasta: null });
    expect(periodoValido({ desde: '2026-11-30', hasta: '2026-11-01' })).toBe('La fecha de inicio es posterior a la de fin.');
  });
});

describe('caja del dueño: quién la ve', () => {
  const db = (permisos: Record<string, string[]>) => ({
    from: () => {
      let id = '';
      const q: any = { select: () => q, eq: (_c: string, v: string) => { id = v; return q; }, maybeSingle: async () => ({ data: permisos[id] ? { permisos: permisos[id], activo: true } : null, error: null }) };
      return q;
    },
  }) as any;

  it('Juan Pablo, con el permiso, sí; otro dueño sin el permiso, no', async () => {
    const s = new CajaDuenoService(db({ 'U-JP': ['caja_dueno'], 'U-JAQUI': [] }));
    expect(await s.puede({ sub: 'U-JP', rol: 'dueno' })).toBe(true);
    expect(await s.puede({ sub: 'U-JAQUI', rol: 'dueno' })).toBe(false);
    await expect(s.exigir({ sub: 'U-JAQUI', rol: 'dueno' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la puerta es el rol dueño', () => {
    expect(Reflect.getMetadata(ROLES, CajaDuenoController)).toEqual(['dueno']);
  });
});

// LO QUE SE ESTÁ CARGANDO NO SE PIERDE (26/11/2026): Juan Pablo, «si está cargando una factura
// y por alguna razón sale, se corta la luz… cuando vuelva a entrar quede exactamente como la
// dejó». Ver apps/admin/app/lib/borrador-local.ts.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  claveDeBorrador, emitirCorresponde, emitirTieneAlgo, haceCuantoGuardado, linkParaSeguirEmitir, usuarioDeLaCookie,
} from '../../../admin/app/lib/borrador-local';

const ADMIN = join(__dirname, '../../../admin/app');
const leer = (archivo: string) => readFileSync(join(ADMIN, archivo), 'utf8');

describe('Borrador de lo que se está cargando', () => {
  it('es de quien tiene la sesión: en una compu compartida no se mezcla', () => {
    expect(usuarioDeLaCookie('odb_tema=claro; odb_usuario=JuanPablo%40odb.com.ar; otra=1')).toBe('juanpablo@odb.com.ar');
    expect(usuarioDeLaCookie('odb_tema=claro')).toBe('');
    expect(claveDeBorrador('emitir-comprobante', 'jp@odb')).not.toBe(claveDeBorrador('emitir-comprobante', 'ana@odb'));
    expect(claveDeBorrador('emitir-comprobante', '')).toContain('sin-sesion');
  });

  it('una ventana vacía no es un borrador', () => {
    const vacio = { cliente: null, items: [], importe: '', concepto: '' };
    expect(emitirTieneAlgo(vacio)).toBe(false);
    expect(emitirTieneAlgo({ ...vacio, cliente: { id: 'c1' } })).toBe(true);
    expect(emitirTieneAlgo({ ...vacio, items: [{ descripcion: 'Leche', cantidad: 1, precioUnitario: 1500, alicuota: 21 }] })).toBe(true);
    expect(emitirTieneAlgo({ ...vacio, importe: '  ' })).toBe(false);
    expect(emitirTieneAlgo({ ...vacio, concepto: 'Seña' })).toBe(true);
  });

  it('se recupera solo en la misma factura: la de una venta no aparece en otra', () => {
    expect(emitirCorresponde({ ventaId: null }, null)).toBe(true);
    expect(emitirCorresponde({ ventaId: null }, undefined)).toBe(true);
    expect(emitirCorresponde({ ventaId: 'v1' }, 'v1')).toBe(true);
    expect(emitirCorresponde({ ventaId: 'v1' }, 'v2')).toBe(false);
    expect(emitirCorresponde({ ventaId: 'v1' }, null)).toBe(false);
  });

  it('«Seguir» vuelve a la misma factura, abierta', () => {
    expect(linkParaSeguirEmitir({ ventaId: null })).toBe('/facturacion?seguir=1');
    expect(linkParaSeguirEmitir({ ventaId: 'v1', ventaTotal: 61460 })).toBe('/facturacion?seguir=1&venta=v1&total=61460');
  });

  it('las pantallas guardan y recuperan, y se borra solo al emitir o al cerrar a propósito', () => {
    const emitir = leer('ui/EmitirComprobante.tsx');
    expect(emitir).toMatch(/guardarBorrador\(BORRADOR_EMITIR, b\)/);
    expect(emitir).toMatch(/leerBorrador<BorradorEmitir>\(BORRADOR_EMITIR\)/);
    // el guardado va antes que el recuperar: la primera vuelta vacía no pisa lo guardado
    expect(emitir.indexOf('guardarBorrador(BORRADOR_EMITIR')).toBeLessThan(emitir.indexOf('setRecuperado(g.en)'));
    expect(emitir).toMatch(/borrarBorrador\(BORRADOR_EMITIR\);\s*setAbierto\(false\);\s*router\.push/);
    const compras = leer('ui/ComprasWorkspace.tsx');
    expect(compras).toMatch(/guardarBorrador\(BORRADOR_FACTURA_PROVEEDOR, \{ lecturaId: foto\.lecturaId \}\)/);
    expect(compras).toMatch(/d\?\.estado === 'listo' && !d\?\.descartada/);
    expect(leer('layout.tsx')).toMatch(/<AvisoFacturaAMedias \/>/);
  });

  it('dice hace cuánto quedó guardado', () => {
    const ahora = Date.UTC(2026, 10, 26, 18, 0);
    expect(haceCuantoGuardado(ahora - 20_000, ahora)).toBe('recién');
    expect(haceCuantoGuardado(ahora - 60_000, ahora)).toBe('hace 1 minuto');
    expect(haceCuantoGuardado(ahora - 5 * 60_000, ahora)).toBe('hace 5 minutos');
    expect(haceCuantoGuardado(ahora - 2 * 3600_000, ahora)).toBe('hace 2 horas');
    expect(haceCuantoGuardado(Date.UTC(2026, 10, 25, 21, 40), ahora)).toBe('hace 20 horas');
    expect(haceCuantoGuardado(Date.UTC(2026, 10, 24, 21, 40), ahora)).toBe('el 24/11 a las 18:40');
  });
});

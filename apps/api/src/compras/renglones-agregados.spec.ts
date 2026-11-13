// Renglones agregados en la pantalla de carga (13/11/2026). El chat de la
// factura de Artesano dijo «agregá dos renglones nuevos con el botón de agregar
// renglón de la tabla» y ese botón no existía: la cuenta quedó $55.000 abajo.
// Ahora se agregan a mano o desde el chat; van al final y el borrador los
// guarda enteros. La lógica vive en el panel (lib/tabla-factura.ts y
// lib/borrador-factura.ts); se prueba acá.
import { cuentaDelPapel, renglonAgregado, esRenglonAgregado, tablaParaIA, aplicarCambiosIA } from '../../../admin/app/lib/tabla-factura';
import { aplicarBorrador, borradorDe, borradorVacio } from '../../../admin/app/lib/borrador-factura';
import { ListasService } from '../listas/listas.service';

const artesano = { descripcion: 'ARTESANO X 500', cantidad: 30, precio: 5500, importe: 165000, alicuotaIva: 10.5, sku: 'L900', incluir: true, margenPct: 35, papel: { bultos: null, uxb: null, sueltas: 30, precio: 5500, desc: null, iva: 10.5, importe: 165000 } };

describe('renglonAgregado', () => {
  it('sin producto, con la cuenta del papel y el IVA del renglón que se parte', () => {
    const r = renglonAgregado(artesano, { descripcion: 'Artesano Brioche', cantidad: 4, precio: 5500 }, 'IA', 'x1');
    expect(r).toMatchObject({ descripcion: 'Artesano Brioche', sku: '', nombre: null, incluir: false, cantidad: 4, precio: 5500, importe: 22000, alicuotaIva: 10.5, margenPct: 35 });
    expect(r.papel).toEqual({ bultos: null, uxb: null, sueltas: 4, precio: 5500, desc: null, iva: 10.5, importe: 22000 });
    expect(cuentaDelPapel(r.papel).cierra).toBe(true);
    expect(esRenglonAgregado(r)).toBe(true);
    expect(r.agregado).toMatchObject({ id: 'x1', por: 'IA' });
  });
  it('la IA lo ve como agregado en pantalla', () => {
    const r = renglonAgregado(artesano, { descripcion: 'Artesano Integral', cantidad: 6, precio: 5500 }, 'persona', 'x2');
    const t = tablaParaIA([artesano, r], () => false, () => null);
    expect(t[1]).toMatchObject({ renglon: 2, descripcion: 'Artesano Integral', agregadoEnPantalla: true, sueltas: 6, importe: 33000, cierra: true });
    expect((t[0] as any).agregadoEnPantalla).toBeUndefined();
  });
  it('el caso Artesano: el 3 baja a 20 y los dos nuevos suman los $55.000 que faltaban', () => {
    const cambio = aplicarCambiosIA([artesano], [{ renglon: 1, campo: 'sueltas', valor: 20 }, { renglon: 1, campo: 'ajustarImporte', valor: true }], () => false);
    const nuevos = [
      renglonAgregado(artesano, { descripcion: 'Artesano Brioche', cantidad: 4, precio: 5500 }, 'IA', 'a'),
      renglonAgregado(artesano, { descripcion: 'Artesano Integral', cantidad: 6, precio: 5500 }, 'IA', 'b'),
    ];
    const todos = [...cambio.items, ...nuevos];
    expect(todos.map((x: any) => x.importe)).toEqual([110000, 22000, 33000]);
    expect(todos.reduce((s: number, x: any) => s + Number(x.importe), 0)).toBe(165000);
  });
});

describe('el borrador guarda los renglones agregados', () => {
  const leido = [{ descripcion: 'ARTESANO X 500', cantidad: 30, precio: 5500, sku: 'L900', interpretado: { x: 1 } }];
  const nuevo = renglonAgregado(leido[0], { descripcion: 'Artesano Brioche', cantidad: 4, precio: 5500 }, 'persona', 'n1');

  it('se guardan enteros y vuelven al final al abrir', () => {
    const b = borradorDe(leido, [{ ...leido[0], cantidad: 20 }, { ...nuevo, _algo: 1 }], {}, {});
    expect(b.renglones).toEqual([{ renglon: 0, descripcion: 'ARTESANO X 500', campos: { cantidad: 20 } }]);
    expect(b.agregados).toHaveLength(1);
    expect((b.agregados![0] as any)._algo).toBeUndefined();
    expect(borradorVacio({ renglones: [], pie: {}, cambios: [], agregados: b.agregados })).toBe(false);
    const r = aplicarBorrador(leido, {}, JSON.parse(JSON.stringify(b)));
    expect(r.filas).toHaveLength(2);
    expect(r.filas[1]).toMatchObject({ descripcion: 'Artesano Brioche', cantidad: 4, importe: 22000, agregado: { id: 'n1' } });
    expect(r.descartados).toBe(0);
  });
  it('sin agregados, el borrador es el de siempre', () => {
    expect(borradorDe(leido, leido, {}, {})).toEqual({ renglones: [], pie: {}, cambios: [] });
  });
  it('lo que no es un renglón agregado no se mete', () => {
    const r = aplicarBorrador(leido, {}, { renglones: [], pie: {}, cambios: [], agregados: [{ descripcion: 'raro' } as any] });
    expect(r.filas).toHaveLength(1);
    expect(r.descartados).toBe(1);
  });
  it('la API los guarda (antes tiraba lo que no conocía)', async () => {
    const ops: any[] = [];
    const q: any = { update: (v: any) => { ops.push(v); return q; }, eq: async () => ({ error: null }) };
    const s = new ListasService({ from: () => q } as any);
    const r = await s.guardarBorrador('l1', { renglones: [], pie: {}, cambios: [], form: {}, agregados: [nuevo, { descripcion: 'sin marca' }] }, 'u-ana');
    expect(r).toEqual({ ok: true, guardado: true });
    expect(ops[0].borrador.agregados).toHaveLength(1);
    expect(ops[0].borrador.agregados[0]).toMatchObject({ descripcion: 'Artesano Brioche' });
  });
});

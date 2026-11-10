import { marcarAsignados, normalizarRenglonesNota, notaCompleta, renglonesParaAsignar, type RenglonNota } from './nota-pedido';

describe('nota de pedido sin proveedor', () => {
  const asignadoAClan: RenglonNota = { sku: 'L1', nombre: 'Don Satur', cantidad: 10, proveedorId: 'p1', proveedor: 'Clan', ordenCompraId: 'oc1', ordenNumero: 7 };

  it('limpia lo que manda la pantalla y junta el mismo SKU', () => {
    const r = normalizarRenglonesNota([
      { sku: ' L2 ', nombre: 'Yerba', cantidad: 2 },
      { sku: 'L2', nombre: 'Yerba', cantidad: 3 },
      { sku: 'L3', cantidad: 0 },
      { sku: '', cantidad: 4 },
      { sku: 'L4', cantidad: 'x' },
      null,
    ]);
    expect(r).toEqual([{ sku: 'L2', nombre: 'Yerba', cantidad: 5 }]);
  });

  it('lo ya asignado a un proveedor no lo pisa la pantalla', () => {
    const r = normalizarRenglonesNota(
      [{ sku: 'L1', nombre: 'Don Satur', cantidad: 99, ordenCompraId: 'oc1' }, { sku: 'L2', nombre: 'Yerba', cantidad: 1 }],
      [asignadoAClan],
    );
    expect(r).toEqual([asignadoAClan, { sku: 'L2', nombre: 'Yerba', cantidad: 1 }]);
  });

  it('la pantalla no puede borrar lo asignado', () => {
    expect(normalizarRenglonesNota([], [asignadoAClan])).toEqual([asignadoAClan]);
  });

  it('asigna solo lo elegido que sigue sin proveedor; sin lista, todo lo que falta', () => {
    const rs: RenglonNota[] = [asignadoAClan, { sku: 'L2', nombre: 'Yerba', cantidad: 1 }, { sku: 'L3', nombre: 'Azúcar', cantidad: 2 }];
    expect(renglonesParaAsignar(rs, ['L1', 'L3']).map((r) => r.sku)).toEqual(['L3']);
    expect(renglonesParaAsignar(rs, null).map((r) => r.sku)).toEqual(['L2', 'L3']);
  });

  it('marca los renglones con el proveedor y el número de orden, y se cierra cuando no queda nada', () => {
    const rs: RenglonNota[] = [asignadoAClan, { sku: 'L2', nombre: 'Yerba', cantidad: 1 }];
    expect(notaCompleta(rs)).toBe(false);
    const marcados = marcarAsignados(rs, ['L2'], { proveedorId: 'p2', proveedor: 'Distri Sur', ordenCompraId: 'oc2', ordenNumero: 8 });
    expect(marcados[1]).toEqual({ sku: 'L2', nombre: 'Yerba', cantidad: 1, proveedorId: 'p2', proveedor: 'Distri Sur', ordenCompraId: 'oc2', ordenNumero: 8 });
    expect(marcados[0]).toBe(asignadoAClan);
    expect(notaCompleta(marcados)).toBe(true);
    expect(notaCompleta([])).toBe(false);
  });
});

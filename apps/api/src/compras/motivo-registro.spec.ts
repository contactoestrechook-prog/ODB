// Por qué no se puede registrar la factura (12/11/2026).
// La lógica vive en apps/admin/app/lib/motivo-registro.ts.
import { faltaParaEntrada, faltaParaConciliar, type EstadoEntrada } from '../../../admin/app/lib/motivo-registro';

const todoBien: EstadoEntrada = {
  proveedor: true,
  sucursal: true,
  tildadosConProducto: 4,
  tildadosSinProducto: [],
  renglonIncompleto: null,
  cuentaNoCierra: false,
  iva: null,
  internosSinMarcar: false,
  renglonesSinCierre: 0,
  avisosAntesDeRegistrar: 0,
};

describe('qué falta para registrar la entrada', () => {
  it('con todo en orden no falta nada y el botón se prende', () => {
    expect(faltaParaEntrada(todoBien)).toEqual([]);
  });

  it('Leares 12/11: la cuenta cerraba y solo faltaba la sucursal', () => {
    expect(faltaParaEntrada({ ...todoBien, sucursal: false })).toEqual([
      { texto: 'Elegí la sucursal donde entra la mercadería', donde: 'sucursal' },
    ]);
  });

  it('un renglón tildado sin producto lleva a ese renglón', () => {
    const f = faltaParaEntrada({ ...todoBien, tildadosSinProducto: [2] });
    expect(f).toEqual([{ texto: 'El renglón 3 está tildado y no tiene producto: vinculalo o destildalo', donde: 'renglon', renglon: 2 }]);
  });

  it('varios sin producto se cuentan y lleva al primero', () => {
    const f = faltaParaEntrada({ ...todoBien, tildadosSinProducto: [1, 4] });
    expect(f[0].texto).toBe('2 renglones tildados no tienen producto: vinculalos o destildalos');
    expect(f[0].renglon).toBe(1);
  });

  it('sin ningún renglón tildado con producto', () => {
    expect(faltaParaEntrada({ ...todoBien, tildadosConProducto: 0 })[0].texto).toBe('Tildá al menos un renglón que tenga su producto');
  });

  it('cada traba del costo dice la suya', () => {
    const f = faltaParaEntrada({
      ...todoBien,
      renglonIncompleto: 0,
      cuentaNoCierra: true,
      iva: { estado: 'no_cierra' },
      internosSinMarcar: true,
      renglonesSinCierre: 2,
      avisosAntesDeRegistrar: 1,
    });
    expect(f.map((x) => x.donde)).toEqual(['renglon', 'cuenta', 'iva', 'internos', 'sin-cierre', 'antes-de-registrar']);
    expect(f[4].texto).toBe('2 renglones no dan el importe del papel: miralos y tildá que los revisaste');
    expect(f[5].texto).toBe('Mirá el aviso de «Antes de registrar»');
  });

  it('el IVA sin pie usa el motivo del control', () => {
    const f = faltaParaEntrada({ ...todoBien, iva: { estado: 'falta_pie', motivo: 'Falta el neto gravado del pie de la factura' } });
    expect(f).toEqual([{ texto: 'Falta el neto gravado del pie de la factura', donde: 'pie' }]);
  });
});

describe('qué falta para registrar solo la factura', () => {
  it('con proveedor y total no falta nada', () => {
    expect(faltaParaConciliar({ proveedor: true, total: true, renglonIncompleto: null })).toEqual([]);
  });

  it('sin total ni proveedor', () => {
    expect(faltaParaConciliar({ proveedor: false, total: false, renglonIncompleto: null }).map((x) => x.texto)).toEqual([
      'Elegí el proveedor',
      'Falta el total de la factura',
    ]);
  });
});

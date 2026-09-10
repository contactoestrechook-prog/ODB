import { MesaComprasService, planillaCargar } from './mesa-compras.service';

// El caso real (10/9/2026): Leandro adjuntó la lista de Mosquita Muerta y dictó
// "a la columna costo hay que dividirla por 1.21 y hacerla por 1.24; al
// resultado un 10% de descuento". costear_planilla no aceptaba la fórmula, así
// que el analista copió a mano la MUESTRA de 59 filas (tardó 3 minutos y dejó
// afuera el resto). Y "caja x6" en la columna de unidades daba 1 con Number(),
// o sea costo por caja en vez de por botella.
const servicio = (): any => Object.assign(Object.create(MesaComprasService.prototype), {
  log: { log() {}, warn() {}, error() {} },
});

const csv = (filas: string[]) => Buffer.from(filas.join('\n'), 'utf-8').toString('base64');

const mosquita = (n = 80, conPresentacion = true) => {
  const filas = [conPresentacion ? 'Producto,Presentacion,Costo' : 'Producto,Costo'];
  filas.push(conPresentacion ? 'Mosquita Muerta Malbec,caja x6,63000' : 'Mosquita Muerta Malbec caja x6,63000');
  for (let i = 1; i < n; i++) {
    const precio = 52000 + i * 100;
    filas.push(conPresentacion ? `Mosquita Muerta vino ${i},caja x6,${precio}` : `Mosquita Muerta vino ${i} caja x6,${precio}`);
  }
  return planillaCargar(csv(filas), 'Mosquita Ago-26.csv');
};

const FORMULA = [{ op: 'dividir', valor: 1.21 }, { op: 'multiplicar', valor: 1.24 }];

describe('costear_planilla con la fórmula del comprador', () => {
  it('costea las 80 filas, no la muestra de 59', () => {
    const r = servicio().costearPlanilla(
      { columnaDescripcion: 'Producto', columnaPrecio: 'Costo', columnaUnidades: 'Presentacion', reglas: [], descuentoPorDefectoPct: [10], operacionesLista: FORMULA },
      mosquita(80),
    );
    expect(r.error).toBeUndefined();
    expect(r.costeados).toBe(80);
    expect(r.saltados).toBe(0);
  });

  it('aplica ÷1,21 ×1,24 −10% y da el costo POR BOTELLA ("caja x6" se lee como 6)', () => {
    const r = servicio().costearPlanilla(
      { columnaDescripcion: 'Producto', columnaPrecio: 'Costo', columnaUnidades: 'Presentacion', reglas: [], descuentoPorDefectoPct: [10], operacionesLista: FORMULA },
      mosquita(5),
    );
    // 63.000 ÷ 1,21 × 1,24 × 0,9 ÷ 6 = 9.684,30
    expect(r.renglones[0].costoContado).toBeCloseTo(9684.3, 1);
  });

  it('sin columna de unidades, el bulto sale de la descripción', () => {
    const r = servicio().costearPlanilla(
      { columnaDescripcion: 'Producto', columnaPrecio: 'Costo', reglas: [], descuentoPorDefectoPct: [10], operacionesLista: FORMULA },
      mosquita(5, false),
    );
    expect(r.renglones[0].costoContado).toBeCloseTo(9684.3, 1);
  });

  it('una fórmula inválida no tira abajo la planilla: los renglones quedan anotados como saltados', () => {
    const r = servicio().costearPlanilla(
      { columnaDescripcion: 'Producto', columnaPrecio: 'Costo', columnaUnidades: 'Presentacion', reglas: [], operacionesLista: [{ op: 'dividir', valor: 0 }] },
      mosquita(3),
    );
    expect(r.costeados).toBe(0);
    expect(r.saltados).toBe(3);
    expect(r.detalleSaltados[0]).toMatch(/factor inválido/);
  });
});

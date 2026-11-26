// CAJA DEL DUEÑO, AL DÍA (26/11/2026): Juan Pablo, de la hoja igual al Excel, «si lo tengo
// igual que Excel me quedo ahí haciéndolo»; Leandro: «no necesariamente tiene que ser formato
// Excel, sino que sea práctico». Se anota escribiendo o dictando como se diría y el sistema
// hace las cuentas. Las frases salen de su Excel (captura del 25/11/2026).
import {
  conPuntos, csvCaja, frecuentesDe, leerDicho, montoEscrito, montoParaCampo, porDia, rangoPeriodo, resumenDe, saldoDe,
  type CuadroCaja, type MovCaja,
} from '../../../admin/app/lib/caja-dueno';

const HOY = '2026-11-26';
const CUADROS: CuadroCaja[] = [
  { id: 'otros', nombre: 'OTROS', orden: 1 },
  { id: 'reparto', nombre: 'REPARTO', orden: 2 },
  { id: 'st', nombre: 'CAJA ST THOMAS', orden: 3 },
];
// lo que ya tenía el Excel
const EXCEL: MovCaja[] = [
  { id: '1', tipo: 'ingreso', cuadroId: 'otros', fecha: '2026-11-10', motivo: 'Fruit', monto: 10511300 },
  { id: '2', tipo: 'ingreso', cuadroId: 'otros', fecha: '2026-11-10', motivo: 'Reingreso', monto: 11000000 },
  { id: '3', tipo: 'ingreso', cuadroId: 'reparto', fecha: '2026-11-07', motivo: 'arqueo', monto: 62000 },
  { id: '4', tipo: 'ingreso', cuadroId: 'reparto', fecha: '2026-11-07', motivo: 'Romina Escribana', monto: 91000 },
  { id: '5', tipo: 'ingreso', cuadroId: 'st', fecha: '2026-11-06', motivo: 'Inicio', monto: 1123000 },
  { id: '6', tipo: 'ingreso', cuadroId: 'st', fecha: '2026-11-07', motivo: 'Retiro', monto: 5100000 },
  { id: '7', tipo: 'egreso', cuadroId: null, fecha: '2026-11-07', motivo: 'CCU', monto: 686000 },
  { id: '8', tipo: 'egreso', cuadroId: null, fecha: '2026-11-07', motivo: 'Leo', monto: 756000 },
  { id: '9', tipo: 'egreso', cuadroId: null, fecha: '2026-11-07', motivo: 'Retiro', monto: 4000000 },
];
const leer = (t: string) => leerDicho(t, CUADROS, EXCEL, HOY);

describe('Caja del dueño: lo que se escribe o se dicta', () => {
  it('pagos: «pagué 686 mil a CCU» sale $686.000 por CCU, hoy', () => {
    expect(leer('pagué 686 mil a CCU')).toEqual({ tipo: 'egreso', monto: 686000, motivo: 'CCU', cuadroId: null, fecha: HOY });
    expect(leer('le di 756.000 a Leo')).toMatchObject({ tipo: 'egreso', monto: 756000, motivo: 'Leo' });
    expect(leer('ccu 686000 pagado ayer')).toMatchObject({ tipo: 'egreso', monto: 686000, motivo: 'CCU', fecha: '2026-11-25' });
  });

  it('sacar plata de la caja de un local es un ingreso a la del dueño', () => {
    expect(leer('saqué 5,1 millones de la caja de St Thomas')).toEqual({ tipo: 'ingreso', monto: 5100000, motivo: 'Retiro', cuadroId: 'st', fecha: HOY });
    expect(leer('retiro caja st thomas 5.100.000 el 7')).toMatchObject({ tipo: 'ingreso', monto: 5100000, cuadroId: 'st', fecha: '2026-11-07' });
  });

  it('cobros del reparto, con quién pagó como motivo', () => {
    expect(leer('cobré 91 mil de Romina Escribana del reparto')).toEqual({ tipo: 'ingreso', monto: 91000, motivo: 'Romina Escribana', cuadroId: 'reparto', fecha: HOY });
    expect(leer('arqueo reparto 62 lucas')).toMatchObject({ tipo: 'ingreso', monto: 62000, motivo: 'arqueo', cuadroId: 'reparto' });
  });

  it('un ingreso sin origen dicho va al de la última vez («entró Fruit» → OTROS)', () => {
    expect(leer('entraron 10.511.300 de Fruit')).toMatchObject({ tipo: 'ingreso', monto: 10511300, motivo: 'Fruit', cuadroId: 'otros' });
    expect(leer('me pagaron 2 palos')).toMatchObject({ tipo: 'ingreso', monto: 2000000, cuadroId: null });
  });

  it('montos como se dicen', () => {
    expect(leer('pagué un millón y medio de alquiler')).toMatchObject({ monto: 1500000, motivo: 'Alquiler' });
    expect(leer('pagué 2 millones 500 mil de alquiler')).toMatchObject({ monto: 2500000 });
    expect(leer('gasté $ 1.500,50 en nafta')).toMatchObject({ monto: 1500.5, motivo: 'Nafta' });
    expect(leer('pagué 300k luz')).toMatchObject({ monto: 300000, motivo: 'Luz' });
    expect(leer('medio palo a Leo')).toMatchObject({ monto: 500000, motivo: 'Leo' });
  });

  it('lo que no se entiende queda para elegir, nunca se adivina', () => {
    // «Retiro» entró de St Thomas y también salió: se elige
    expect(leer('retiro 4 millones')).toMatchObject({ tipo: null, monto: 4000000, motivo: 'Retiro', cuadroId: null });
    expect(leer('Pepe 20 mil')).toMatchObject({ tipo: null, monto: 20000, motivo: 'Pepe', cuadroId: null });
  });

  it('si no se sabe y se toca «Entró», el origen sale de la última vez', () => {
    expect(leerDicho('retiro 4 millones', CUADROS, EXCEL, HOY, 'ingreso')).toMatchObject({ tipo: 'ingreso', monto: 4000000, cuadroId: 'st' });
    expect(leerDicho('retiro 4 millones', CUADROS, EXCEL, HOY, 'egreso')).toMatchObject({ tipo: 'egreso', cuadroId: null });
    // lo que dice la frase gana sobre lo tocado
    expect(leerDicho('pagué 10 mil luz', CUADROS, EXCEL, HOY, 'ingreso').tipo).toBe('egreso');
  });

  it('un motivo que siempre fue para el mismo lado lo dice solo', () => {
    expect(leer('CCU 700 mil')).toMatchObject({ tipo: 'egreso', monto: 700000, motivo: 'CCU', cuadroId: null });
    expect(leer('Fruit 3 millones')).toMatchObject({ tipo: 'ingreso', monto: 3000000, motivo: 'Fruit', cuadroId: 'otros' });
    expect(leer('CCU')).toMatchObject({ tipo: 'egreso', monto: null });
  });

  it('fechas: ayer, antes de ayer, el 7, 7/11; lo que daría futuro es del año o mes anterior', () => {
    expect(leer('pagué 10 mil antes de ayer luz').fecha).toBe('2026-11-24');
    expect(leer('pagué 10 mil luz el 7/11').fecha).toBe('2026-11-07');
    expect(leer('pagué 10 mil luz el 28').fecha).toBe('2026-10-28');
    expect(leerDicho('pagué 10 mil luz el 28/12', CUADROS, [], '2027-01-05').fecha).toBe('2026-12-28');
  });
});

describe('Caja del dueño: las cuentas', () => {
  it('el saldo es el del Excel: $27.887.300 − $5.442.000 = $22.445.300', () => {
    expect(saldoDe(EXCEL)).toBe(22445300);
    const r = resumenDe(EXCEL, CUADROS);
    expect(r).toMatchObject({ entro: 27887300, salio: 5442000, queda: 22445300 });
    // cada desglose suma su total
    expect(r.deDonde.reduce((s, p) => s + p.monto, 0)).toBe(r.entro);
    expect(r.enQue.reduce((s, p) => s + p.monto, 0)).toBe(r.salio);
    expect(r.deDonde.map((p) => [p.nombre, p.monto])).toEqual([['OTROS', 21511300], ['CAJA ST THOMAS', 6223000], ['REPARTO', 153000]]);
    expect(r.enQue.map((p) => p.nombre)).toEqual(['Retiro', 'Leo', 'CCU']);
  });

  it('lo de siempre: lo que más se repite, con el último monto', () => {
    const conOtroCcu = [...EXCEL, { id: '10', tipo: 'egreso' as const, cuadroId: null, fecha: '2026-11-20', motivo: 'ccu', monto: 700000 }];
    const f = frecuentesDe(conOtroCcu);
    expect(f[0]).toMatchObject({ tipo: 'egreso', motivo: 'ccu', monto: 700000, veces: 2 });
    expect(f).toHaveLength(4);
  });

  it('por día, del más nuevo al más viejo, con lo que entró y salió', () => {
    const d = porDia(EXCEL);
    expect(d.map((x) => x.fecha)).toEqual(['2026-11-10', '2026-11-07', '2026-11-06']);
    expect(d[1]).toMatchObject({ entro: 5253000, salio: 5442000 });
  });

  it('períodos: este mes y el mes pasado (también en enero)', () => {
    expect(rangoPeriodo('mes', HOY)).toEqual({ desde: '2026-11-01', hasta: HOY });
    expect(rangoPeriodo('pasado', HOY)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(rangoPeriodo('pasado', '2027-01-15')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
    expect(rangoPeriodo('todo', HOY)).toBeNull();
  });

  it('los montos se escriben con puntos y se leen bien', () => {
    expect(conPuntos('1500000')).toBe('1.500.000');
    expect(conPuntos('1.500.000,5')).toBe('1.500.000,5');
    expect(montoEscrito('1.500.000,50')).toBe(1500000.5);
    expect(montoEscrito('0')).toBeNull();
    expect(montoParaCampo(686000)).toBe('686.000');
    expect(montoParaCampo(1500.5)).toBe('1.500,50');
  });

  it('se baja para Excel con «;» y coma decimal', () => {
    const csv = csvCaja(EXCEL.slice(6, 7), CUADROS);
    expect(csv).toContain('Fecha;Entró o salió;Origen;Motivo;Monto');
    expect(csv).toContain('7/11/2026;Salió;EGRESOS;CCU;686000,00');
  });
});

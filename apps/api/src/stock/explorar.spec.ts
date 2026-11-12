import { leerConsulta } from './explorar';

const RUBRO = 'fb058506-aa79-4eaf-a4e0-d9e943fe5b68';
const SUC = '229906e6-df69-48eb-b027-2b57fefb89fe';

describe('filtros de stock en la dirección', () => {
  it('sin nada: todo el catálogo activo por nombre, página 1', () => {
    expect(leerConsulta({})).toEqual({ filtros: {}, orden: 'nombre', desc: false, pagina: 1 });
  });

  it('combina rubros, estados, sucursal y rangos', () => {
    const c = leerConsulta({
      q: ' malbec ', suc: SUC, rubro: `${RUBRO},sin`, estado: 'sin_stock,se_termina',
      peso: 'no', barras: 'si', activo: 'todos', cant_min: '1', valor_max: '1500,5', venta_min: '3',
      orden: 'valor', dir: 'desc', pag: '3',
    });
    expect(c).toEqual({
      filtros: {
        q: 'malbec', sucursal: SUC, rubros: [RUBRO, 'sin'], estados: ['sin_stock', 'se_termina'],
        peso: 'no', barras: 'si', activo: 'todos', cant_min: 1, valor_max: 1500.5, venta_min: 3,
      },
      orden: 'valor', desc: true, pagina: 3,
    });
  });

  it('lo que no se reconoce se ignora', () => {
    const c = leerConsulta({ suc: 'x', rubro: 'nada', estado: 'raro', peso: 'quizas', orden: 'drop table', pag: '-4', cant_min: 'abc' });
    expect(c).toEqual({ filtros: {}, orden: 'nombre', desc: false, pagina: 1 });
  });
});

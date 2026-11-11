import { armarLista, compararListas, csvItegra, foto, nombreArchivo, nombreParaBalanza, pluValido, precioTexto, type FilaBalanza } from './itegra';
import { parsearCodigoBalanza } from '../catalogo/balanza';

const fila = (p: Partial<FilaBalanza>): FilaBalanza => ({
  producto_id: 'x', sku: 'SKU', nombre: 'Producto', plu: '1', por_peso: true, en_balanza: false,
  precio: 1000, precio_desde: '2026-11-10T12:00:00Z', ...p,
});

describe('lista de PLU para iTegra', () => {
  it('arma el archivo con el encabezado de Kretz, punto y coma y fin de línea de Windows', () => {
    const { items } = armarLista([
      fila({ sku: 'PAN', nombre: 'Pan al peso', plu: '3931', precio: 12500 }),
      fila({ sku: 'TOR', nombre: 'Torta Matera', plu: '12717', por_peso: false, en_balanza: true, precio: '9800.00' }),
    ]);
    expect(csvItegra(items)).toBe(
      'Numero de PLU;Codigo de PLU;Nombre de PLU;Tipo de PLU;Precio;Codigo de Departamento;Codigo de etiqueta\r\n' +
      '3931;3931;PAN AL PESO;P;12500;1;1\r\n' +
      '12717;12717;TORTA MATERA;N;9800;1;1\r\n',
    );
  });

  it('el PLU del archivo es el que la caja lee de la etiqueta real', () => {
    const { items } = armarLista([fila({ nombre: 'Pan al peso', plu: '03931' })]);
    expect(items[0].plu).toBe(parsearCodigoBalanza('2003931002905')!.plu);
  });

  it('nombre para la balanza: mayúsculas, sin tildes ni caracteres que rompan el archivo, sin el «x fracción» del final', () => {
    expect(nombreParaBalanza('Queso Azul Tres Leches Ventimiglia x Fraccion')).toBe('QUESO AZUL TRES LECHES VENTIMIGLIA');
    expect(nombreParaBalanza('Jamón Crudo Paladini Parma x fracción')).toBe('JAMON CRUDO PALADINI PARMA');
    expect(nombreParaBalanza('Pecan x peso')).toBe('PECAN');
    expect(nombreParaBalanza('Queso Muzzarella La Tarantela x fracccion')).toBe('QUESO MUZZARELLA LA TARANTELA');
    expect(nombreParaBalanza('Salame Tandil xfracc.')).toBe('SALAME TANDIL');
    expect(nombreParaBalanza('Pan de campo x kgs')).toBe('PAN DE CAMPO');
    expect(nombreParaBalanza('Pan al peso')).toBe('PAN AL PESO');
    expect(nombreParaBalanza('Ñoquis "caseros"; 1kg')).toBe('NOQUIS CASEROS 1KG');
    expect(nombreParaBalanza('Cabaña  Piedras Blancas')).toBe('CABANA PIEDRAS BLANCAS');
    expect(nombreParaBalanza('  ')).toBe('SIN NOMBRE');
  });

  it('precio entero sin decimales; con centavos, coma decimal', () => {
    expect(precioTexto(636000)).toBe('636000');
    expect(precioTexto(1405.5)).toBe('1405,50');
  });

  it('PLU: hasta 6 números, sin ceros adelante; lo demás no entra', () => {
    expect(pluValido('003931')).toBe('3931');
    expect(pluValido(' 13885 ')).toBe('13885');
    expect(pluValido(null)).toBeNull();
    expect(pluValido('ABC12')).toBeNull();
    expect(pluValido('1234567')).toBeNull();
    expect(pluValido('000')).toBeNull();
  });

  it('separa lo que no puede ir: sin PLU, sin precio y PLU repetido (no va ninguno de los dos)', () => {
    const { items, problemas } = armarLista([
      fila({ sku: 'A', nombre: 'Emmenthal Cremac x fraccion', plu: null }),
      fila({ sku: 'B', nombre: 'Sin precio', plu: '20', precio: null }),
      fila({ sku: 'C', nombre: 'Uno', plu: '30' }),
      fila({ sku: 'D', nombre: 'Otro', plu: '030' }),
      fila({ sku: 'E', nombre: 'Bien', plu: '40' }),
    ]);
    expect(items.map((i) => i.sku)).toEqual(['E']);
    expect(problemas.map((p) => [p.sku, p.motivo])).toEqual([['A', 'sin_plu'], ['B', 'sin_precio'], ['C', 'plu_repetido'], ['D', 'plu_repetido']]);
  });

  it('ordena por PLU como número', () => {
    const { items } = armarLista([fila({ sku: 'A', plu: '13885' }), fila({ sku: 'B', plu: '9298' }), fila({ sku: 'C', plu: '415' })]);
    expect(items.map((i) => i.plu)).toEqual(['415', '9298', '13885']);
  });

  it('compara con la última bajada: altas, precios, nombres, tipo y bajas', () => {
    const anterior = [
      { plu: '1', nombre: 'A', tipo: 'P' as const, precio: 100 },
      { plu: '2', nombre: 'B', tipo: 'P' as const, precio: 200 },
      { plu: '3', nombre: 'C', tipo: 'P' as const, precio: 300 },
      { plu: '4', nombre: 'D', tipo: 'P' as const, precio: 400 },
    ];
    const actual = [
      { plu: '1', nombre: 'A', tipo: 'P' as const, precio: 100 },
      { plu: '2', nombre: 'B', tipo: 'P' as const, precio: 250 },
      { plu: '3', nombre: 'C NUEVO', tipo: 'N' as const, precio: 300 },
      { plu: '5', nombre: 'E', tipo: 'P' as const, precio: 500 },
    ];
    expect(compararListas(actual, anterior).map((c) => [c.plu, c.cambios])).toEqual([
      ['2', ['precio']], ['3', ['nombre', 'tipo']], ['4', ['baja']], ['5', ['alta']],
    ]);
    expect(compararListas(foto(armarLista([fila({ plu: '9' })]).items), [])).toHaveLength(1);
  });

  it('nombre del archivo con el día de Buenos Aires', () => {
    expect(nombreArchivo('completo', new Date('2026-11-12T02:00:00Z'))).toBe('odb-balanzas-plu-2026-11-11.csv');
    expect(nombreArchivo('cambios', new Date('2026-11-11T15:00:00Z'))).toBe('odb-balanzas-cambios-2026-11-11.csv');
  });
});

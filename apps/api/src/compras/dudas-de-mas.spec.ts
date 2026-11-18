import { preguntaPorElCuitDelEmisor, sinDudasDeMas } from './dudas-de-mas';

// Las preguntas son las que hizo el lector de verdad entre el 16 y el 18/11/2026.
describe('dudas que no hace falta preguntar', () => {
  const sumaDelPlata = { pregunta: 'El CUIT del emisor está parcialmente ilegible (30 71... 66). ¿Cuál es el CUIT completo?', referencia: 'proveedor CUIT' };
  const precio = { pregunta: 'El precio unitario del renglón 2 se lee borroso (5.206,61). ¿Es correcto?', referencia: 'renglón 2: Pauto Bombon x10' };

  it('Suma del Plata: reconocido por el nombre y con el CUIT en la ficha, la duda del CUIT no sale', () => {
    expect(sinDudasDeMas([sumaDelPlata, precio], { proveedorConCuit: true })).toEqual([precio]);
  });
  it('sin proveedor reconocido (o sin CUIT en la ficha) se pregunta como siempre', () => {
    expect(sinDudasDeMas([sumaDelPlata, precio], { proveedorConCuit: false })).toEqual([sumaDelPlata, precio]);
  });
  it('«el CUIT del emisor no figura; ¿lo querés cargar a mano?» también es del CUIT del emisor', () => {
    expect(preguntaPorElCuitDelEmisor({ pregunta: 'El CUIT del emisor no figura en el comprobante; ¿lo querés cargar a mano?', referencia: 'proveedor' })).toBe(true);
  });
  it('no toca las dudas que hablan de otra cosa aunque nombren el CUIT', () => {
    for (const d of [
      { pregunta: 'El comprobante no discrimina IVA ni tiene CUIT visible; ¿es correcto?', referencia: 'pie / encabezado' },
      { pregunta: 'El comprobante no trae emisor, CUIT ni precios por renglón. ¿Cuál es el proveedor?', referencia: 'proveedor' },
      { pregunta: '¿El CUIT del cliente es 30-71111111-1?', referencia: 'receptor' },
      { pregunta: 'La suma del pie (neto + IVA + percepciones + internos + otros) no cierra con el total; revisá los importes.', referencia: 'pie de impuestos' },
      precio,
    ]) expect(preguntaPorElCuitDelEmisor(d)).toBe(false);
  });
  it('aguanta dudas vacías', () => {
    expect(sinDudasDeMas([{}, { pregunta: null }] as any[], { proveedorConCuit: true })).toHaveLength(2);
    expect(sinDudasDeMas(undefined as any, { proveedorConCuit: true })).toEqual([]);
  });
});

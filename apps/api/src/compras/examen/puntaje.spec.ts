import { papelDeLectura } from '../panel/tabla-factura';
import { comparar, compararCharla, renglonesBien, resultadoDe, veredicto, type Verdad } from './puntaje';

const fila = (descripcion: string, cantidad: number, precio: number, extra: Record<string, unknown> = {}) => {
  const leido: any = { descripcion, cantidad, precio, importe: cantidad * precio, sku: 'S', incluir: true, alicuotaIva: 21, ...extra };
  return { ...leido, papel: papelDeLectura(leido), _esDescuento: false };
};
// una factura de dos renglones: del primero se facturaron 36 y entraron 28; el segundo entró entero
const factura = () => [fila('PRONTO MANZANA', 36, 1000), fila('DURAZNO', 4, 2000)];
const verdad: Verdad = new Map([[1, 28], [2, 4]]);
const sinComparar = { charlas: 0, peores: 0, mejores: 0, iguales: 0, bienNuevo: 0, bienProd: 0, conVerdad: 0 };

describe('el puntaje del examen del chat', () => {
  it('cuenta los renglones que quedan como se registraron', () => {
    const bien = resultadoDe(factura(), [{ renglon: 1, campo: 'recibidas', valor: 28 }]);
    expect(bien.rechazos).toHaveLength(0);
    expect(renglonesBien(bien.items, bien.tocados, verdad)).toEqual({ bien: 1, conVerdad: 1 });
    const mal = resultadoDe(factura(), [{ renglon: 1, campo: 'recibidas', valor: 30 }]);
    expect(renglonesBien(mal.items, mal.tocados, verdad)).toEqual({ bien: 0, conVerdad: 1 });
  });
  it('lo que la pantalla rechaza se ve, con su motivo', () => {
    expect(resultadoDe(factura(), [{ renglon: 1, campo: 'recibidas', valor: 99 }]).rechazos).toEqual([{ renglon: 1, campo: 'recibidas', porque: 'no pueden entrar más unidades (99) que las facturadas (36)' }]);
  });
  it('compara una charla mirando los renglones que tocó cualquiera de las dos versiones', () => {
    const acerto = [{ renglon: 1, campo: 'recibidas', valor: 28 }];
    const erro = [{ renglon: 1, campo: 'recibidas', valor: 30 }];
    expect(compararCharla(factura(), erro, acerto, verdad)).toEqual({ bienNuevo: 1, bienProd: 0, conVerdad: 1 });
    expect(compararCharla(factura(), acerto, erro, verdad)).toEqual({ bienNuevo: 0, bienProd: 1, conVerdad: 1 });
    // la nueva no toca el renglón que la publicada había arreglado: también es peor
    expect(compararCharla(factura(), acerto, [], verdad)).toEqual({ bienNuevo: 0, bienProd: 1, conVerdad: 1 });
    // los renglones agregados y el producto no se comparan acá
    expect(compararCharla(factura(), [{ renglon: null, campo: 'renglonNuevo', valor: {} }], [{ renglon: 2, campo: 'producto', valor: 'x' }], verdad)).toEqual({ bienNuevo: 0, bienProd: 0, conVerdad: 0 });
  });

  describe('el veredicto', () => {
    it('aprueba si no falla nada y no rinde peor', () => {
      expect(veredicto({ fundadoresQueFallan: [], mentiras: [], comparacion: sinComparar })).toEqual({ aprueba: true, motivos: [] });
      const c = comparar([{ bienNuevo: 2, bienProd: 1, conVerdad: 2 }, { bienNuevo: 1, bienProd: 1, conVerdad: 1 }]);
      expect(c).toMatchObject({ charlas: 2, mejores: 1, iguales: 1, peores: 0 });
      expect(veredicto({ fundadoresQueFallan: [], mentiras: [], comparacion: c }).aprueba).toBe(true);
    });
    it('un caso fundador que falla frena', () => {
      const v = veredicto({ fundadoresQueFallan: ['Conallison · llegó menos, por peso'], mentiras: [], comparacion: sinComparar });
      expect(v.aprueba).toBe(false);
      expect(v.motivos[0]).toContain('falló un caso fundador: Conallison');
    });
    it('dar por hecho algo que la pantalla rechaza frena', () => {
      expect(veredicto({ fundadoresQueFallan: [], mentiras: ['City'], comparacion: sinComparar }).aprueba).toBe(false);
    });
    it('rendir peor que lo publicado en las charlas reales frena', () => {
      const c = comparar([{ bienNuevo: 0, bienProd: 1, conVerdad: 1 }, { bienNuevo: 1, bienProd: 2, conVerdad: 2 }, { bienNuevo: 1, bienProd: 1, conVerdad: 1 }]);
      const v = veredicto({ fundadoresQueFallan: [], mentiras: [], comparacion: c });
      expect(v.aprueba).toBe(false);
      expect(v.motivos[0]).toContain('rinde peor que lo publicado: en 2 de 3 charlas reales');
    });
    it('una charla peor y otra mejor no frena: es el ruido de la IA', () => {
      const c = comparar([{ bienNuevo: 0, bienProd: 1, conVerdad: 1 }, { bienNuevo: 2, bienProd: 1, conVerdad: 2 }]);
      expect(veredicto({ fundadoresQueFallan: [], mentiras: [], comparacion: c }).aprueba).toBe(true);
    });
  });
});

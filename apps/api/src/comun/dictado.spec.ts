// El dictado por voz del panel (apps/admin/app/lib/dictado.ts) se prueba acá
// porque la API es la que tiene los tests. Caso del 2/10/2026: «los audios se
// cortan a los 5 segundos» — el micrófono se apagaba en la primera pausa y, al
// volver a tocarlo, lo nuevo borraba lo dictado.
import { procesarResultados, sumarDictado, textoDictado } from '../../../admin/app/lib/dictado';

const r = (t: string, isFinal = true) => ({ isFinal, 0: { transcript: t } });

describe('dictado por voz del panel', () => {
  it('volver a tocar el micrófono SUMA a lo que ya había en la caja', () => {
    expect(textoDictado('necesito 6 Malbec', 'y 2 fernet', '')).toBe('necesito 6 Malbec y 2 fernet');
  });

  it('junta las frases de una charla larga con pausas (cada pausa es un resultado final)', () => {
    let conf = '';
    ({ confirmado: conf } = procesarResultados(conf, [r('hola qué falta en Saint Thomas')], 0));
    ({ confirmado: conf } = procesarResultados(conf, [r('hola qué falta en Saint Thomas'), r('de lácteos')], 1));
    ({ confirmado: conf } = procesarResultados(conf, [r('hola qué falta en Saint Thomas'), r('de lácteos'), r('y armame el pedido')], 2));
    expect(conf).toBe('hola qué falta en Saint Thomas de lácteos y armame el pedido');
  });

  it('muestra lo que se está diciendo sin confirmarlo todavía', () => {
    const { confirmado, parcial } = procesarResultados('qué falta', [r('qué falta'), r('de vinos', false)], 1);
    expect(confirmado).toBe('qué falta');
    expect(textoDictado('', confirmado, parcial)).toBe('qué falta de vinos');
  });

  it('Chrome de Android repite todo lo anterior en cada resultado: no se duplica', () => {
    let conf = '';
    ({ confirmado: conf } = procesarResultados(conf, [r('hola')], 0));
    ({ confirmado: conf } = procesarResultados(conf, [r('hola'), r('hola necesito leche')], 1));
    ({ confirmado: conf } = procesarResultados(conf, [r('hola'), r('hola necesito leche'), r('Hola, necesito leche.')], 2));
    // se queda con la última versión (la que el navegador ya puntuó), una sola vez
    expect(conf).toBe('Hola, necesito leche.');
  });

  it('después de un reinicio automático (el navegador cortó solo) sigue sumando', () => {
    // el reinicio arranca un reconocimiento nuevo: resultIndex vuelve a 0
    const primero = procesarResultados('', [r('tres cajas de agua')], 0).confirmado;
    const segundo = procesarResultados(primero, [r('sin gas')], 0).confirmado;
    expect(segundo).toBe('tres cajas de agua sin gas');
  });

  it('no agrega espacios ni vacíos de más', () => {
    expect(sumarDictado('  hola  ', '')).toBe('hola');
    expect(sumarDictado('', '  che ')).toBe('che');
    expect(sumarDictado('pedido de', 'de')).toBe('pedido de');
  });
});

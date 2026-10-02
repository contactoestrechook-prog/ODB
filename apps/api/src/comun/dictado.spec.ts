// El dictado por voz del panel (apps/admin/app/lib/dictado.ts) se prueba acá
// porque la API es la que tiene los tests. Caso del 2/10/2026: «los audios se
// cortan a los 5 segundos» — el micrófono se apagaba en la primera pausa y, al
// volver a tocarlo, lo nuevo borraba lo dictado. Más los casos que encontró la
// revisión adversarial del mismo día.
import { cambioExterno, cerrarSesion, procesarResultados, sumarDictado, textoDictado } from '../../../admin/app/lib/dictado';

const r = (t: string, isFinal = true) => ({ isFinal, 0: { transcript: t } });

describe('dictado por voz del panel', () => {
  it('volver a tocar el micrófono SUMA a lo que ya había en la caja', () => {
    expect(textoDictado('necesito 6 Malbec', '', 'y 2 fernet', '')).toBe('necesito 6 Malbec y 2 fernet');
  });

  it('junta las frases de una charla larga con pausas (cada pausa es un resultado final)', () => {
    let s = '';
    ({ sesion: s } = procesarResultados(s, [r('hola qué falta en Saint Thomas')], 0));
    ({ sesion: s } = procesarResultados(s, [r('hola qué falta en Saint Thomas'), r('de lácteos')], 1));
    ({ sesion: s } = procesarResultados(s, [r('hola qué falta en Saint Thomas'), r('de lácteos'), r('y armame el pedido')], 2));
    expect(s).toBe('hola qué falta en Saint Thomas de lácteos y armame el pedido');
  });

  it('muestra lo que se está diciendo sin confirmarlo todavía', () => {
    const { sesion, parcial } = procesarResultados('qué falta', [r('qué falta'), r('de vinos', false)], 1);
    expect(sesion).toBe('qué falta');
    expect(textoDictado('', '', sesion, parcial)).toBe('qué falta de vinos');
  });

  it('Chrome de Android repite todo lo de la sesión en cada resultado: no se duplica', () => {
    let s = '';
    ({ sesion: s } = procesarResultados(s, [r('hola')], 0));
    ({ sesion: s } = procesarResultados(s, [r('hola'), r('hola necesito leche')], 1));
    ({ sesion: s } = procesarResultados(s, [r('hola'), r('hola necesito leche'), r('Hola, necesito leche.')], 2));
    expect(s).toBe('Hola, necesito leche.');
  });

  it('Android con un reinicio automático en el medio: tampoco se duplica (revisión 2/10)', () => {
    // sesión 1
    let s = '';
    ({ sesion: s } = procesarResultados(s, [r('hola')], 0));
    ({ sesion: s } = procesarResultados(s, [r('hola'), r('hola necesito')], 1));
    let previo = cerrarSesion('', s, '');
    // sesión 2 (reinicio: resultIndex vuelve a 0 y las instantáneas son de esta sesión)
    s = '';
    ({ sesion: s } = procesarResultados(s, [r('seis')], 0));
    ({ sesion: s } = procesarResultados(s, [r('seis'), r('seis cajas')], 1));
    ({ sesion: s } = procesarResultados(s, [r('seis'), r('seis cajas'), r('seis cajas de quilmes')], 2));
    expect(textoDictado('', previo, s, '')).toBe('hola necesito seis cajas de quilmes');
    previo = cerrarSesion(previo, s, '');
    expect(previo).toBe('hola necesito seis cajas de quilmes');
  });

  it('el parcial que quedó sin confirmar al cortar la sesión no se pierde', () => {
    expect(cerrarSesion('tres cajas', '', 'de agua sin gas')).toBe('tres cajas de agua sin gas');
  });

  it('compara palabras enteras, no letras', () => {
    expect(sumarDictado('pedido', 'pedidos de vino')).toBe('pedido pedidos de vino');
    expect(sumarDictado('dame la manteca', 'ca')).toBe('dame la manteca ca');
    expect(sumarDictado('pedido de', 'de')).toBe('pedido de');
    expect(sumarDictado('  hola  ', '')).toBe('hola');
    expect(sumarDictado('', '  che ')).toBe('che');
  });

  it('respeta los renglones de lo que ya estaba escrito', () => {
    expect(textoDictado('6 Quilmes\n2 Fernet\n', '', 'y una coca', '')).toBe('6 Quilmes\n2 Fernet\ny una coca');
    expect(textoDictado('6 Quilmes\n2 Fernet', '', 'y una coca', '')).toBe('6 Quilmes\n2 Fernet y una coca');
  });

  it('detecta cuando la caja cambió desde afuera (se envió o se escribió a mano)', () => {
    const emitidos = ['qué compro', 'qué compro esta semana'];
    expect(cambioExterno('qué compro esta semana', emitidos)).toBe(false); // lo puso el dictado
    expect(cambioExterno('qué compro', emitidos)).toBe(false); // React todavía muestra uno anterior
    expect(cambioExterno('', emitidos)).toBe(true); // se envió y se vació
    expect(cambioExterno('qué compro esta semana y 2 fernet', emitidos)).toBe(true); // escrito a mano
  });
});

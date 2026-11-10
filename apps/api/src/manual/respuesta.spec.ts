import { HABLAR_CON_METOGROUP, SIN_RESPUESTA, leerRespuesta } from './respuesta';

const PANTALLAS = new Set(['/stock', '/inventario']);
const SECCIONES = new Set(['deposito-stock']);

describe('respuesta del manual', () => {
  it('lo que existe: respuesta, pasos, pantalla y sección', () => {
    const r = leerRespuesta(
      'pensé… {"existe":"si","respuesta":"Desde Stock.","pasos":["Entrá a Stock","Tocá Sin stock"],"pantalla":"/stock","seccion":"deposito-stock"}',
      PANTALLAS, SECCIONES,
    );
    expect(r).toEqual({ existe: 'si', respuesta: 'Desde Stock.', pasos: ['Entrá a Stock', 'Tocá Sin stock'], pantalla: '/stock', seccion: 'deposito-stock' });
  });

  it('lo que no existe dice que hay que hablar con MetoGroup y no lleva a ninguna pantalla', () => {
    const r = leerRespuesta('{"existe":"no","respuesta":"Eso hoy no está en el sistema.","pasos":["inventado"],"pantalla":"/stock"}', PANTALLAS, SECCIONES);
    expect(r.respuesta).toBe(`Eso hoy no está en el sistema. ${HABLAR_CON_METOGROUP}`);
    expect(r.pasos).toEqual([]);
    expect(r.pantalla).toBeNull();
  });

  it('no repite MetoGroup si ya lo dijo', () => {
    const r = leerRespuesta('{"existe":"parcial","respuesta":"Una parte sí. Lo otro pedíselo a MetoGroup."}', PANTALLAS, SECCIONES);
    expect(r.respuesta).toBe('Una parte sí. Lo otro pedíselo a MetoGroup.');
  });

  it('una pantalla o una sección inventadas no salen como botón', () => {
    const r = leerRespuesta('{"existe":"si","respuesta":"Ok","pantalla":"/inventada","seccion":"no-existe"}', PANTALLAS, SECCIONES);
    expect(r.pantalla).toBeNull();
    expect(r.seccion).toBeNull();
  });

  it('sin JSON o vacío: la respuesta de repuesto', () => {
    expect(leerRespuesta('no sé', PANTALLAS, SECCIONES)).toBe(SIN_RESPUESTA);
    expect(leerRespuesta('{"existe":"si","respuesta":""}', PANTALLAS, SECCIONES)).toBe(SIN_RESPUESTA);
  });
});

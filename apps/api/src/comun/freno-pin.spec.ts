import { HttpException } from '@nestjs/common';
import { FrenoDePin } from './freno-pin';

// Un PIN de 4 dígitos no se puede dejar probar en bucle (revisión del
// 21/10/2026): 5 errados en 15 minutos y ese usuario queda frenado 15 minutos.

describe('freno de PIN de supervisor', () => {
  const reloj = () => {
    let t = 1_000_000;
    return { ahora: () => t, pasar: (ms: number) => { t += ms; } };
  };

  it('con 5 errados queda frenado (429) y dice cuánto falta', () => {
    const r = reloj();
    const f = new FrenoDePin(5, 15 * 60_000, r.ahora);
    for (let i = 0; i < 4; i++) expect(f.errado('u-1')).toBe(false);
    expect(() => f.revisar('u-1')).not.toThrow();
    expect(f.errado('u-1')).toBe(true);
    let err: any;
    try { f.revisar('u-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.message).toMatch(/Probá de nuevo en 15 minutos/);
  });

  it('el freno es por usuario: los demás siguen pudiendo', () => {
    const f = new FrenoDePin(5, 15 * 60_000, reloj().ahora);
    for (let i = 0; i < 5; i++) f.errado('u-1');
    expect(() => f.revisar('u-1')).toThrow();
    expect(() => f.revisar('u-2')).not.toThrow();
  });

  it('pasado el tiempo se puede volver a probar', () => {
    const r = reloj();
    const f = new FrenoDePin(5, 15 * 60_000, r.ahora);
    for (let i = 0; i < 5; i++) f.errado('u-1');
    r.pasar(14 * 60_000);
    expect(() => f.revisar('u-1')).toThrow(/1 minuto/);
    r.pasar(60_000);
    expect(() => f.revisar('u-1')).not.toThrow();
  });

  it('los errores viejos se olvidan y un acierto borra la cuenta', () => {
    const r = reloj();
    const f = new FrenoDePin(5, 15 * 60_000, r.ahora);
    for (let i = 0; i < 4; i++) f.errado('u-1');
    r.pasar(16 * 60_000);
    expect(f.errado('u-1')).toBe(false); // empieza de nuevo: 1 de 5
    for (let i = 0; i < 3; i++) f.errado('u-1');
    f.acerto('u-1');
    expect(f.errado('u-1')).toBe(false);
  });
});

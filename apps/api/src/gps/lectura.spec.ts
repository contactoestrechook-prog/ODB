import { claveValida, horaDe, leerOsmand, leerTraccar } from './lectura';

// Lo que llega de cada lado, tal como lo mandan (Traccar 6 con forward.type=json,
// Traccar Client nuevo y el protocolo OsmAnd viejo).

const AHORA = new Date('2026-11-03T18:00:00Z');

describe('lectura de Traccar', () => {
  const body = (position: any) => ({ position, device: { id: 1, name: '860000000000001', uniqueId: '860000000000001' } });

  it('toma el IMEI, la posición, la hora del equipo y pasa los nudos a km/h', () => {
    const r = leerTraccar(body({ valid: true, latitude: -34.4251, longitude: -58.5797, speed: 21.6, fixTime: '2026-11-03T17:59:30.000+00:00' }), AHORA);
    expect(r).toEqual({ ok: true, lectura: { equipo: '860000000000001', lat: -34.4251, lng: -58.5797, velocidadKmh: 40, en: new Date('2026-11-03T17:59:30Z') } });
  });

  it('sin señal (valid=false o 0,0) no es una posición', () => {
    expect(leerTraccar(body({ valid: false, latitude: -34.4, longitude: -58.5 }), AHORA)).toEqual({ ok: false, motivo: 'Sin señal de GPS' });
    expect(leerTraccar(body({ valid: true, latitude: 0, longitude: 0 }), AHORA)).toEqual({ ok: false, motivo: 'Sin señal de GPS' });
  });

  it('sin equipo o sin posición se rechaza', () => {
    expect(leerTraccar({ position: { latitude: -34, longitude: -58 } }, AHORA).ok).toBe(false);
    expect(leerTraccar({ device: { uniqueId: 'x' } }, AHORA).ok).toBe(false);
  });
});

describe('lectura de Traccar Client / OsmAnd', () => {
  it('el JSON de la app nueva: velocidad en m/s', () => {
    const r = leerOsmand({}, {
      device_id: 'camioneta-odb',
      location: { timestamp: '2026-11-03T17:58:00.000Z', coords: { latitude: -34.43, longitude: -58.58, speed: 10 } },
    }, AHORA);
    expect(r).toEqual({ ok: true, lectura: { equipo: 'camioneta-odb', lat: -34.43, lng: -58.58, velocidadKmh: 36, en: new Date('2026-11-03T17:58:00Z') } });
  });

  it('el protocolo viejo por parámetros: timestamp en segundos y velocidad en nudos', () => {
    const r = leerOsmand({ id: '123456', lat: '-34.43', lon: '-58.58', timestamp: '1793728680', speed: '0' }, {}, AHORA);
    expect(r).toEqual({ ok: true, lectura: { equipo: '123456', lat: -34.43, lng: -58.58, velocidadKmh: 0, en: new Date(1793728680 * 1000) } });
  });

  it('la app manda speed=-1 cuando no sabe la velocidad', () => {
    const r = leerOsmand({}, { device_id: 'x', location: { coords: { latitude: -34.4, longitude: -58.5, speed: -1 } } }, AHORA);
    expect(r.ok && r.lectura.velocidadKmh).toBeNull();
  });

  it('una latitud imposible se rechaza', () => {
    expect(leerOsmand({ id: '1', lat: '134', lon: '-58' }, {}, AHORA)).toEqual({ ok: false, motivo: 'Ubicación inválida' });
  });
});

describe('hora de la lectura', () => {
  it('milisegundos, segundos e ISO', () => {
    expect(horaDe(1793728680000, AHORA).toISOString()).toBe('2026-11-03T17:58:00.000Z');
    expect(horaDe(1793728680, AHORA).toISOString()).toBe('2026-11-03T17:58:00.000Z');
    expect(horaDe('2026-11-03T17:58:00Z', AHORA).toISOString()).toBe('2026-11-03T17:58:00.000Z');
  });

  it('un reloj adelantado o sin dato toma la hora de llegada', () => {
    expect(horaDe('2026-11-03T19:00:00Z', AHORA)).toBe(AHORA);
    expect(horaDe(undefined, AHORA)).toBe(AHORA);
    expect(horaDe('cualquier cosa', AHORA)).toBe(AHORA);
  });
});

describe('clave de entrada', () => {
  it('sin clave configurada no entra nadie', () => {
    expect(claveValida('', undefined)).toBe(false);
    expect(claveValida('abc', '')).toBe(false);
  });
  it('compara la clave entera', () => {
    expect(claveValida('abc123', 'abc123')).toBe(true);
    expect(claveValida('abc12', 'abc123')).toBe(false);
    expect(claveValida(undefined, 'abc123')).toBe(false);
  });
});

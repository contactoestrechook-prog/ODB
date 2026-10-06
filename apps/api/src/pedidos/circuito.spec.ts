import { origenDe, telefonoDeContacto, ETIQUETA_ESTADO } from './pedidos.service';
import { rangoActividad } from '../actividad/actividad.controller';

// El circuito entre áreas (Leandro, 6/10/2026): por dónde entró cada pedido,
// el WhatsApp de quien compra sin cuenta y el rango de "quién hizo qué".
describe('el circuito entre áreas', () => {
  it('por dónde entró: lo grabado manda; si no, el código', () => {
    expect(origenDe({ origen: 'bot', qr_retiro: 'PICKUP-5F2451C6C111', canal: 'pickup' })).toBe('bot');
    expect(origenDe({ qr_retiro: 'PY-123', canal: 'web' })).toBe('pedidosya');
    expect(origenDe({ qr_retiro: 'TN-9', canal: 'web' })).toBe('tiendanube');
    expect(origenDe({ qr_retiro: 'WA-1', canal: 'whatsapp' })).toBe('panel');
    expect(origenDe({ qr_retiro: 'DOM-AB12CD', canal: 'domicilio' })).toBe('domicilio');
  });

  it('el WhatsApp de contacto: celular argentino con código de área, en cualquier forma', () => {
    expect(telefonoDeContacto('11 2345-6789')).toBe('5491123456789');
    expect(telefonoDeContacto('011 15 2345-6789')).toBe('5491123456789');
    expect(telefonoDeContacto('+54 9 11 2345 6789')).toBe('5491123456789');
    expect(telefonoDeContacto('221 456-7890')).toBe('5492214567890');
    expect(telefonoDeContacto('4222-1234')).toBeNull();
    expect(telefonoDeContacto('')).toBeNull();
    expect(telefonoDeContacto(undefined)).toBeNull();
  });

  it('las etiquetas de cada paso están en castellano', () => {
    expect(ETIQUETA_ESTADO.en_preparacion).toBe('Empezó a prepararlo');
    expect(ETIQUETA_ESTADO.cancelado).toBe('Cancelado');
  });

  it('quién hizo qué: por defecto la última semana y nunca más de 92 días', () => {
    const ahora = new Date('2026-10-06T15:00:00Z');
    const r = rangoActividad(undefined, undefined, ahora);
    expect(r.hasta.toISOString()).toBe('2026-10-06T15:00:00.000Z');
    expect(r.desde.toISOString()).toBe('2026-09-29T15:00:00.000Z');
    expect(rangoActividad('2026-01-01', undefined, ahora).desde.toISOString()).toBe('2026-07-06T15:00:00.000Z');
    expect(rangoActividad('2026-10-10', undefined, ahora).desde.toISOString()).toBe('2026-09-29T15:00:00.000Z');
    expect(rangoActividad('fruta', 'otra', ahora).hasta.toISOString()).toBe('2026-10-06T15:00:00.000Z');
  });
});

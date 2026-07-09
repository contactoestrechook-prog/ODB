import { createHmac } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { verificarFirmaMercadoPago, verificarFirmaTiendaNube } from './firmas';

// Los webhooks mueven plata (marcan pagos, crean pedidos): estas firmas son la
// única barrera contra POSTs falsificados. Si un cambio las rompe, tiene que
// gritar acá y no en producción.

describe('firma de webhooks de Mercado Pago', () => {
  const SECRET = 'secreto-mp-test';
  const REQUEST_ID = 'req-abc-123';
  const PAGO_ID = '123456789';

  function firmar(ts: number, dataId = PAGO_ID, secret = SECRET) {
    const manifiesto = `id:${dataId.toLowerCase()};request-id:${REQUEST_ID};ts:${ts};`;
    const v1 = createHmac('sha256', secret).update(manifiesto).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': REQUEST_ID };
  }

  beforeEach(() => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  });

  it('acepta una notificación firmada correctamente', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() => verificarFirmaMercadoPago(firmar(ts), PAGO_ID)).not.toThrow();
  });

  it('rechaza una firma calculada con otro secret (falsificación)', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() => verificarFirmaMercadoPago(firmar(ts, PAGO_ID, 'otro-secret'), PAGO_ID)).toThrow(ForbiddenException);
  });

  it('rechaza si el data.id no coincide con lo firmado', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() => verificarFirmaMercadoPago(firmar(ts), '999999')).toThrow(ForbiddenException);
  });

  it('rechaza notificaciones viejas (anti-replay, más de 5 minutos)', () => {
    const tsViejo = Math.floor(Date.now() / 1000) - 600;
    expect(() => verificarFirmaMercadoPago(firmar(tsViejo), PAGO_ID)).toThrow(/expirado/i);
  });

  it('rechaza si falta el header x-signature', () => {
    expect(() => verificarFirmaMercadoPago({}, PAGO_ID)).toThrow(/sin firma/i);
  });

  it('sin secret configurado deja pasar (la defensa es la re-consulta a MP)', () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    expect(() => verificarFirmaMercadoPago({}, PAGO_ID)).not.toThrow();
  });
});

describe('firma de webhooks de Tienda Nube', () => {
  const SECRET = 'secreto-tn-test';
  const BODY = Buffer.from(JSON.stringify({ store_id: 1, id: 42 }));

  beforeEach(() => {
    process.env.TIENDANUBE_CLIENT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.TIENDANUBE_CLIENT_SECRET;
  });

  it('acepta el body firmado con el client secret', () => {
    const firma = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(() => verificarFirmaTiendaNube(BODY, { 'x-linkedstore-hmac-sha256': firma })).not.toThrow();
  });

  it('rechaza un body adulterado', () => {
    const firma = createHmac('sha256', SECRET).update(BODY).digest('hex');
    const otroBody = Buffer.from(JSON.stringify({ store_id: 1, id: 43 }));
    expect(() => verificarFirmaTiendaNube(otroBody, { 'x-linkedstore-hmac-sha256': firma })).toThrow(ForbiddenException);
  });

  it('rechaza si no viene la firma', () => {
    expect(() => verificarFirmaTiendaNube(BODY, {})).toThrow(/sin firma/i);
  });

  it('sin secret configurado deja pasar (defensa: re-consulta a TN)', () => {
    delete process.env.TIENDANUBE_CLIENT_SECRET;
    expect(() => verificarFirmaTiendaNube(BODY, {})).not.toThrow();
  });
});

import { createHmac, timingSafeEqual } from 'crypto';
import { ForbiddenException, Logger } from '@nestjs/common';

const log = new Logger('firmas-webhook');

function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verifica la firma HMAC de un webhook de Mercado Pago.
 * MP envía el header `x-signature: ts=<epoch>,v1=<hmac_hex>` y `x-request-id`.
 * El manifiesto firmado es `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * y se firma con HMAC-SHA256 usando MERCADOPAGO_WEBHOOK_SECRET.
 * Doc: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 *
 * Comportamiento: si el secret está configurado, se exige firma válida
 * (fail-closed). Si no está configurado, se registra una advertencia y se deja
 * pasar — la defensa real es la re-consulta del pago a la API de MP, pero en
 * producción DEBE configurarse el secret.
 */
export function verificarFirmaMercadoPago(
  headers: Record<string, string | string[] | undefined>,
  dataId: string | number | undefined,
  secretOverride?: string, // multi-cuenta: el secret de la cuenta que corresponda
): void {
  const secret = secretOverride ?? process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('MERCADOPAGO_WEBHOOK_SECRET sin configurar: webhook aceptado sin verificar firma');
    return;
  }
  const firma = String(headers['x-signature'] ?? '');
  const requestId = String(headers['x-request-id'] ?? '');
  if (!firma) throw new ForbiddenException('Webhook MP sin firma');

  const partes = Object.fromEntries(
    firma.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k.trim(), v.join('=').trim()];
    }),
  );
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) throw new ForbiddenException('Firma MP con formato inválido');

  // anti-replay: no aceptar notificaciones con más de 5 minutos
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    throw new ForbiddenException('Webhook MP expirado');
  }

  const id = dataId != null ? String(dataId).toLowerCase() : '';
  const manifiesto = `id:${id};request-id:${requestId};ts:${ts};`;
  const esperada = createHmac('sha256', secret).update(manifiesto).digest('hex');
  if (!igualSeguro(v1, esperada)) {
    throw new ForbiddenException('Firma de webhook MP inválida');
  }
}

/**
 * Verifica la firma HMAC de un webhook de Tienda Nube (Nuvemshop).
 * TN envía `x-linkedstore-hmac-sha256: <hmac_hex>` calculado sobre el cuerpo
 * crudo con HMAC-SHA256 usando el client secret de la app.
 * Doc: https://tiendanube.github.io/api-documentation/resources/webhook
 */
export function verificarFirmaTiendaNube(
  rawBody: Buffer | undefined,
  headers: Record<string, string | string[] | undefined>,
): void {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET || process.env.TIENDANUBE_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('TIENDANUBE_CLIENT_SECRET sin configurar: webhook aceptado sin verificar firma');
    return;
  }
  const firma = String(headers['x-linkedstore-hmac-sha256'] ?? '');
  if (!rawBody || !firma) throw new ForbiddenException('Webhook Tienda Nube sin firma');

  const esperada = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!igualSeguro(firma, esperada)) {
    throw new ForbiddenException('Firma de webhook Tienda Nube inválida');
  }
}

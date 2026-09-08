import { Logger } from '@nestjs/common';

// Envío de mail del sistema. Se hace por HTTP (sin librerías) contra Resend,
// que es lo que ODB tiene a mano; si algún día se cambia de proveedor, este es
// el único archivo que se toca.
//
// Sin credencial cargada NO es un error: el sistema sigue funcionando y avisa
// que no pudo mandarlo, para que el circuito de recuperación de clave use el
// otro canal (WhatsApp) o el dueño pase el enlace a mano.
const log = new Logger('Mail');

export function hayMailConfigurado(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function enviarMail(opciones: {
  para: string;
  asunto: string;
  html: string;
  texto: string;
}): Promise<{ enviado: boolean; motivo?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { enviado: false, motivo: 'no hay servicio de mail configurado' };
  const desde = process.env.MAIL_DESDE || 'O.D.B Premium Market <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: desde,
        to: [opciones.para],
        subject: opciones.asunto,
        html: opciones.html,
        text: opciones.texto,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      log.warn(`no se pudo enviar el mail (${r.status}): ${detalle.slice(0, 200)}`);
      return { enviado: false, motivo: `el servicio de mail respondió ${r.status}` };
    }
    return { enviado: true };
  } catch (e: any) {
    log.warn(`no se pudo enviar el mail: ${e?.message ?? e}`);
    return { enviado: false, motivo: 'no se pudo contactar al servicio de mail' };
  }
}

// El mail de recuperación: sobrio, con la marca de la casa y un solo botón.
export function mailDeReseteo(nombre: string, enlace: string) {
  const texto =
    `Hola ${nombre}.\n\nPediste restablecer tu contraseña del sistema de O.D.B Premium Market.\n\n` +
    `Entrá acá para elegir una nueva:\n${enlace}\n\n` +
    `El enlace vence en 30 minutos y se puede usar una sola vez.\n\n` +
    `Si no lo pediste vos, ignorá este mensaje: tu contraseña sigue igual.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#F0EBE2;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e0d6">
    <div style="background:#141414;padding:20px 24px">
      <div style="color:#F0EBE2;font-size:13px;letter-spacing:3px;font-weight:700">O.D.B PREMIUM MARKET</div>
    </div>
    <div style="padding:26px 24px;color:#141414;line-height:1.55;font-size:15px">
      <p style="margin:0 0 14px">Hola ${escapar(nombre)}.</p>
      <p style="margin:0 0 20px">Pediste restablecer tu contraseña del sistema.</p>
      <p style="margin:0 0 24px">
        <a href="${enlace}" style="display:inline-block;background:#141414;color:#F0EBE2;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600">Elegir una contraseña nueva</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b6b6b">El enlace vence en 30 minutos y se usa una sola vez.</p>
      <p style="margin:0;font-size:13px;color:#6b6b6b">Si no lo pediste vos, ignorá este mensaje: tu contraseña sigue igual.</p>
    </div>
  </div>
</div>`;
  return { asunto: 'Restablecer tu contraseña · O.D.B', html, texto };
}

const escapar = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

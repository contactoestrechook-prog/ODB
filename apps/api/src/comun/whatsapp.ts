import { SupabaseClient } from '@supabase/supabase-js';

// Aviso interno por WhatsApp (a un supervisor, no a un cliente) por la línea de
// la casa en WAHA. Se registra en bot_envios para que el bot sepa que el
// mensaje lo mandó el sistema y no una persona desde el teléfono (si no, esa
// charla quedaría "atendida desde el teléfono" y el bot se callaría 6 h).
// Número de WhatsApp de un celular argentino, como lo espera WhatsApp: 549 + área
// + número. En las fichas hay de todo ("11 2281-2200", "541122812200",
// "+54 9 11…", "011 15…"); sin el 9 WhatsApp acepta el envío y no le llega a
// nadie (16/9/2026: el enlace para recuperar la clave de Jackie salió a
// 541122812200). Números de otros países se dejan como vienen.
export function celularWhatsapp(numero: string): string {
  let d = String(numero ?? '').replace(/\D/g, '');
  if (!d) return d;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) {
    let resto = d.slice(2);
    if (resto.startsWith('0')) resto = resto.slice(1);
    resto = resto.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
    return resto.length === 10 ? `549${resto}` : d;
  }
  // local: "011 15 2281-2200", "11 2281-2200". "15 2281 2200" no trae código de
  // área: no se inventa uno.
  if (d.startsWith('15') && d.length === 10) return d;
  if (d.startsWith('0')) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return d.length === 10 ? `549${d}` : d;
}

type ResultadoWaha = { enviado: boolean; id?: string | null; motivo?: string; incierto?: boolean };

// El destino: un chatId ya confirmado ("549…@c.us", de existeEnWhatsapp) va
// tal cual; un número se normaliza como celular argentino.
function chatDe(to: string): { chatId: string; digitos: string } | null {
  const crudo = String(to ?? '').trim();
  if (/@c\.us$/.test(crudo)) return { chatId: crudo, digitos: crudo.replace(/\D/g, '') };
  const digitos = celularWhatsapp(crudo);
  return digitos.length < 8 ? null : { chatId: `${digitos}@c.us`, digitos };
}

// Un POST a WAHA que distingue "no salió" de "no sé si salió". Un corte por
// tiempo o un error del servidor NO quiere decir que no salió: WAHA sigue
// trabajando y el mensaje puede llegar igual. Quien llama no tiene que
// reintentar solo un envío incierto (el proveedor recibiría el pedido dos veces).
async function postWaha(db: SupabaseClient, ruta: string, cuerpo: Record<string, unknown>, digitos: string, origen: string, ms: number): Promise<ResultadoWaha> {
  const wahaUrl = process.env.WAHA_URL;
  const wahaKey = process.env.WAHA_API_KEY;
  if (!wahaUrl || !wahaKey) return { enviado: false, motivo: 'WAHA sin configurar' };
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${wahaUrl.replace(/\/$/, '')}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey },
      body: JSON.stringify({ session: process.env.WAHA_SESSION || 'default', ...cuerpo }),
      signal: ctrl.signal,
    });
    const res: any = await r.json().catch(() => ({}));
    if (!r.ok) return { enviado: false, motivo: `WAHA ${ruta.replace('/api/', '')} ${r.status}`, incierto: r.status >= 500 };
    // el id completo ("true_549…@c.us_3EB0…") es el que trae el eco del mensaje
    const id = res?.id?._serialized ?? (typeof res?.id === 'string' ? res.id : null) ?? res?.key?.id ?? null;
    if (id) await db.from('bot_envios').insert({ waha_id: String(id), telefono: digitos, origen }).then(() => null, () => null);
    return { enviado: true, id };
  } catch (e) {
    return { enviado: false, motivo: e instanceof Error ? e.message : String(e), incierto: true };
  } finally {
    clearTimeout(reloj);
  }
}

export async function enviarTextoWhatsapp(db: SupabaseClient, to: string, text: string, origen = 'aviso_interno'): Promise<ResultadoWaha> {
  const c = chatDe(to);
  if (!c) return { enviado: false, motivo: 'Número inválido' };
  return postWaha(db, '/api/sendText', { chatId: c.chatId, text }, c.digitos, origen, 15_000);
}

// Un archivo (PDF). WAHA lo baja de la URL: tiene que ser accesible desde
// afuera (una URL firmada de Supabase sirve).
export async function enviarArchivoWhatsapp(db: SupabaseClient, to: string, url: string, nombreArchivo: string, epigrafe = '', origen = 'aviso_interno'): Promise<ResultadoWaha> {
  const c = chatDe(to);
  if (!c) return { enviado: false, motivo: 'Número inválido' };
  const mimetype = /\.pdf$/i.test(nombreArchivo) ? 'application/pdf' : 'application/octet-stream';
  return postWaha(db, '/api/sendFile', { chatId: c.chatId, file: { url, mimetype, filename: nombreArchivo }, caption: epigrafe }, c.digitos, origen, 60_000);
}

// Una imagen (la tarjeta Placa roja) con su epígrafe.
export async function enviarImagenWhatsapp(db: SupabaseClient, to: string, url: string, epigrafe = '', origen = 'aviso_interno'): Promise<ResultadoWaha> {
  const c = chatDe(to);
  if (!c) return { enviado: false, motivo: 'Número inválido' };
  return postWaha(db, '/api/sendImage', { chatId: c.chatId, file: { url, mimetype: 'image/png', filename: 'pedido.png' }, caption: epigrafe }, c.digitos, origen, 60_000);
}

// ¿Ese número tiene WhatsApp? WhatsApp ACEPTA mandar a un número que no existe
// y el mensaje no le llega a nadie, así que antes de mandarle algo importante a
// alguien nuevo (un proveedor) se pregunta. Prueba el celular (549…) y, si no,
// el mismo número sin el 9 (54…): así figura un WhatsApp Business en un fijo.
// Si WAHA no contesta, tira: nunca se da por bueno un número sin confirmarlo.
export async function existeEnWhatsapp(numero: string): Promise<{ existe: boolean; chatId?: string; verificado: boolean }> {
  const wahaUrl = process.env.WAHA_URL;
  const wahaKey = process.env.WAHA_API_KEY;
  if (!wahaUrl || !wahaKey) throw new Error('WAHA sin configurar');
  const celular = celularWhatsapp(numero);
  const candidatos = celular.startsWith('549') ? [celular, `54${celular.slice(3)}`] : [celular];
  for (const n of candidatos) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const q = new URLSearchParams({ phone: n, session: process.env.WAHA_SESSION || 'default' });
      const r = await fetch(`${wahaUrl.replace(/\/$/, '')}/api/contacts/check-exists?${q}`, { headers: { 'X-Api-Key': wahaKey }, signal: ctrl.signal });
      // la versión de WAHA no tiene la consulta: no se puede verificar, se usa el celular
      if (r.status === 404 || r.status === 501) return { existe: true, chatId: `${celular}@c.us`, verificado: false };
      if (!r.ok) throw new Error(`WAHA check-exists ${r.status}`);
      const j: any = await r.json().catch(() => ({}));
      if (j?.numberExists) return { existe: true, chatId: String(j.chatId || `${n}@c.us`), verificado: true };
    } finally {
      clearTimeout(reloj);
    }
  }
  return { existe: false, verificado: true };
}

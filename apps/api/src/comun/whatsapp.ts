import { SupabaseClient } from '@supabase/supabase-js';

// Aviso interno por WhatsApp (a un supervisor, no a un cliente) por la línea de
// la casa en WAHA. Se registra en bot_envios para que el bot sepa que el
// mensaje lo mandó el sistema y no una persona desde el teléfono (si no, esa
// charla quedaría "atendida desde el teléfono" y el bot se callaría 6 h).
export async function enviarTextoWhatsapp(
  db: SupabaseClient,
  to: string,
  text: string,
  origen = 'aviso_interno',
): Promise<{ enviado: boolean; id?: string | null; motivo?: string }> {
  const wahaUrl = process.env.WAHA_URL;
  const wahaKey = process.env.WAHA_API_KEY;
  const sesion = process.env.WAHA_SESSION || 'default';
  if (!wahaUrl || !wahaKey) return { enviado: false, motivo: 'WAHA sin configurar' };
  const digitos = String(to ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return { enviado: false, motivo: 'Número inválido' };
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(`${wahaUrl.replace(/\/$/, '')}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey },
      body: JSON.stringify({ session: sesion, chatId: `${digitos}@c.us`, text }),
      signal: ctrl.signal,
    });
    const cuerpo: any = await r.json().catch(() => ({}));
    if (!r.ok) return { enviado: false, motivo: `WAHA sendText ${r.status}` };
    // el id completo ("true_549…@c.us_3EB0…") es el que trae el eco del mensaje
    const id = cuerpo?.id?._serialized ?? (typeof cuerpo?.id === 'string' ? cuerpo.id : null) ?? cuerpo?.key?.id ?? null;
    if (id) await db.from('bot_envios').insert({ waha_id: String(id), telefono: digitos, origen }).then(() => null, () => null);
    return { enviado: true, id };
  } catch (e) {
    return { enviado: false, motivo: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(reloj);
  }
}

// Panel RESPONDE v16 — + envío por WAHA para tenants waha (enviar, enviar_media, difusión). Sobre v15 — + difusion_plantilla (masivo fuera de 24h) + plantillas_sync_todas (cron). Sobre v14 (recurrentes), v13 (plantillas), v12 (análisis IA).
import { createClient } from 'npm:@supabase/supabase-js@2';

const PANEL_KEY = 'MG-resp-9t3Kx7Qw41Lp';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type'
};
const J = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { db: { schema: 'responde' } }
);

async function hashPassword(pw: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

type Auth = { tipo: 'admin' | 'cliente'; user_id?: string; tenant_id?: string | null; nombre?: string };

async function resolverAuth(url: URL, body: Record<string, unknown>): Promise<Auth | null> {
  const key = url.searchParams.get('key') || '';
  if (key === PANEL_KEY) return { tipo: 'admin', tenant_id: null };
  const token = url.searchParams.get('token') || String(body?.token || '');
  if (!token) return null;
  const { data: ses } = await supa.from('panel_sessions').select('user_id, expira_at').eq('token', token).maybeSingle();
  if (!ses || new Date(ses.expira_at) < new Date()) return null;
  const { data: u } = await supa.from('panel_users').select('id, tenant_id, rol, nombre, activo').eq('id', ses.user_id).single();
  if (!u || !u.activo) return null;
  return { tipo: u.rol === 'admin' ? 'admin' : 'cliente', user_id: u.id, tenant_id: u.tenant_id, nombre: u.nombre };
}

function normalizarAR(to: string): string {
  const m = String(to).match(/^549(11)(\d{8})$/);
  return m ? '54' + m[1] + '15' + m[2] : String(to);
}

async function enviarWhatsApp(t: { whatsapp_phone_number_id: string; whatsapp_access_token: string }, waId: string, texto: string) {
  const resp = await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.whatsapp_access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarAR(waId), type: 'text', text: { body: texto } })
  });
  const j = await resp.json().catch(() => ({}));
  return { ok: resp.ok, detalle: j };
}

// v16 — tenants WAHA: la app envía por la instancia propia (mismo camino que el
// CRM de CarCash). Los tenants Meta siguen exactamente igual que antes.
type TenantCanal = { channel_type?: string | null; waha_base_url?: string | null; waha_session?: string | null; waha_api_key?: string | null; whatsapp_phone_number_id?: string; whatsapp_access_token?: string };
function esWaha(t: TenantCanal | null | undefined): boolean {
  return !!(t && t.channel_type === 'waha' && t.waha_base_url && t.waha_session && t.waha_api_key);
}
function chatIdWaha(waId: string): string {
  const raw = String(waId);
  if (raw.includes('@')) return raw.split(':')[0];           // @lid o @c.us: tal cual
  const d = raw.replace(/\D/g, '');
  return d ? `${d}@c.us` : raw;
}
async function wahaPost(t: TenantCanal, ruta: string, cuerpo: Record<string, unknown>) {
  const resp = await fetch(`${String(t.waha_base_url).replace(/\/$/, '')}${ruta}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': String(t.waha_api_key) },
    body: JSON.stringify({ session: t.waha_session, ...cuerpo })
  });
  const j = await resp.json().catch(() => ({}));
  return { ok: resp.ok, detalle: j };
}
async function enviarTextoWaha(t: TenantCanal, waId: string, texto: string) {
  return wahaPost(t, '/api/sendText', { chatId: chatIdWaha(waId), text: texto });
}
async function enviarMediaWaha(t: TenantCanal, waId: string, kind: string, mediaUrl: string, mime: string, filename: string, cap: string) {
  const file = { url: mediaUrl, mimetype: mime, filename };
  const chatId = chatIdWaha(waId);
  if (kind === 'image') return wahaPost(t, '/api/sendImage', { chatId, file, caption: cap });
  if (kind === 'video') {
    const r = await wahaPost(t, '/api/sendVideo', { chatId, file, caption: cap });
    return r.ok ? r : wahaPost(t, '/api/sendFile', { chatId, file, caption: cap || '🎬 Video' });
  }
  if (kind === 'audio') {
    const r = await wahaPost(t, '/api/sendVoice', { chatId, file });
    if (r.ok && cap) await enviarTextoWaha(t, waId, cap);
    return r.ok ? r : wahaPost(t, '/api/sendFile', { chatId, file, caption: cap || '🎤 Nota de voz' });
  }
  return wahaPost(t, '/api/sendFile', { chatId, file, caption: cap });
}

function tipoMedia(mime: string): string {
  const mm = mime.toLowerCase();
  return mm.startsWith('image/') ? 'image' : mm.startsWith('audio/') ? 'audio' : mm.startsWith('video/') ? 'video' : 'document';
}

async function subirMediaAMeta(t: { whatsapp_phone_number_id: string; whatsapp_access_token: string }, bin: Uint8Array, mime: string, filename: string) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([bin], { type: mime }), filename);
  fd.append('type', mime);
  const up = await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_phone_number_id}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${t.whatsapp_access_token}` }, body: fd
  });
  const uj = await up.json().catch(() => ({}));
  return { ok: up.ok && !!uj.id, id: uj.id as string | undefined, detalle: uj };
}

async function enviarMediaWhatsApp(t: { whatsapp_phone_number_id: string; whatsapp_access_token: string }, waId: string, kind: string, mediaId: string, filename: string, cap: string) {
  const payload: Record<string, unknown> = { messaging_product: 'whatsapp', to: normalizarAR(waId), type: kind };
  payload[kind] = kind === 'audio' ? { id: mediaId }
    : kind === 'document' ? { id: mediaId, filename, ...(cap ? { caption: cap } : {}) }
    : { id: mediaId, ...(cap ? { caption: cap } : {}) };
  const resp = await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_phone_number_id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${t.whatsapp_access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const rj = await resp.json().catch(() => ({}));
  if (resp.ok && kind === 'audio' && cap) await enviarWhatsApp(t, waId, cap);
  return { ok: resp.ok, detalle: rj };
}

function etiquetaMedia(kind: string, filename: string): string {
  return kind === 'image' ? '📷 Imagen' : kind === 'video' ? '🎬 Video' : kind === 'audio' ? '🎙️ Audio' : '📄 ' + filename;
}

async function contactoAutorizado(auth: Auth, contact_id: string) {
  const { data: c } = await supa.from('contacts').select('id, whatsapp_id, tenant_id, fase_descubrimiento, bloqueado').eq('id', contact_id).maybeSingle();
  if (!c) return null;
  if (auth.tipo === 'cliente' && c.tenant_id !== auth.tenant_id) return null;
  return c;
}

async function configIA() {
  const { data } = await supa.from('ia_config').select('anthropic_api_key, modelo').eq('id', 1).maybeSingle();
  return { key: data?.anthropic_api_key || '', modelo: data?.modelo || 'claude-haiku-4-5-20251001' };
}

function catalogoCompacto(cat: unknown): string {
  if (!cat) return '';
  try {
    const s = JSON.stringify(cat);
    return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
  } catch { return ''; }
}

type MsgRow = { role: string; content: string | null; metadata: Record<string, unknown> | null; created_at: string };

async function analizarConversacion(contact_id: string) {
  const { data: c } = await supa.from('contacts').select('id, tenant_id, nombre').eq('id', contact_id).maybeSingle();
  if (!c) return { ok: false, error: 'contacto inexistente' };
  const { data: t } = await supa.from('tenants').select('nombre, system_prompt_base, catalogo').eq('id', c.tenant_id).single();
  const { data: msgs } = await supa.from('messages')
    .select('role, content, metadata, created_at')
    .eq('contact_id', c.id).order('created_at', { ascending: true }).limit(400);
  const evs = ((msgs || []) as MsgRow[]).filter(m => m.content && String(m.content).trim());
  if (evs.length < 2) return { ok: false, error: 'Conversación demasiado corta para analizar' };
  const ultimoAt = evs[evs.length - 1].created_at;

  const { data: prev } = await supa.from('conversation_analysis').select('*')
    .eq('contact_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (prev && prev.hasta_msg_at && new Date(prev.hasta_msg_at) >= new Date(ultimoAt)) {
    return { ok: true, analisis: prev, cacheado: true };
  }

  const esHumano = (m: MsgRow) => m.role === 'assistant' && !!(m.metadata && m.metadata.humano);
  const huboHumano = evs.some(esHumano);
  const ultimos = evs.slice(-80);
  const transcript = ultimos.map(m => {
    const hora = new Date(m.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
    const quien = m.role === 'user' ? 'CLIENTE' : esHumano(m) ? 'ASESOR HUMANO' : 'BOT';
    return `[${hora}] ${quien}: ${m.content}`;
  }).join('\n');

  const negocio = String(t?.system_prompt_base || '').slice(0, 1500);
  const catalogo = catalogoCompacto(t?.catalogo);
  const evaluado = huboHumano ? 'humano' : 'bot';

  const system = `Sos auditor de calidad de atención al cliente por WhatsApp del negocio "${t?.nombre || 'el negocio'}". Analizás conversaciones entre clientes, el bot del negocio y los asesores humanos.

${huboHumano
    ? 'Evaluá SOLO la actuación del ASESOR HUMANO (sus mensajes). El BOT no se califica, pero contás su contexto.'
    : 'Todavía no intervino ningún humano: evaluá la actuación del BOT (fue el único que atendió) y aclaralo en el resumen.'}

Criterios:
- ¿Respondió a tiempo y respondió LO QUE el cliente preguntó, o esquivó/ignoró preguntas?
- ¿Los datos que dio coinciden con la información real del negocio que te paso? Marcá datos_correctos=false SOLO si hay contradicción clara.
- ¿Hizo avanzar la conversación hacia el objetivo comercial? (pidió datos, ofreció opciones concretas, propuso el siguiente paso)
- Trato: cordial y profesional. Sin destrato, sin promesas indebidas (descuentos no autorizados, plazos inventados, compromisos sin respaldo).

Banderas rojas (tipo: "dato_falso" | "destrato" | "promesa_indebida" | "abandono" | "otro"): solo cosas GRAVES que el dueño deba ver. Sin banderas si no las hay.

CALIDAD DE ESCRITURA de ${huboHumano ? 'ASESOR HUMANO (solo sus mensajes)' : 'BOT'}: ortografía, gramática, semántica (que las frases digan lo que quiere decir), puntuación y claridad profesional.
- Es WhatsApp argentino: el voseo, la informalidad cordial y alguna abreviatura común NO son errores.
- SÍ son errores: faltas de ortografía reales (haber/a ver, ahí/hay/ay, s/c/z mal usadas, tildes que cambian el sentido), concordancia rota, frases confusas o ambiguas, puntuación que hace ilegible el mensaje.
- Listá cada falta REAL como "lo que escribió → como va" (máximo 6). Si escribe bien, lista vacía y decilo.

Respondé ÚNICAMENTE con JSON válido, sin markdown:
{"nota": 1-10, "resumen": "2 frases en castellano rioplatense", "respondio_consultas": bool, "datos_correctos": bool, "avanzo_venta": bool, "banderas": [{"tipo": "...", "detalle": "..."}], "escritura": {"nota": 1-10, "faltas": ["escribió → corrección"], "observacion": "1 frase sobre cómo escribe"}}`;

  const user = `INFORMACIÓN REAL DEL NEGOCIO (para verificar datos):\n${negocio}${catalogo ? '\n\nCATÁLOGO/DATOS DEL NEGOCIO:\n' + catalogo : ''}\n\n=== CONVERSACIÓN ===\n${transcript}`;

  const ia = await configIA();
  if (!ia.key) return { ok: false, error: 'Falta la clave de IA (responde.ia_config)' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ia.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ia.modelo, max_tokens: 900, system, messages: [{ role: 'user', content: user }] })
  });
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    return { ok: false, error: `IA respondió ${r.status}: ${det.slice(0, 200)}` };
  }
  const out = await r.json();
  let texto = (out.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  texto = texto.replace(/```json|```/g, '').trim();
  let res;
  try { res = JSON.parse(texto); } catch {
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: 'La IA no devolvió JSON: ' + texto.slice(0, 150) };
    try { res = JSON.parse(m[0]); } catch { return { ok: false, error: 'JSON inválido de la IA' }; }
  }

  const fila = {
    tenant_id: c.tenant_id,
    contact_id: c.id,
    evaluado,
    nota: Math.max(1, Math.min(10, Math.round(Number(res.nota) || 5))),
    resumen: String(res.resumen || '').slice(0, 600),
    respondio_consultas: !!res.respondio_consultas,
    datos_correctos: !!res.datos_correctos,
    avanzo_venta: !!res.avanzo_venta,
    banderas: Array.isArray(res.banderas) ? res.banderas.slice(0, 6) : [],
    escritura: res.escritura && typeof res.escritura === 'object' ? {
      nota: Math.max(1, Math.min(10, Math.round(Number(res.escritura.nota) || 0))) || null,
      faltas: Array.isArray(res.escritura.faltas) ? res.escritura.faltas.slice(0, 6).map(String) : [],
      observacion: String(res.escritura.observacion || '').slice(0, 300)
    } : null,
    hasta_msg_at: ultimoAt,
    mensajes_analizados: ultimos.length
  };
  const { data: ins, error } = await supa.from('conversation_analysis').insert(fila).select('*').single();
  if (error) return { ok: false, error: 'No se pudo guardar: ' + error.message };
  return { ok: true, analisis: ins };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const accion = body.accion;

    if (accion === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return J({ error: 'faltan datos' }, 400);
      const { data: u } = await supa.from('panel_users').select('*').eq('email', email).eq('activo', true).maybeSingle();
      if (!u) return J({ error: 'usuario o contraseña incorrectos' }, 401);
      const h = await hashPassword(password, u.salt);
      if (h !== u.password_hash) return J({ error: 'usuario o contraseña incorrectos' }, 401);
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      const expira = new Date(Date.now() + 30 * 864e5).toISOString();
      await supa.from('panel_sessions').insert({ token, user_id: u.id, expira_at: expira });
      return J({ ok: true, token, rol: u.rol, nombre: u.nombre, tenant_id: u.tenant_id });
    }

    const auth = await resolverAuth(url, body);
    if (!auth) return J({ error: 'No autorizado' }, 401);

    if (accion === 'logout') {
      const token = url.searchParams.get('token') || String(body.token || '');
      if (token) await supa.from('panel_sessions').delete().eq('token', token);
      return J({ ok: true });
    }

    if (accion === 'cambiar_password') {
      if (!auth.user_id) return J({ error: 'sesión requerida' }, 400);
      const { actual, nueva } = body;
      if (!actual || !nueva || String(nueva).length < 8) return J({ error: 'la nueva contraseña debe tener al menos 8 caracteres' }, 400);
      const { data: u } = await supa.from('panel_users').select('*').eq('id', auth.user_id).single();
      if (await hashPassword(String(actual), u.salt) !== u.password_hash) return J({ error: 'contraseña actual incorrecta' }, 401);
      const salt = crypto.randomUUID().replace(/-/g, '');
      const hash = await hashPassword(String(nueva), salt);
      await supa.from('panel_users').update({ password_hash: hash, salt }).eq('id', u.id);
      return J({ ok: true });
    }

    if (accion === 'crear_usuario') {
      if (auth.tipo !== 'admin') return J({ error: 'solo admin' }, 403);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const tenant_id = body.tenant_id || null;
      const rol = body.rol === 'admin' ? 'admin' : 'cliente';
      if (!email || password.length < 8) return J({ error: 'email y contraseña (mín 8) requeridos' }, 400);
      if (rol === 'cliente' && !tenant_id) return J({ error: 'cliente requiere tenant_id' }, 400);
      const salt = crypto.randomUUID().replace(/-/g, '');
      const hash = await hashPassword(password, salt);
      const { error: e } = await supa.from('panel_users').insert({ email, password_hash: hash, salt, rol, tenant_id, nombre: body.nombre || null });
      if (e) return J({ error: e.message }, 400);
      return J({ ok: true });
    }

    if (accion === 'enviar') {
      const { contact_id, texto } = body;
      if (!contact_id || !texto || !String(texto).trim()) return J({ error: 'faltan datos' }, 400);
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      const { data: t } = await supa.from('tenants').select('whatsapp_phone_number_id, whatsapp_access_token, channel_type, waha_base_url, waha_session, waha_api_key').eq('id', c.tenant_id).single();
      const r = esWaha(t) ? await enviarTextoWaha(t!, c.whatsapp_id, String(texto).trim()) : await enviarWhatsApp(t!, c.whatsapp_id, String(texto).trim());
      if (!r.ok) return J({ error: esWaha(t) ? 'WhatsApp rechazó el envío' : 'Meta rechazó el envío (¿ventana de 24h vencida?)', detalle: r.detalle }, 502);
      await supa.from('messages').insert({ contact_id: c.id, tenant_id: c.tenant_id, role: 'assistant', content: String(texto).trim(), message_type: 'text', fase_en_momento: c.fase_descubrimiento, metadata: { humano: true } });
      await supa.from('contacts').update({ modo_humano: true }).eq('id', c.id);
      return J({ ok: true });
    }

    if (accion === 'enviar_media') {
      const { contact_id, filename, mime, data_b64, caption } = body;
      if (!contact_id || !filename || !mime || !data_b64) return J({ error: 'faltan datos' }, 400);
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      let bin: Uint8Array;
      try { bin = Uint8Array.from(atob(String(data_b64)), (ch) => ch.charCodeAt(0)); } catch { return J({ error: 'archivo inválido' }, 400); }
      if (bin.length > 8 * 1024 * 1024) return J({ error: 'máximo 8 MB por archivo' }, 400);
      const mm = String(mime).toLowerCase();
      const kind = tipoMedia(mm);
      const { data: t } = await supa.from('tenants').select('whatsapp_phone_number_id, whatsapp_access_token, channel_type, waha_base_url, waha_session, waha_api_key').eq('id', c.tenant_id).single();
      const cap = String(caption || '').trim();
      let media_url: string | null = null;
      try {
        const path = `${c.tenant_id}/${c.id}/${Date.now()}_${String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`;
        const { error: se } = await supa.storage.from('panel-media').upload(path, bin, { contentType: mm });
        if (!se) media_url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/panel-media/${path}`;
      } catch (_) { }
      if (esWaha(t)) {
        // WAHA baja el archivo desde una URL pública: sin bucket no hay envío
        if (!media_url) return J({ error: 'No pude guardar el archivo para enviarlo' }, 502);
        const r = await enviarMediaWaha(t!, c.whatsapp_id, kind, media_url, mm, String(filename), cap);
        if (!r.ok) return J({ error: 'WhatsApp rechazó el archivo', detalle: r.detalle }, 502);
      } else {
        const up = await subirMediaAMeta(t!, bin, mm, String(filename));
        if (!up.ok) return J({ error: 'Meta rechazó el archivo (formato no soportado o muy pesado)', detalle: up.detalle }, 502);
        const r = await enviarMediaWhatsApp(t!, c.whatsapp_id, kind, up.id!, String(filename), cap);
        if (!r.ok) return J({ error: 'Meta rechazó el envío (¿ventana de 24h vencida?)', detalle: r.detalle }, 502);
      }
      const etiqueta = etiquetaMedia(kind, String(filename));
      await supa.from('messages').insert({ contact_id: c.id, tenant_id: c.tenant_id, role: 'assistant', content: cap ? etiqueta + ' — ' + cap : etiqueta, message_type: kind, fase_en_momento: c.fase_descubrimiento, metadata: { humano: true, media_url, mime: mm, filename: String(filename), caption: cap || null } });
      await supa.from('contacts').update({ modo_humano: true }).eq('id', c.id);
      return J({ ok: true, media_url });
    }

    if (accion === 'bot') {
      const { contact_id, activar } = body;
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      await supa.from('contacts').update({ modo_humano: !activar }).eq('id', c.id);
      return J({ ok: true, bot_activo: !!activar });
    }

    if (accion === 'gestion') {
      const { contact_id, activar } = body;
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      await supa.from('contacts').update({ gestion_humana: !!activar }).eq('id', c.id);
      return J({ ok: true, gestion_humana: !!activar });
    }

    if (accion === 'nota') {
      const { contact_id, nota } = body;
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      await supa.from('contacts').update({ nota_interna: String(nota || '').slice(0, 4000) }).eq('id', c.id);
      return J({ ok: true });
    }

    if (accion === 'analizar') {
      const { contact_id } = body;
      if (!contact_id) return J({ error: 'faltan datos' }, 400);
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      const r = await analizarConversacion(c.id);
      return J(r, r.ok ? 200 : 400);
    }

    if (accion === 'analizar_lote') {
      if (auth.tipo !== 'admin') return J({ error: 'solo admin' }, 403);
      const { data: cs } = await supa.from('contacts')
        .select('id, last_interaction').not('last_interaction', 'is', null)
        .order('last_interaction', { ascending: false }).limit(80);
      const resultados: { contact_id: string; ok: boolean; error?: string }[] = [];
      let corridos = 0;
      for (const c of (cs || [])) {
        if (corridos >= 15) break;
        const { data: prev } = await supa.from('conversation_analysis').select('hasta_msg_at')
          .eq('contact_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (prev && prev.hasta_msg_at && new Date(prev.hasta_msg_at) >= new Date(c.last_interaction)) continue;
        try {
          const r = await analizarConversacion(c.id);
          if (r.ok && !r.cacheado) corridos++;
          if (!r.ok && r.error === 'Conversación demasiado corta para analizar') continue;
          resultados.push({ contact_id: c.id, ok: !!r.ok, error: r.error });
        } catch (e) {
          resultados.push({ contact_id: c.id, ok: false, error: (e as Error).message });
        }
      }
      return J({ ok: true, corridos, resultados });
    }

    if (accion === 'programar') {
      const { contact_id, texto, enviar_at, recurrencia, plantilla_id, variables, fin_at } = body;
      const rec = ['una_vez', 'diaria', 'semanal', 'mensual'].includes(recurrencia) ? recurrencia : 'una_vez';
      const usaPlantilla = !!plantilla_id;
      if (!contact_id || !enviar_at || (!usaPlantilla && (!texto || !String(texto).trim()))) return J({ error: 'faltan datos' }, 400);
      const cuando = new Date(enviar_at);
      if (isNaN(cuando.getTime())) return J({ error: 'fecha inválida' }, 400);
      if (cuando.getTime() < Date.now() - 60000) return J({ error: 'la fecha ya pasó' }, 400);
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      let textoFinal = String(texto || '').trim().slice(0, 4000);
      const vars: string[] = Array.isArray(variables) ? variables.map(String) : [];
      if (usaPlantilla) {
        const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', plantilla_id).maybeSingle();
        if (!p || p.tenant_id !== c.tenant_id) return J({ error: 'plantilla no válida para esta empresa' }, 400);
        if (p.estado !== 'aprobada') return J({ error: 'La plantilla todavía no está aprobada por Meta' }, 400);
        let render = p.texto; vars.forEach((v, i) => { render = render.replace(new RegExp('\\{\\{' + (i + 1) + '\\}\\}', 'g'), v); });
        textoFinal = render;
      } else if (rec !== 'una_vez') {
        return J({ error: 'Los mensajes recurrentes deben usar una plantilla aprobada por WhatsApp (los mensajes libres solo llegan si el cliente escribió en las últimas 24 h).' }, 400);
      }
      const finAt = fin_at ? new Date(fin_at) : null;
      const { data: ins } = await supa.from('scheduled_messages').insert({ tenant_id: c.tenant_id, contact_id: c.id, texto: textoFinal, enviar_at: cuando.toISOString(), recurrencia: rec, plantilla_id: usaPlantilla ? plantilla_id : null, variables: vars, fin_at: finAt && !isNaN(finAt.getTime()) ? finAt.toISOString() : null }).select('id').single();
      return J({ ok: true, id: ins?.id });
    }

    if (accion === 'cancelar_programado') {
      const { id } = body;
      if (!id) return J({ error: 'faltan datos' }, 400);
      const { data: s } = await supa.from('scheduled_messages').select('id, tenant_id').eq('id', id).maybeSingle();
      if (!s || (auth.tipo === 'cliente' && s.tenant_id !== auth.tenant_id)) return J({ error: 'no autorizado' }, 403);
      await supa.from('scheduled_messages').update({ estado: 'cancelado' }).eq('id', id).eq('estado', 'pendiente');
      return J({ ok: true });
    }

    if (accion === 'difusion') {
      const { contact_ids, texto, filename, mime, data_b64 } = body;
      const cap = String(texto || '').trim();
      if (!Array.isArray(contact_ids) || !contact_ids.length) return J({ error: 'faltan datos' }, 400);
      if (!cap && !data_b64) return J({ error: 'escribí un mensaje o adjuntá un archivo' }, 400);
      if (contact_ids.length > 50) return J({ error: 'máximo 50 contactos por difusión' }, 400);
      let bin: Uint8Array | null = null; let mm = ''; let kind = ''; let media_url: string | null = null;
      if (data_b64) {
        if (!filename || !mime) return J({ error: 'faltan datos del adjunto' }, 400);
        try { bin = Uint8Array.from(atob(String(data_b64)), (ch) => ch.charCodeAt(0)); } catch { return J({ error: 'archivo inválido' }, 400); }
        if (bin.length > 8 * 1024 * 1024) return J({ error: 'máximo 8 MB por archivo' }, 400);
        mm = String(mime).toLowerCase();
        kind = tipoMedia(mm);
        try {
          const path = `difusion/${Date.now()}_${String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`;
          const { error: se } = await supa.storage.from('panel-media').upload(path, bin, { contentType: mm });
          if (!se) media_url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/panel-media/${path}`;
        } catch (_) { }
      }
      let q = supa.from('contacts').select('id, whatsapp_id, tenant_id, fase_descubrimiento, bloqueado').in('id', contact_ids);
      if (auth.tipo === 'cliente') q = q.eq('tenant_id', auth.tenant_id);
      const { data: cs } = await q;
      const resultados: { id: string; ok: boolean; error?: string }[] = [];
      const tCache: Record<string, TenantCanal & { whatsapp_phone_number_id: string; whatsapp_access_token: string }> = {};
      const mediaIdCache: Record<string, string> = {};
      for (const c of (cs || [])) {
        if (c.bloqueado) { resultados.push({ id: c.id, ok: false, error: 'bloqueado' }); continue; }
        if (!tCache[c.tenant_id]) {
          const { data: t } = await supa.from('tenants').select('whatsapp_phone_number_id, whatsapp_access_token, channel_type, waha_base_url, waha_session, waha_api_key').eq('id', c.tenant_id).single();
          tCache[c.tenant_id] = t! as { whatsapp_phone_number_id: string; whatsapp_access_token: string };
        }
        const t = tCache[c.tenant_id];
        let r: { ok: boolean; detalle: Record<string, unknown> };
        if (esWaha(t as TenantCanal)) {
          // tenant WAHA: texto por WAHA; con adjunto, la URL pública del bucket
          r = bin && media_url
            ? await enviarMediaWaha(t as TenantCanal, c.whatsapp_id, kind, media_url, mm, String(filename), cap)
            : await enviarTextoWaha(t as TenantCanal, c.whatsapp_id, cap);
        } else if (bin) {
          if (!mediaIdCache[c.tenant_id]) {
            const up = await subirMediaAMeta(t, bin, mm, String(filename));
            if (!up.ok) { resultados.push({ id: c.id, ok: false, error: 'Meta rechazó el archivo' }); continue; }
            mediaIdCache[c.tenant_id] = up.id!;
          }
          r = await enviarMediaWhatsApp(t, c.whatsapp_id, kind, mediaIdCache[c.tenant_id], String(filename), cap);
        } else {
          r = await enviarWhatsApp(t, c.whatsapp_id, cap);
        }
        if (r.ok) {
          const etiqueta = bin ? etiquetaMedia(kind, String(filename)) : cap;
          await supa.from('messages').insert({ contact_id: c.id, tenant_id: c.tenant_id, role: 'assistant', content: bin && cap ? etiqueta + ' — ' + cap : etiqueta, message_type: bin ? kind : 'text', fase_en_momento: c.fase_descubrimiento, metadata: { humano: true, difusion: true, ...(bin ? { media_url, mime: mm, filename: String(filename), caption: cap || null } : {}) } });
          resultados.push({ id: c.id, ok: true });
        } else {
          const code = (r.detalle as { error?: { code?: number; message?: string } })?.error?.code;
          resultados.push({ id: c.id, ok: false, error: code === 131047 ? 'ventana 24h vencida' : ((r.detalle as { error?: { message?: string } })?.error?.message || 'error') });
        }
      }
      return J({ ok: true, resultados });
    }

    if (accion === 'procesar_programados') {
      if (auth.tipo !== 'admin') return J({ error: 'solo admin' }, 403);
      const { data: pend, error: rpcErr } = await supa.rpc('mensajes_programados_pendientes');
      if (rpcErr) return J({ error: rpcErr.message }, 500);
      let enviados = 0, errores = 0;
      const siguiente = (d: Date, rec: string) => { const n = new Date(d); if (rec === 'diaria') n.setDate(n.getDate() + 1); else if (rec === 'semanal') n.setDate(n.getDate() + 7); else if (rec === 'mensual') n.setMonth(n.getMonth() + 1); return n; };
      for (const s of (pend || [])) {
        const t = { whatsapp_phone_number_id: s.whatsapp_phone_number_id, whatsapp_access_token: s.whatsapp_access_token };
        let r: { ok: boolean; detalle: Record<string, unknown> };
        let contenido = s.texto;
        if (s.plantilla_id && s.plantilla_nombre) {
          const vars: string[] = Array.isArray(s.variables) ? s.variables.map(String) : [];
          const comps: Record<string, unknown>[] = [];
          if (vars.length) comps.push({ type: 'body', parameters: vars.map((v: string) => ({ type: 'text', text: v })) });
          const resp = await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_phone_number_id}/messages`, {
            method: 'POST', headers: { Authorization: `Bearer ${t.whatsapp_access_token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarAR(s.whatsapp_id), type: 'template', template: { name: s.plantilla_nombre, language: { code: s.plantilla_idioma || 'es_AR' }, ...(comps.length ? { components: comps } : {}) } })
          });
          const rj = await resp.json().catch(() => ({}));
          r = { ok: resp.ok, detalle: rj };
          let render = s.plantilla_texto || s.texto; vars.forEach((v, i) => { render = render.replace(new RegExp('\\{\\{' + (i + 1) + '\\}\\}', 'g'), v); });
          contenido = render;
        } else {
          r = await enviarWhatsApp(t, s.whatsapp_id, s.texto);
        }
        const rec = s.recurrencia || 'una_vez';
        if (r.ok) {
          await supa.from('messages').insert({ contact_id: s.contact_id, tenant_id: s.tenant_id, role: 'assistant', content: contenido, message_type: 'text', fase_en_momento: s.fase_descubrimiento, metadata: { humano: true, programado: true, ...(s.plantilla_nombre ? { plantilla: s.plantilla_nombre } : {}), ...(rec !== 'una_vez' ? { recurrente: rec } : {}) } });
          enviados++;
        } else {
          const code = (r.detalle as { error?: { code?: number } })?.error?.code;
          errores++;
          if (rec === 'una_vez') {
            await supa.from('scheduled_messages').update({ estado: 'error', error_detalle: code === 131047 ? 'ventana 24h vencida' : JSON.stringify((r.detalle as { error?: unknown })?.error || {}).slice(0, 300) }).eq('id', s.sched_id);
            continue;
          }
        }
        if (rec === 'una_vez') {
          await supa.from('scheduled_messages').update({ estado: 'enviado', veces_enviado: 1, ultimo_envio_at: new Date().toISOString() }).eq('id', s.sched_id);
        } else {
          const prox = siguiente(new Date(s.enviar_at), rec);
          const termina = s.fin_at && new Date(s.fin_at) < prox;
          await supa.from('scheduled_messages').update({
            enviar_at: prox.toISOString(), veces_enviado: (Number((s as { veces_enviado?: number }).veces_enviado) || 0) + 1, ultimo_envio_at: new Date().toISOString(),
            estado: termina ? 'enviado' : 'pendiente',
            error_detalle: r.ok ? null : ('último intento falló: ' + JSON.stringify((r.detalle as { error?: unknown })?.error || {}).slice(0, 200))
          }).eq('id', s.sched_id);
        }
      }
      return J({ ok: true, enviados, errores });
    }

    if (accion === 'importar') {
      const { contactos } = body;
      if (!Array.isArray(contactos) || !contactos.length) return J({ error: 'faltan datos' }, 400);
      if (contactos.length > 500) return J({ error: 'máximo 500 contactos por importación' }, 400);
      let tenantId = auth.tipo === 'cliente' ? auth.tenant_id : (body.tenant_id || null);
      if (!tenantId) {
        const { data: t } = await supa.from('tenants').select('id').eq('activo', true).limit(1).single();
        tenantId = t?.id;
      }
      if (!tenantId) return J({ error: 'sin tenant' }, 400);
      let creados = 0, existentes = 0, invalidos = 0;
      for (const it of contactos) {
        const tel = String(it.telefono || '').replace(/[^0-9]/g, '');
        const nombre = String(it.nombre || '').trim().slice(0, 120) || null;
        if (tel.length < 8 || tel.length > 15) { invalidos++; continue; }
        const { data: ya } = await supa.from('contacts').select('id, nombre').eq('whatsapp_id', tel).eq('tenant_id', tenantId).maybeSingle();
        if (ya) {
          existentes++;
          if (nombre && !ya.nombre) await supa.from('contacts').update({ nombre }).eq('id', ya.id);
          continue;
        }
        await supa.from('contacts').insert({ tenant_id: tenantId, whatsapp_id: tel, nombre, etapa: 'nuevo', fase_descubrimiento: 'rompimiento_hielo', origen: 'importado', cantidad_mensajes: 0, info_extraida: {} });
        creados++;
      }
      return J({ ok: true, creados, existentes, invalidos });
    }

    async function tenantWaba(tenantId: string) {
      const { data: t } = await supa.from('tenants').select('id, whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token').eq('id', tenantId).single();
      return t;
    }
    function tenantDe(bodyTenant: unknown): string | null {
      if (auth.tipo === 'cliente') return auth.tenant_id || null;
      return (bodyTenant as string) || null;
    }
    async function tenantPorDefecto(): Promise<string | null> {
      const { data: t } = await supa.from('tenants').select('id').eq('activo', true).order('created_at').limit(1).maybeSingle();
      return t?.id || null;
    }
    function componentesMeta(texto: string, footer: string, ejemplos: string[]) {
      const comps: Record<string, unknown>[] = [];
      const nVars = (texto.match(/\{\{\d+\}\}/g) || []).length;
      const bodyC: Record<string, unknown> = { type: 'BODY', text: texto };
      if (nVars > 0) bodyC.example = { body_text: [ejemplos.slice(0, nVars)] };
      comps.push(bodyC);
      if (footer) comps.push({ type: 'FOOTER', text: footer.slice(0, 60) });
      return comps;
    }
    async function crearEnMeta(t: { whatsapp_waba_id: string; whatsapp_access_token: string }, p: { nombre: string; categoria: string; idioma: string; texto: string; footer: string | null; ejemplos: string[] }) {
      const resp = await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_waba_id}/message_templates`, {
        method: 'POST', headers: { Authorization: `Bearer ${t.whatsapp_access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: p.nombre, category: p.categoria, language: p.idioma, allow_category_change: true, components: componentesMeta(p.texto, p.footer || '', p.ejemplos) })
      });
      const j = await resp.json().catch(() => ({}));
      return { ok: resp.ok && !!j.id, id: j.id as string | undefined, status: (j.status as string | undefined), detalle: j };
    }
    async function estadoEnMeta(t: { whatsapp_access_token: string }, metaId: string) {
      const resp = await fetch(`https://graph.facebook.com/v21.0/${metaId}?fields=status,rejected_reason,name,category`, { headers: { Authorization: `Bearer ${t.whatsapp_access_token}` } });
      const j = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: j.status as string | undefined, reason: j.rejected_reason as string | undefined, detalle: j };
    }
    const mapEstado = (s?: string) => !s ? 'pendiente' : s === 'APPROVED' ? 'aprobada' : s === 'REJECTED' ? 'rechazada' : (s === 'PAUSED' || s === 'DISABLED') ? 'rechazada' : 'pendiente';

    if (accion === 'plantillas_listar') {
      let q = supa.from('plantillas_wa').select('*').order('created_at', { ascending: false });
      const tid = tenantDe(body.tenant_id);
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q;
      if (error) return J({ error: error.message }, 500);
      return J({ ok: true, plantillas: data || [] });
    }

    if (accion === 'plantilla_crear') {
      const nombre = String(body.nombre || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 512);
      const texto = String(body.texto || '').trim().slice(0, 1024);
      const categoria = ['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(body.categoria) ? body.categoria : 'UTILITY';
      const idioma = String(body.idioma || 'es_AR');
      const footer = String(body.footer || '').trim() || null;
      const ejemplos = Array.isArray(body.ejemplos) ? body.ejemplos.map(String) : [];
      if (!nombre || !texto) return J({ error: 'nombre y texto requeridos' }, 400);
      let tid = tenantDe(body.tenant_id);
      if (!tid) tid = await tenantPorDefecto();
      if (!tid) return J({ error: 'sin empresa' }, 400);
      const { data: ins, error } = await supa.from('plantillas_wa').insert({ tenant_id: tid, nombre, categoria, idioma, texto, footer, ejemplos, estado: 'borrador' }).select('*').single();
      if (error) return J({ error: error.message.includes('duplicate') ? 'Ya existe una plantilla con ese nombre e idioma' : error.message }, 400);
      const t = await tenantWaba(tid);
      if (!t?.whatsapp_waba_id || !t?.whatsapp_access_token) return J({ ok: true, plantilla: ins, aviso: 'Guardada como borrador: esta empresa todavía no tiene WhatsApp conectado (falta WABA/token).' });
      const r = await crearEnMeta(t, { nombre, categoria, idioma, texto, footer, ejemplos });
      if (!r.ok) {
        const msg = (r.detalle as { error?: { error_user_msg?: string; message?: string } })?.error?.error_user_msg || (r.detalle as { error?: { message?: string } })?.error?.message || 'Meta rechazó la creación';
        await supa.from('plantillas_wa').update({ estado: 'rechazada', motivo_rechazo: String(msg).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', ins.id);
        return J({ error: msg, detalle: r.detalle }, 502);
      }
      await supa.from('plantillas_wa').update({ meta_template_id: r.id, estado: mapEstado(r.status), updated_at: new Date().toISOString() }).eq('id', ins.id);
      return J({ ok: true, plantilla: { ...ins, meta_template_id: r.id, estado: mapEstado(r.status) } });
    }

    if (accion === 'plantilla_enviar_meta') {
      const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', body.id).maybeSingle();
      if (!p || (auth.tipo === 'cliente' && p.tenant_id !== auth.tenant_id)) return J({ error: 'no autorizado' }, 403);
      const t = await tenantWaba(p.tenant_id);
      if (!t?.whatsapp_waba_id || !t?.whatsapp_access_token) return J({ error: 'Esta empresa no tiene WhatsApp conectado (falta WABA/token)' }, 400);
      const r = await crearEnMeta(t, { nombre: p.nombre, categoria: p.categoria, idioma: p.idioma, texto: p.texto, footer: p.footer, ejemplos: p.ejemplos || [] });
      if (!r.ok) {
        const msg = (r.detalle as { error?: { error_user_msg?: string; message?: string } })?.error?.error_user_msg || (r.detalle as { error?: { message?: string } })?.error?.message || 'Meta rechazó la creación';
        await supa.from('plantillas_wa').update({ estado: 'rechazada', motivo_rechazo: String(msg).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', p.id);
        return J({ error: msg }, 502);
      }
      await supa.from('plantillas_wa').update({ meta_template_id: r.id, estado: mapEstado(r.status), motivo_rechazo: null, updated_at: new Date().toISOString() }).eq('id', p.id);
      return J({ ok: true, estado: mapEstado(r.status) });
    }

    if (accion === 'plantilla_sync') {
      const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', body.id).maybeSingle();
      if (!p || (auth.tipo === 'cliente' && p.tenant_id !== auth.tenant_id)) return J({ error: 'no autorizado' }, 403);
      if (!p.meta_template_id) return J({ ok: true, estado: p.estado, aviso: 'Todavía no fue enviada a Meta' });
      const t = await tenantWaba(p.tenant_id);
      const r = await estadoEnMeta(t!, p.meta_template_id);
      if (!r.ok) return J({ error: 'No se pudo consultar a Meta', detalle: r.detalle }, 502);
      const est = mapEstado(r.status);
      await supa.from('plantillas_wa').update({ estado: est, motivo_rechazo: r.reason && r.reason !== 'NONE' ? r.reason : null, updated_at: new Date().toISOString() }).eq('id', p.id);
      return J({ ok: true, estado: est, motivo: r.reason });
    }

    if (accion === 'plantilla_eliminar') {
      const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', body.id).maybeSingle();
      if (!p || (auth.tipo === 'cliente' && p.tenant_id !== auth.tenant_id)) return J({ error: 'no autorizado' }, 403);
      if (p.meta_template_id) {
        const t = await tenantWaba(p.tenant_id);
        if (t?.whatsapp_waba_id) await fetch(`https://graph.facebook.com/v21.0/${t.whatsapp_waba_id}/message_templates?name=${encodeURIComponent(p.nombre)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t.whatsapp_access_token}` } }).catch(() => null);
      }
      await supa.from('plantillas_wa').delete().eq('id', p.id);
      return J({ ok: true });
    }

    if (accion === 'enviar_plantilla') {
      const { contact_id, plantilla_id, variables } = body;
      const c = await contactoAutorizado(auth, contact_id);
      if (!c) return J({ error: 'contacto no autorizado' }, 403);
      const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', plantilla_id).maybeSingle();
      if (!p || p.tenant_id !== c.tenant_id) return J({ error: 'plantilla no válida para esta empresa' }, 400);
      if (p.estado !== 'aprobada') return J({ error: 'La plantilla todavía no está aprobada por Meta' }, 400);
      const t = await tenantWaba(c.tenant_id);
      const vars = Array.isArray(variables) ? variables.map(String) : [];
      const comps: Record<string, unknown>[] = [];
      if (vars.length) comps.push({ type: 'body', parameters: vars.map(v => ({ type: 'text', text: v })) });
      const resp = await fetch(`https://graph.facebook.com/v21.0/${t!.whatsapp_phone_number_id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${t!.whatsapp_access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarAR(c.whatsapp_id), type: 'template', template: { name: p.nombre, language: { code: p.idioma }, ...(comps.length ? { components: comps } : {}) } })
      });
      const rj = await resp.json().catch(() => ({}));
      if (!resp.ok) return J({ error: (rj as { error?: { message?: string } })?.error?.message || 'Meta rechazó el envío', detalle: rj }, 502);
      let render = p.texto; vars.forEach((v, i) => { render = render.replace(new RegExp('\\{\\{' + (i + 1) + '\\}\\}', 'g'), v); });
      await supa.from('messages').insert({ contact_id: c.id, tenant_id: c.tenant_id, role: 'assistant', content: render, message_type: 'text', fase_en_momento: c.fase_descubrimiento, metadata: { humano: true, plantilla: p.nombre } });
      return J({ ok: true });
    }

    if (accion === 'difusion_plantilla') {
      const { contact_ids, plantilla_id, variables } = body;
      if (!Array.isArray(contact_ids) || !contact_ids.length || !plantilla_id) return J({ error: 'faltan datos' }, 400);
      if (contact_ids.length > 100) return J({ error: 'máximo 100 contactos por difusión con plantilla' }, 400);
      const { data: p } = await supa.from('plantillas_wa').select('*').eq('id', plantilla_id).maybeSingle();
      if (!p) return J({ error: 'plantilla inexistente' }, 400);
      if (auth.tipo === 'cliente' && p.tenant_id !== auth.tenant_id) return J({ error: 'no autorizado' }, 403);
      if (p.estado !== 'aprobada') return J({ error: 'La plantilla todavía no está aprobada por Meta' }, 400);
      const t = await tenantWaba(p.tenant_id);
      const varsBase: string[] = Array.isArray(variables) ? variables.map(String) : [];
      const { data: cs } = await supa.from('contacts').select('id, whatsapp_id, nombre, tenant_id, fase_descubrimiento, bloqueado').in('id', contact_ids).eq('tenant_id', p.tenant_id);
      const resultados: { id: string; ok: boolean; error?: string }[] = [];
      for (const c of (cs || [])) {
        if (c.bloqueado) { resultados.push({ id: c.id, ok: false, error: 'bloqueado' }); continue; }
        if (String(c.whatsapp_id).startsWith('ig_')) { resultados.push({ id: c.id, ok: false, error: 'contacto de Instagram (no WhatsApp)' }); continue; }
        const vars = varsBase.map((v, i) => (v === '{nombre}' || (i === 0 && !v)) ? (c.nombre || 'Hola') : v);
        const comps: Record<string, unknown>[] = [];
        if (vars.length) comps.push({ type: 'body', parameters: vars.map(v => ({ type: 'text', text: v })) });
        const resp = await fetch(`https://graph.facebook.com/v21.0/${t!.whatsapp_phone_number_id}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${t!.whatsapp_access_token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarAR(c.whatsapp_id), type: 'template', template: { name: p.nombre, language: { code: p.idioma }, ...(comps.length ? { components: comps } : {}) } })
        });
        const rj = await resp.json().catch(() => ({}));
        if (resp.ok) {
          let render = p.texto; vars.forEach((v, i) => { render = render.replace(new RegExp('\\{\\{' + (i + 1) + '\\}\\}', 'g'), v); });
          await supa.from('messages').insert({ contact_id: c.id, tenant_id: c.tenant_id, role: 'assistant', content: render, message_type: 'text', fase_en_momento: c.fase_descubrimiento, metadata: { humano: true, difusion: true, plantilla: p.nombre } });
          resultados.push({ id: c.id, ok: true });
        } else {
          resultados.push({ id: c.id, ok: false, error: (rj as { error?: { message?: string } })?.error?.message || 'error' });
        }
      }
      return J({ ok: true, resultados });
    }

    if (accion === 'plantillas_sync_todas') {
      if (auth.tipo !== 'admin') return J({ error: 'solo admin' }, 403);
      const { data: ps } = await supa.from('plantillas_wa').select('*').eq('estado', 'pendiente').not('meta_template_id', 'is', null).limit(50);
      let cambiadas = 0;
      for (const p of (ps || [])) {
        const t = await tenantWaba(p.tenant_id);
        if (!t?.whatsapp_access_token) continue;
        const r = await estadoEnMeta(t, p.meta_template_id);
        if (!r.ok) continue;
        const est = mapEstado(r.status);
        if (est !== p.estado) { cambiadas++; await supa.from('plantillas_wa').update({ estado: est, motivo_rechazo: r.reason && r.reason !== 'NONE' ? r.reason : null, updated_at: new Date().toISOString() }).eq('id', p.id); }
      }
      return J({ ok: true, revisadas: (ps || []).length, cambiadas });
    }

    return J({ error: 'accion desconocida' }, 400);
  }

  const auth = await resolverAuth(url, {});
  if (!auth) return J({ error: 'No autorizado' }, 401);

  const tenantFiltro = auth.tipo === 'cliente' ? auth.tenant_id : (url.searchParams.get('tenant_id') || null);

  let qc = supa.from('contacts').select('id, whatsapp_id, nombre, etapa, fase_descubrimiento, bloqueado, handoff_humano, modo_humano, gestion_humana, nota_interna, info_extraida, origen, tenant_id, created_at').order('created_at', { ascending: false }).limit(150);
  if (tenantFiltro) qc = qc.eq('tenant_id', tenantFiltro);
  const { data: contacts } = await qc;

  let qm = supa.from('messages').select('contact_id, role, content, message_type, metadata, created_at').order('created_at', { ascending: false }).limit(600);
  if (tenantFiltro) qm = qm.eq('tenant_id', tenantFiltro);
  const { data: msgs } = await qm;

  let qs = supa.from('scheduled_messages').select('id, contact_id, texto, enviar_at, estado, error_detalle, recurrencia, plantilla_id, veces_enviado').in('estado', ['pendiente', 'error']).order('enviar_at').limit(80);
  if (tenantFiltro) qs = qs.eq('tenant_id', tenantFiltro);
  const { data: sched } = await qs;

  const analisis: Record<string, unknown> = {};
  if (contacts && contacts.length) {
    const ids = contacts.map((c) => c.id);
    const { data: anas } = await supa.from('conversation_analysis')
      .select('contact_id, evaluado, nota, resumen, respondio_consultas, datos_correctos, avanzo_venta, banderas, escritura, hasta_msg_at, created_at')
      .in('contact_id', ids).order('created_at', { ascending: false }).limit(400);
    for (const a of (anas || [])) if (!analisis[a.contact_id]) analisis[a.contact_id] = a;
  }

  let tenants: unknown[] | undefined;
  if (auth.tipo === 'admin') {
    const { data: ts } = await supa.from('tenants').select('id, nombre, slug, activo').order('created_at');
    tenants = ts || [];
  }

  return J({ rol: auth.tipo, nombre: auth.nombre || null, contacts: contacts || [], messages: (msgs || []).reverse(), programados: sched || [], analisis, tenants });
});

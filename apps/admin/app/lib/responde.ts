import 'server-only';

// Token del panel de RESPONDE, para empotrar la app sin pedirle la clave a nadie.
//
// Quien ya entró a ODB como dueño no tiene por qué ver un segundo cartel de
// contraseña: el permiso ya lo dio el panel. Las credenciales del tenant viven
// en las variables del servicio (nunca en el código) y la sesión que devuelve
// RESPONDE dura 30 días, así que se reusa en lugar de crear una por visita.
const PANEL = 'https://smcghyecpzzimadtuern.supabase.co/functions/v1/panel-responde';

type Cache = { token: string; vence: number };
const g = globalThis as unknown as { __respondeTok?: Cache };

export async function tokenDelPanelResponde(): Promise<string | null> {
  if (g.__respondeTok && g.__respondeTok.vence > Date.now()) return g.__respondeTok.token;
  const email = process.env.RESPONDE_PANEL_EMAIL;
  const clave = process.env.RESPONDE_PANEL_CLAVE;
  if (!email || !clave) return null;
  try {
    const r = await fetch(PANEL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'login', email, password: clave }),
      cache: 'no-store',
    });
    const j = await r.json();
    if (!j?.ok || !j?.token) return null;
    g.__respondeTok = { token: j.token, vence: Date.now() + 20 * 24 * 60 * 60 * 1000 };
    return j.token;
  } catch {
    return null;
  }
}

// AVISOS EN ESTE APARATO (6/11/2026) — Web Push.
// En la computadora y en Android alcanza con tocar «Activar avisos». En el iPhone,
// primero hay que agregar el sistema a la pantalla de inicio (Compartir → Agregar a
// pantalla de inicio) y abrirlo desde ese ícono: en una pestaña de Safari los avisos
// no existen. El permiso se pide siempre desde un toque, nunca solo.

const RUTA = '/api/avisos-celular';
const CLAVE_APAGADOS = 'odb_avisos_apagados';

export type EstadoAvisos = 'activos' | 'apagados' | 'bloqueados' | 'instalar-iphone' | 'sin-soporte';
export type Aparato = { id: number; dispositivo: string | null; creada_en: string; ultimo_ok_en: string | null; endpoint: string };

export const esIPhone = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
export const instalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const soporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (esIPhone() && !instalada()) return 'instalar-iphone';
  if (!soporta()) return 'sin-soporte';
  if (Notification.permission === 'denied') return 'bloqueados';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activos' : 'apagados';
}

async function llamar(cuerpo: Record<string, unknown>) {
  const r = await fetch(RUTA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `No se pudo (${r.status})`);
  return j as { ok?: boolean; enviados?: number; aparatos?: number };
}

const bytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// El nombre del aparato, para reconocerlo en la lista («iPhone», «Mac · Chrome»).
export function nombreDelAparato(ua = navigator.userAgent): string {
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computadora';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return so === 'iPhone' || so === 'iPad' ? so : [so, nav].filter(Boolean).join(' · ');
}

async function registro() {
  // el mismo service worker que registra BannerInstalarApp (no cachea /api)
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
}

async function suscribir(reg: ServiceWorkerRegistration) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const r = await fetch(`${RUTA}?que=clave`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!j?.clave) throw new Error(j?.message || 'Los avisos al celular todavía no están configurados');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(j.clave) });
  }
  await llamar({ accion: 'suscribir', suscripcion: sub.toJSON(), dispositivo: nombreDelAparato() });
}

/** Pide el permiso (desde un toque), suscribe este aparato y lo guarda. */
export async function activarAvisos() {
  if (!soporta()) throw new Error('Este navegador no recibe avisos');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error(permiso === 'denied' ? 'Los avisos quedaron bloqueados en este navegador' : 'No se dio el permiso');
  const reg = await registro();
  await navigator.serviceWorker.ready;
  await suscribir(reg);
  try { localStorage.removeItem(CLAVE_APAGADOS); } catch { /* sin almacenamiento */ }
}

/** El endpoint de este aparato (para saber cuál de la lista es éste). */
export async function endpointDeEsteAparato(): Promise<string | null> {
  try { return (await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription())?.endpoint ?? null; }
  catch { return null; }
}

export async function desactivarAvisos() {
  try { localStorage.setItem(CLAVE_APAGADOS, '1'); } catch { /* sin almacenamiento */ }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await llamar({ accion: 'quitar', endpoint: sub.endpoint }).catch(() => null);
  await sub.unsubscribe();
}

/** Un aviso de prueba a todos mis aparatos. */
export const probarAvisos = () => llamar({ accion: 'probar' });

export async function misAparatos(): Promise<Aparato[]> {
  const r = await fetch(RUTA, { cache: 'no-store' });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('No pude traer tus aparatos');
  return j;
}

export const quitarAparato = (id: number) => llamar({ accion: 'quitar-aparato', id });

// Si el navegador renovó la suscripción (lo avisa sw.js), se guarda la nueva.
// Nunca pide permiso por su cuenta, y si la persona los apagó acá, no los prende.
export async function renovarAvisos() {
  try {
    if (!soporta() || Notification.permission !== 'granted') return;
    if (localStorage.getItem(CLAVE_APAGADOS) === '1') return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await suscribir(reg);
  } catch { /* nunca molesta */ }
}

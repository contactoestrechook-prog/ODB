// Service worker de O.D.B — modo contingencia de la caja.
//
// Historia obligatoria antes de tocar esto: una versión vieja hacía
// respondWith(fetch(...)) a secas y, cuando ese fetch fallaba (un corte, un
// redirect), tiraba abajo la página entera con "network error response". La
// reescritura se rige por una regla: NO llamar a respondWith salvo en los dos
// casos donde tener caché salva el negocio, y en esos dos casos el catch
// SIEMPRE devuelve algo. Todo lo demás pasa de largo y lo resuelve el
// navegador como si este archivo no existiera.
//
// Caso 1 — navegaciones (abrir /caja con el internet cortado): red primero;
//   si la red falla, la última copia buena de esa página. Así un F5 durante un
//   corte no deja a la cajera mirando un dinosaurio: la caja abre, el catálogo
//   sale del disco (localStorage) y las ventas van a la cola offline que ya
//   existe.
// Caso 2 — /_next/static/ (los archivos con hash en el nombre): son
//   inmutables por diseño, caché primero es correcto y más rápido.
//
// /api/ NO se toca JAMÁS: si el service worker le contestara caché a
// /api/venta, la cola offline creería que la venta se envió. Ese error sería
// invisible y carísimo.
const VERSION = 'odb-3';
const CACHE = 'odb-cache-3';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // sagrado: la cola depende de que la red falle de verdad

  // archivos con hash: inmutables, caché primero
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) => hit ?? fetch(req).then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        }).catch(() => Response.error()),
      ),
    );
    return;
  }

  // navegaciones: red primero, caché solo cuando la red falla
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        // solo se guarda una respuesta final y sana: cachear un redirect a
        // /login dejaría la pantalla de login como "versión offline" de /caja
        if (res.ok && !res.redirected) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copia)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(url.pathname).then((hit) => hit
          ?? new Response(
            '<meta charset="utf-8"><body style="font-family:system-ui;background:#F0EBE2;display:grid;place-items:center;min-height:100vh"><div style="max-width:420px;text-align:center"><h2>Sin conexión</h2><p>Esta pantalla todavía no tiene copia local. Cuando vuelva el internet, recargá.</p></div>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )),
      ),
    );
  }
});

self.addEventListener('message', (e) => {
  if (e.data === 'odb-version' && e.ports && e.ports[0]) e.ports[0].postMessage({ odbVersion: VERSION });
});

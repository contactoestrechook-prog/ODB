// Service worker mínimo de O.D.B. Existe por una sola razón: Chrome y Edge no
// ofrecen "Instalar app" si el sitio no tiene uno con manejador de fetch.
// A propósito NO cachea nada: deja pasar todo a la red tal cual. Un cache mal
// hecho sirve pantallas viejas (precios, stock) y eso es peor que no tener app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  // passthrough explícito: el navegador necesita ver el handler para considerar
  // instalable el sitio, pero la respuesta es exactamente la de la red.
  e.respondWith(fetch(e.request));
});

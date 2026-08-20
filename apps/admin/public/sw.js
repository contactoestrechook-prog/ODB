// Service worker mínimo de O.D.B. Existe por una sola razón: que el navegador
// ofrezca "Instalar app". NO intercepta ninguna petición: el manejador de fetch
// está vacío A PROPÓSITO, así el navegador resuelve todo por su cuenta.
// (La versión anterior hacía respondWith(fetch(...)) y cuando ese fetch fallaba
// —un corte breve, un redirect— tiraba abajo la página entera con
// "network error response": visto en producción en /compras.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* vacío a propósito: cero intercepción */ });

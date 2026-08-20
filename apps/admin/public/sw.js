// Service worker mínimo de O.D.B. Existe por una sola razón: que el navegador
// ofrezca "Instalar app". NO intercepta ninguna petición: el manejador de fetch
// está vacío A PROPÓSITO, así el navegador resuelve todo por su cuenta.
// (La versión anterior hacía respondWith(fetch(...)) y cuando ese fetch fallaba
// —un corte breve, un redirect— tiraba abajo la página entera con
// "network error response": visto en producción en /compras.)
// La versión la pregunta la página al arrancar: si el service worker que está
// controlando no contesta (porque es uno viejo, sin este manejador), la página
// lo desinstala y se recarga. Sin esto, un navegador con el viejo instalado se
// queda con él para siempre y sigue viendo la página rota.
const VERSION = 'odb-2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* vacío a propósito: cero intercepción */ });
self.addEventListener('message', (e) => {
  if (e.data === 'odb-version' && e.ports && e.ports[0]) e.ports[0].postMessage({ odbVersion: VERSION });
});

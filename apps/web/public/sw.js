// Service worker mínimo de la tienda. Existe solo para que el navegador ofrezca
// "instalar la app". No cachea nada ni intercepta pedidos: el del panel cuenta
// por qué un respondWith mal puesto tira la página abajo, y la tienda no
// necesita modo sin conexión.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // sin respondWith: lo resuelve el navegador

# panel-responde v16 — envío por WAHA para tenants WAHA

**Qué arregla:** la función `panel-responde` (la que usa la app de RESPONDE en Netlify)
solo sabía enviar por Meta (`graph.facebook.com`). Para los tenants con `channel_type='waha'`
(CarCash, CarCash Home, Verko, y ahora ODB) lo que se escribe desde la app **no salía**.
Verificado en la base: 0 mensajes "humano" enviados desde el panel en 30 días para
CarCash y Verko; 8 para MetoGroup (Meta).

**Qué cambia (77 líneas, ver `v15-a-v16.patch`):**
- Helpers `esWaha`, `chatIdWaha` (respeta `@lid`), `wahaPost`, `enviarTextoWaha`, `enviarMediaWaha`
  (mismo camino que `wsp-send.js` del CRM de CarCash, con los mismos reintentos de audio/video).
- `enviar`: si el tenant es WAHA → `POST {waha_base_url}/api/sendText`. Si es Meta → igual que antes.
- `enviar_media`: WAHA baja el archivo desde el bucket `panel-media` (URL pública). Meta igual que antes.
- `difusion` (texto libre y adjuntos): por WAHA cuando el tenant es WAHA. Meta igual que antes.
- **No se toca**: login, bot, nota, analizar, programar, plantillas, importar, procesar_programados.

**Cómo deployar con seguridad (2 minutos):**
1. Supabase → proyecto RESPONDE (`smcghyecpzzimadtuern`) → Edge Functions → `panel-responde` → Deploy new version.
2. Pegar el contenido de `panel-responde.index.ts` como `index.ts`. `verify_jwt` = OFF (como está hoy).
3. Probar desde la app de RESPONDE con un contacto de **ODB** (tenant nuevo, sin riesgo para CarCash):
   escribirle un texto → tiene que llegar al WhatsApp del contacto.
4. Si algo falla: volver a la versión anterior desde el mismo panel (v15). El original está en
   `panel-responde.v15.original.ts`.

Sintaxis validada con esbuild. No se pudo correr `deno check` localmente (sin Deno instalado).

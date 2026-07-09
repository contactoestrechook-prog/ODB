# Bots de WhatsApp de ODB (n8n)

Dos líneas de WhatsApp con **el cerebro server-side** (alta capacidad de
razonamiento): el agente corre en nuestra API con Claude Opus 4.8, razonamiento
adaptativo, loop de herramientas y memoria por teléfono. **n8n es solo el caño**:
recibe el WhatsApp, llama a `/bot/charla`, manda la respuesta.

```
WhatsApp Business Cloud API ──► n8n (3 nodos) ──► POST /bot/charla ──► Opus 4.8
        (Meta)                   tus credenciales      x-api-key        + herramientas
                                                                        + memoria
```

## El agente: POST /bot/charla (RECOMENDADO — un solo endpoint)

n8n manda cada mensaje entrante acá y responde con lo que devuelve:

```json
// request
{ "linea": "pedidos" | "proveedores", "telefono": "54911...",
  "mensaje": "hola, tenés coca?",
  "archivoBase64": "...opcional (foto/PDF de factura, línea proveedores)",
  "mimeType": "image/jpeg" }
// response
{ "respuesta": "¡Hola! Tengo Coca 1.75L a $4300..." }
```

- **Memoria por conversación** (tabla `bot_conversaciones`, últimos 24 turnos):
  el bot recuerda qué venía pidiendo el cliente entre mensajes.
- **Nunca inventa**: precios y stock salen de las herramientas contra la base
  real; si no hay stock lo dice y ofrece alternativas reales.
- **Cierra la venta solo**: arma el pedido en la charla, pide retiro/envío y lo
  carga al pipeline con código de retiro (verificado E2E en 3 turnos).
- Línea proveedores: si viene `archivoBase64`, la factura se procesa ANTES de
  invocar al modelo (extracción + cola `recepciones_bot`) y el agente redacta
  la confirmación. El base64 nunca pasa por el modelo.
- Timeouts: una respuesta con razonamiento + herramientas tarda 5–30 s. En el
  nodo HTTP Request de n8n poné timeout 120000 ms.

### Sommelier incorporado

El bot de pedidos es también el sommelier de la casa: la herramienta
`consultar_cava` filtra las ~1500 etiquetas reales con stock por tipo
(tinto/blanco/rosado/espumante), cepa y presupuesto, y el agente recomienda
con conocimiento genuino de bodegas y maridajes (verificado E2E: regalo con
presupuesto, pivot a espumantes, maridaje de mariscos con aviso de última
botella). El conocimiento de vinos viene del modelo; la cava, los precios y
las promos vienen de la base — no puede inventar etiquetas. Para ajustar el
estilo del sommelier, editar la sección "SOS TAMBIÉN EL SOMMELIER" en
`apps/api/src/bot/agente-bot.ts`.

### Robustez incorporada (tanda de endurecimiento)

- **Cola por teléfono**: los mensajes de un mismo número se procesan en orden
  aunque lleguen en ráfaga (no se pisan la memoria).
- **Idempotencia**: mandá `mensajeId` (el `messages[0].id` de Meta) y los
  reintentos de webhook devuelven la misma respuesta sin reprocesar ni gastar
  tokens (tabla `bot_mensajes`).
- **Límite por teléfono**: `ODB_BOT_MENSAJES_HORA` (default 30) mensajes/hora;
  al superarlo responde un texto fijo de derivación a humano sin llamar a Opus.
- **Tope de pedido por bot**: `ODB_BOT_MAX_RENGLONES` (15) y
  `ODB_BOT_MAX_UNIDADES` (60); lo que supere se deriva a un humano (evita
  reservas de stock maliciosas).
- **Costo visible**: cada conversación acumula sus tokens en
  `bot_conversaciones.tokens` (+ log por mensaje).
- Los workflows de n8n ya mandan `mensajeId` y usan la BOT_API_KEY fuerte
  (rotada; el mismo valor tiene que estar en el env del API en producción).

## Endpoints de herramientas (los usa el agente por dentro; también servibles a mano)

Todas bajo `/bot/*`, autenticadas con el header **`x-api-key: <BOT_API_KEY>`**
(server-to-server; configurar `BOT_API_KEY` en el `.env` del API). Base URL de
producción: `https://odb-api-production.up.railway.app`.

### Línea 1 — PEDIDOS (cliente)
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/bot/pedidos/cliente` | `{telefono}` → identifica al cliente (nombre, tipo, si es mayorista, cta cte) |
| GET | `/bot/pedidos/buscar?q=` | busca en el catálogo real → precio minorista/mayorista, **stock por sucursal**, si es alcohol, disponible sí/no |
| POST | `/bot/pedidos/crear` | `{telefono, nombre?, tipo:'pickup'\|'domicilio', items:[{sku,cantidad}], direccion?}` → crea el pedido (entra al mismo pipeline que web/app), devuelve total, código de retiro y resumen |
| GET | `/bot/pedidos/:id` | estado del pedido |

### Línea 2 — PROVEEDORES
| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/bot/proveedores/factura` | `{telefono?, archivoBase64, mimeType}` → la IA lee la factura (proveedor por CUIT, renglones, IVA, percepciones) y la deja en la **cola de revisión** (`recepciones_bot`); devuelve un resumen y un mensaje listo para responderle al proveedor |

> **Regla de oro:** el bot de proveedores **NO mueve stock**. Solo extrae y encola.
> Un humano confirma en el panel (Compras) y recién ahí entra la mercadería.
> Mover stock automático desde una foto de WhatsApp es demasiado riesgoso.

## Estado del setup en n8n (creados por API el 2026-07-05)

En `https://n8n-production-8ffb6.up.railway.app` ya existen (inactivos hasta
cargar credenciales):

- **ODB · Bot Pedidos (WhatsApp)** — Trigger → filtro texto → /bot/charla → responder
- **ODB · Bot Proveedores (WhatsApp)** — Trigger → ¿archivo? → (baja media de Meta → /bot/charla con base64) ó (texto → /bot/charla) → responder
- **ODB · Aviso pedido listo (WhatsApp)** — Webhook `POST /webhook/odb-pedido-listo` → WhatsApp al cliente
  → poner en el `.env` del API: `N8N_PEDIDOS_WEBHOOK_URL=https://n8n-production-8ffb6.up.railway.app/webhook/odb-pedido-listo`

Falta (manual, con credenciales de Meta):
1. En n8n crear las credenciales **WhatsApp Trigger API** (app secret + verify token)
   y **WhatsApp API** (access token) y seleccionarlas en los nodos de cada workflow.
2. Reemplazar `REEMPLAZAR_PHONE_NUMBER_ID_*` por el phone number id de cada línea.
3. Activar los 3 workflows.
4. Deploy del API con el módulo bot + `BOT_API_KEY` en el env de producción
   (los workflows apuntan a `https://odb-api-production.up.railway.app`).

## Setup en n8n (3 nodos por línea — el cerebro ya no vive acá)

Para cada línea, un workflow mínimo:

1. **WhatsApp Trigger** (nodo WhatsApp Business Cloud de n8n): mensaje entrante
   del número de la línea.
2. **HTTP Request** → `POST {API_BASE}/bot/charla`, header `x-api-key`,
   timeout 120000 ms, body:
   ```json
   { "linea": "pedidos",
     "telefono": "{{ $json.messages[0].from }}",
     "mensaje": "{{ $json.messages[0].text.body }}" }
   ```
   (línea proveedores: si el mensaje trae media, bajar el archivo del endpoint
   de media de Meta y mandarlo como `archivoBase64` + `mimeType`.)
3. **WhatsApp Send**: responder al mismo número con `{{ $json.respuesta }}`.

Credenciales/valores que necesitás cargar en n8n:
- WhatsApp Business Cloud API: token + **phone number id de cada línea** (2).
- `BOT_API_KEY` (la misma del `.env` del API) y la base URL del API.
- (La `ANTHROPIC_API_KEY` vive en el API, no en n8n.)

Los system prompts y las herramientas del agente viven en
`apps/api/src/bot/agente-bot.ts` (editá ahí para ajustar tono o reglas).

## Notificación saliente "pedido listo" (LISTO) ✅

Cuando el depósito avanza el pedido a **listo / en_camino / entregado**, la API
dispara un webhook a n8n para que mande el WhatsApp al cliente (fire-and-forget:
si n8n no responde, no rompe el cambio de estado). Configurar en el `.env`:

- `N8N_PEDIDOS_WEBHOOK_URL` — la URL del webhook de n8n que recibe el aviso.
- `N8N_WEBHOOK_TOKEN` (opcional) — se manda como header `x-webhook-token` para
  que n8n valide el origen.

Payload que recibe n8n:
```json
{
  "pedidoId": "...", "estado": "listo", "telefono": "1166667777",
  "nombre": "Ana", "total": 4300, "codigoRetiro": "PICKUP-1I7DJZ",
  "canal": "pickup", "resumen": "1x Coca Cola 1.75l",
  "mensaje": "¡Tu pedido de O.D.B está LISTO para retirar! 🎉 Código: ..."
}
```
En n8n: **Webhook Trigger** → (opcional validar token) → **WhatsApp Send** con
una *plantilla aprobada* (los mensajes iniciados por el negocio requieren
template aprobado por Meta) usando `telefono` y `mensaje`.

## Pendiente (Fase 2)
- Pantalla en el panel (Compras) para revisar/confirmar la cola `recepciones_bot`
  con un clic → dispara la entrada directa (stock + factura con impuestos).
- Link de pago de Mercado Pago en el mensaje del bot para pedidos con envío.

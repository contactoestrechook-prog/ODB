# Patrón MetoGroup · WhatsApp ⇄ sistema

Cómo conectamos un número de WhatsApp a un sistema nuestro. Salió del circuito de
CarCash, se generalizó con ODB, y de acá en adelante es el estándar: **un cliente
nuevo se conecta siguiendo este documento, sin inventar nada.**

## La regla que ordena todo

**El sistema nunca habla con WhatsApp. Habla con el puente.**

El puente es **WAHA**, una instancia propia (en Railway) que maneja la sesión de
WhatsApp del negocio. **No pasa por Meta**: no hay plantillas, ni ventana de 24
horas, ni `phone_number_id`. Se vincula escaneando el QR con el teléfono, igual
que WhatsApp Web.

El sistema del cliente solo conoce dos contratos HTTP. Si mañana se cambia de
transporte, se cambia el puente y ningún sistema se entera.

> El camino por Meta (`graph.facebook.com` vía n8n) es el **viejo**, y queda como
> respaldo. Todo lo nuevo sale por WAHA.

```
Cliente en WhatsApp
        │
        ▼
   Meta / WhatsApp
        │
        ▼
     WAHA  ──── ①  POST /bot/charla ────►  SISTEMA
   (instancia propia)                      (bot + bandeja)
        ▲                                     │
        └──── ②  POST /api/sendText ◄─────────┘
        │
        ▼
Cliente en WhatsApp
```

---

## ① ENTRANTE · lo que el puente le manda al sistema

```
POST {API}/bot/charla
x-api-key: {BOT_API_KEY}
Content-Type: application/json
```

```json
{
  "numeroLinea": "5491122812200",
  "telefono": "5491133344455",
  "mensaje": "Hola, ¿tienen fernet?",
  "mensajeId": "wamid.HBgLNTQ5..."
}
```

| Campo | ¿Obligatorio? | Detalle |
|---|---|---|
| `telefono` | **sí** | Quien escribe, E.164 sin `+`. |
| `mensaje` | **sí** | Texto. Si el cliente mandó un audio, el puente lo transcribe **antes** y manda el texto. |
| `numeroLinea` | recomendado | Número del negocio al que llegó. El sistema resuelve solo de qué línea es. Sin esto hay que mandar `linea`. |
| `mensajeId` | **muy recomendado** | Id del mensaje de WhatsApp. Es lo que evita contestar dos veces si el puente reintenta. |
| `linea` | alternativa | `pedidos` o `proveedores`, si no se manda `numeroLinea`. |

**Respuestas:**

- `{"respuesta": "…"}` → el texto que hay que mandarle al cliente.
- `{"respuesta": null, "derivada": true}` → **no contestar nada.** La conversación
  está en manos de una persona; el mensaje ya quedó guardado en el hilo.
- Un `mensajeId` repetido devuelve la misma respuesta sin volver a procesar.

> El puente **no decide** si contestar. Si viene `respuesta`, la manda; si viene
> `null`, se calla. Toda la lógica de negocio vive en el sistema.

---

## ② SALIENTE · lo que el sistema le manda al puente

Cuando una persona contesta desde la bandeja, o cuando el sistema avisa algo:

```
POST {WAHA_URL}/api/sendText
X-Api-Key: {WAHA_API_KEY}
Content-Type: application/json
```

```json
{ "session": "default", "chatId": "5491133344455@c.us", "text": "Hola…" }
```

**El `chatId` es lo que más se rompe:** es `<dígitos>@c.us`. Pero los contactos
con el número oculto por privacidad llegan como `<id>@lid` y hay que devolverlos
**tal cual**, sin reconstruirlos, o el mensaje no encuentra al destinatario.

Otros endpoints: `/api/sendImage` (con `file.url` y `caption`), `/api/sendVoice`
para notas de voz, `/api/sendVideo` y `/api/sendFile` como respaldo.

**WhatsApp solo reproduce notas de voz en OGG/Opus.** Si WAHA rechaza el audio
(típico de un WebM de Android), se reintenta con `sendFile`: llega peor, pero
llega. Y si no vuelve un id de mensaje, se reporta como falla — sin id no hay
prueba de que haya salido.

### Camino viejo (respaldo, por Meta)

```
POST {N8N_WSP_SEND_URL}
X-MetoGroup-Secret: {N8N_WEBHOOK_TOKEN}
Content-Type: application/json
```

```json
{
  "to": "5491133344455",
  "type": "text",
  "text": "Hola, ya te lo preparamos. ¿Pasás hoy?",
  "audio_url": null,
  "kind": null,
  "referencia": "pedidos/5491133344455",
  "source": "odb"
}
```

| Campo | Detalle |
|---|---|
| `type` | `text` o `audio`. |
| `audio_url` | Si es audio, link público descargable y `text` en `null`. |
| `kind` | `aviso-interno` cuando el destinatario es **un empleado**, no un cliente. Sirve para rutearlo distinto. |
| `referencia` | De qué conversación salió, para poder loguearlo. |
| `source` | Qué sistema lo mandó (`odb`, `carcash`, …). |

El puente responde `200` si despachó. Cualquier otra cosa se le muestra a la
persona que escribió, para que reintente. **El mensaje se guarda en el hilo antes
de despachar**, así nunca se pierde lo que se quiso decir.

---

## Lo que el sistema tiene que tener resuelto

Esto no es opcional: es lo que separa un bot de juguete de uno que atiende clientes.

1. **Interruptor por conversación.** Cuando interviene una persona, el bot se
   calla en ese chat. Sin esto, el bot le pisa la respuesta al empleado delante
   del cliente.
2. **Derivación real.** "Te derivo al equipo" tiene que *hacer* algo: marcar la
   conversación, apagar el bot y avisarle a alguien. Una derivación que solo se
   dice es una mentira al cliente.
3. **Idempotencia por id de mensaje.** Los puentes reintentan. Sin dedup, el
   cliente recibe todo dos veces.
4. **El modelo no hace cuentas ni calcula horarios.** Los totales y los horarios
   salen de herramientas del sistema. Un peso mal sumado llega a la caja; un
   horario mal calculado deja a alguien en la puerta de un local cerrado.
5. **Tope de tamaño.** Un pedido gigante por WhatsApp reserva stock sin pagar: por
   encima del tope, lo toma una persona.

---

## Puesta en marcha de un número nuevo

1. Registrar el número en `lineas_whatsapp` (número legible, E.164 y qué línea atiende).
2. Cargar en el sistema: `BOT_API_KEY`, `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`,
   y los teléfonos del equipo que reciben los avisos internos.
3. Vincular la sesión de WAHA escaneando el QR con el teléfono del negocio.
4. En WAHA: configurar el webhook de mensajes entrantes para que postee a
   `/bot/charla` con la API key.
5. **Probar con un número de prueba, nunca con la línea real.**
6. Recién ahí apuntar el número productivo.

**Antes de anunciar la integración, los dos secretos tienen que estar cargados en
las dos puntas al mismo tiempo.** Un endpoint sin secreto acepta mensajes de
cualquiera que conozca la URL.

---

## Estado por cliente

| | CarCash | ODB |
|---|---|---|
| Bandeja | CRM propio | Panel ODB (Clientes → RESPONDE) |
| Cerebro | AI Agent dentro de n8n | En el servidor (`/bot/charla`) |
| Catálogo del bot | Planilla de Google ⚠️ | Stock real del sistema |
| Derivación a persona | Sí | Sí |
| Transporte | WAHA propio | WAHA propio |
| Número | de la agencia | **11 2281-2200** |

> ⚠️ En CarCash el bot ofrece autos desde una planilla, no desde el stock del CRM:
> puede ofrecer algo ya vendido. Conviene apuntarlo a la vista `web_catalog` que
> ya usa la web pública.

## Deuda conocida del patrón

- **CarCash arrancó sin secreto compartido**: el endpoint aceptaba mensajes de
  cualquiera que supiera la URL. En ODB nace cerrado (falla si falta la API key).
- **El puente de n8n de MetoGroup viene con 32,9% de ejecuciones fallidas**
  (992 de 3.017). Antes de sumarle carga a un número nuevo, hay que mirar qué falla.
- **En el n8n de MetoGroup todavía viven flujos de RESPONDE que despachan por Meta**
  (`graph.facebook.com`). Es el camino viejo. Conviene migrarlos a WAHA para que
  haya un solo transporte y no dos comportamientos distintos según el flujo.

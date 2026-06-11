# ODB — Arquitectura técnica

## Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Base de datos | **PostgreSQL (Supabase)** | Una sola fuente de verdad; Supabase suma auth, realtime (estado de pedidos en vivo), storage (PDFs de remitos/listas) y row-level security. |
| Backend | **NestJS (Node/TypeScript)** | API REST + workers (jobs de clasificación RFM, sugerencias de compra, sync Tienda Nube). |
| Panel admin | **Next.js + React** | Compras, stock, estadísticas, aprobaciones. |
| POS | **Web app local-first** (React + SQLite/IndexedDB + cola de sync) | La caja vende sin internet; sincroniza al volver. |
| App cliente | **Expo / React Native** | Cámara (escaneo), GPS (pick-up), push, iOS + Android de un solo código. |
| Frontend tienda | Theme custom de **Tienda Nube** (o headless contra su API) | El checkout y los pagos los resuelve Tienda Nube. |

## Integraciones

| Servicio | Uso | Mecanismo |
|---|---|---|
| **Tienda Nube** | E-commerce | API REST: push de productos/precios/stock; webhooks de pedidos (`order/created`, `order/paid`) → reserva de stock. |
| **Mercado Pago** | Cobros en app, QR en caja, Point | Checkout API + notificaciones IPN/webhook. |
| **ARCA** | Facturación electrónica | WSFE vía SDK (afipsdk / TusFacturas). Certificado digital por CUIT, punto de venta por sucursal. Contingencia: CAEA o cola de facturación. |
| **WhatsApp Business Cloud API** | Pedidos y notificaciones | Plantillas aprobadas para transaccionales; catálogo de WhatsApp sincronizado. |
| **Didit** | Verificación biométrica DNI + rostro contra RENAPER | SDK en la app; ODB persiste solo `verificacion_id` + resultado. Gratis ≤500/mes, luego ~USD 0,30. Futuro: convenio directo RENAPER (SID) si el volumen lo justifica. |
| **Claude API** | Parseo de listas de precios (PDF/Excel) y remitos | Extracción estructurada → pantalla de revisión humana antes de impactar. |

## Decisiones clave

1. **El sistema es la fuente de verdad** de catálogo, precios y stock. Tienda Nube y WhatsApp son espejos.
2. **Stock solo por movimientos**: la cantidad nunca se edita directo; siempre hay un movimiento tipado con referencia y usuario. Esto hace el stock auditable y reconstruible.
3. **POS offline-first**: catálogo replicado localmente, ventas en cola con UUID generado en el cliente (idempotencia en el sync), facturación en contingencia.
4. **Biometría delegada**: los datos sensibles viven en Didit/RENAPER; ODB guarda el veredicto. Menos riesgo legal y de seguridad.
5. **IA con revisión humana**: el parseo de PDFs propone, una persona confirma. Nada impacta stock ni precios sin un click humano.
6. **Pedidos unificados**: web, WhatsApp, pick-up y self-checkout entran al mismo pipeline (`pedidos`) y al cobrarse generan una `venta` con su comprobante ARCA.

## Diagrama de contexto

```
                    ┌─────────────┐
   Tienda Nube ◄───►│             │◄───► Mercado Pago
   (webhooks)       │   API NestJS │◄───► ARCA (WSFE)
   WhatsApp    ◄───►│  + workers   │◄───► Didit (RENAPER)
                    │             │◄───► Claude API (PDFs)
                    └──────┬──────┘
                           │ PostgreSQL (Supabase)
        ┌──────────┬───────┴────────┬─────────────┐
        ▼          ▼                ▼             ▼
   Panel admin   POS caja      App cliente   Pantalla depósito
   (Next.js)   (offline-first)   (Expo)      (preparación pick-up)
```

## Escala (objetivo: 4.000+ usuarios)

**Lo que ya está implementado en el código:**

| Medida | Detalle |
|---|---|
| Paginación server-side | El navegador/celular nunca recibe más de una página (50-200 ítems) aunque el catálogo tenga 13.000 |
| Caché de catálogo (30 s) | El catálogo es igual para todos: las consultas repetidas no tocan la base. Medido: de ~150 req/s a decenas de miles |
| Caché de estadísticas (60 s) | El tablero recorre ~20k filas; se calcula 1 vez por minuto como máximo |
| Rate limiting | 300 req/min por IP global; 8/min para el Somelier (cada consulta de IA cuesta plata) |
| Compresión gzip | Respuestas JSON ~5× más chicas |
| Imágenes por CDN | Las fotos salen del Storage de Supabase, no pasan por la API |
| Búsqueda indexada | pg_trgm sobre nombre: la búsqueda difusa usa índice, no escanea la tabla |

**Para pasar a producción (decisiones de despliegue, no de código):**

1. **API**: hoy corre en la Mac de desarrollo. Desplegar en Railway/Fly.io (región Sudamérica) — es stateless, escala horizontal agregando instancias. Los cachés en memoria pasan a Redis si hay más de una instancia.
2. **Panel admin**: Vercel (Next.js nativo).
3. **App cliente**: builds con EAS → App Store / Play Store.
4. **Base**: Supabase Pro ya corre en sa-east-1; el compute se sube desde el dashboard cuando las métricas lo pidan (4.000 usuarios entran cómodos en un compute chico: el grueso del tráfico lo absorbe el caché del catálogo).
5. **Pendiente de seguridad**: cuentas reales de cliente en la app (hoy el DNI identifica sin clave — se resuelve junto con la biometría Didit), y reemplazar las políticas RLS "lectura dev" por políticas por rol cuando haya auth de Supabase.

## Migración inicial

El catálogo sale de un Excel → `scripts/importar-excel/` (mapeo de columnas configurable, validación de duplicados de código de barras, reporte de filas rechazadas). Se corre primero en seco (`--dry-run`), se revisa el reporte y recién después se inserta.

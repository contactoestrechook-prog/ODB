# Correcciones del bot comercial ODB

21 de septiembre de 2026. **Publicadas y verificadas en producción.** Migración aplicada en Supabase ODB; API y panel activos con estado SUCCESS. No se modificó el catálogo ni se enviaron mensajes reales de prueba. Registro: [publicacion-2026-09-21.json](publicacion-2026-09-21.json).

Comprobación adicional en la base real: creación, reserva e idempotencia dentro de una transacción revertida. Cero cotizaciones de prueba persistidas. Búsqueda nueva HTTP 200, falta de confirmación HTTP 400, adjuntos sin sesión HTTP 401 y acceso al panel HTTP 200.

## Comportamiento

- Instrucciones comerciales breves: responder la consulta concreta, como máximo una pregunta útil, sin narrar fotos ni explicar el razonamiento.
- Falta un dato: consulta interna persistida y silencio al cliente hasta la respuesta del área. Se adjunta el archivo a la consulta cuando está disponible. No se pide a una reformulación sin herramientas que simule una consulta.
- Packs, artículos individuales y kg tienen metadatos compartidos en búsqueda, alternativas y cava. Los nombres ambiguos requieren verificación; no se deduce automáticamente el contenido. Se conservan cantidades y precios decimales.
- Los SKU repetidos se suman antes de comprobar stock. Precio según cliente, sucursal de preparación y subtotales salen de herramientas.
- Antes de confirmar se guarda un resumen exacto. Crear usa esa cotización; no acepta renglones del modelo. Requiere confirmación del cliente y coincidencia con el resumen efectivamente presentado.
- La transacción SQL comprueba de nuevo propietario del chat, vigencia, productos, presentación, precio y stock. Pedido, renglones y reserva se confirman juntos; un fallo revierte la operación. Repetir la misma cotización devuelve el mismo pedido.
- Los links usan el importe y referencia del pedido propio pendiente, nunca un monto libre. El checkout conserva cantidades por peso mediante importes por renglón.
- Administración, compras y reparto se reconocen por sus números configurados. Una cita desconocida no cae en otra consulta; con varios pendientes se exige referencia.
- Las respuestas del área no vuelven a entrar al agente ni ejecutan herramientas. Sólo se cierra una entrega confirmada. Un resultado de transporte incierto requiere revisión antes de repetir. Consultas y pagos reservan atómicamente su notificación.
- Las consultas nuevas tienen seguimiento cada cinco minutos, reintentos sólo cuando se sabe que no se envió y alertas de demora. Las históricas no se reenvían automáticamente.
- Los nuevos adjuntos recibidos y enviados desde el teléfono se archivan en bucket privado, con acceso firmado de una hora. El panel ODB renueva enlaces mediante la sesión autenticada. No se cambia el bucket público compartido ni se retiran archivos históricos.
- Eliminada la espera artificial de escritura por defecto; queda configurable hasta dos segundos.

## Cobertura de los hallazgos

| Hallazgo original | Control y evidencia de regresión |
|---|---|
| A01 negativa aceptada | Confirmación inequívoca en servicio y SQL; pruebas de negativas y modificaciones. |
| A02 pedido distinto al resumen | Cotización persistida y coincidencia exacta; la creación no usa items del modelo. |
| A03 stock de SKU duplicado | Agrupación antes de cotizar; 6 + 6 con stock 10 se rechaza. |
| A04 x6 ambiguo | Presentación común para búsqueda/cava/alternativas; x6 requiere verificar y x500ml no se confunde. |
| A05 consulta cerrada sin envío | Cierre posterior al transporte confirmado; fallo deja pendiente. |
| A06 remitentes de áreas | Validación por destino real configurado. |
| A07 peso truncado | 0,5 kg se conserva en creación y checkout. |
| A08 precio inventado tras foto | Control final de importes después de las reformulaciones. |
| A09 decimal interpretado parcialmente | Análisis de cantidad completa. |
| A10 silencio oculta pedido creado | Confirmación determinista de operación prevalece sobre consulta pendiente. |
| A11 cita vieja aplicada a otra consulta | Coincidencia exacta, paginación sin ventana de antigüedad. |
| A12 promesa sin consulta | Registro real y silencio en el control final. |
| A13 monto libre de pago | Link vinculado al pedido del cliente, importe obtenido del servidor. |
| A14 pago elegido por recencia | Referencia inequívoca; no elegir el más reciente entre varios. |

## Verificación ejecutada

- API: `npm run build` aprobado.
- API: `npm test -- --runInBand`: **43 suites, 572 pruebas aprobadas**, incluidas 48 regresiones nuevas en `comercio-seguro.spec.ts`.
- Panel: `npx tsc --noEmit --incremental false` aprobado; sintaxis del JavaScript embebido comprobada; `git diff --check` sin errores.
- Migración ejecutada dos veces en PostgreSQL WASM aislado (PGlite). Se probó idempotencia de pedido, aislamiento por chat, negativas, rollback por precio/stock, cambio de presentación, fracciones y reservas exclusivas de avisos. Usa fixtures y la función registrar_movimiento del SQL exportado; el cálculo de precio se simula para probar propagación del segmento, no certifica las listas comerciales reales.
- Modelo real con herramientas simuladas, sin base ni WhatsApp: dato desconocido → consulta y silencio; stock puntual → una frase; 18 botellas en packs de 6 → 3 packs, $18.000. Resultado en `evaluacion-corregida-2026-09-21.jsonl`.
- Las reproducciones de `auditar-flujos-bot.cjs` y el informe original se conservan como evidencia histórica anterior, no como pruebas de aceptación actuales.

No se hizo un envío real extremo a extremo, un pago real, una reserva real ni una evaluación con fotos reales autorizadas de múltiples SKU. Las pruebas de fotos verifican los controles con modelo simulado. No se promete una mejora porcentual ni ausencia absoluta de errores.

## Secuencia de activación y comprobaciones

Pasos 1–3 completados para el API y panel ODB. Se confirmó backup automático disponible de aproximadamente nueve horas antes y compatibilidad del esquema. Las validaciones con números propios, fotos reales y la conciliación de datos históricos siguen pendientes; no se hicieron envíos de prueba a personas.

1. Confirmar respaldo recuperable y comprobar en un entorno de prueba el esquema vigente: clientes.mayorista, pedidos.notas, pedidos.entrega_fecha, pedidos.entrega_franja, precio_vigente de seis argumentos y registrar_movimiento. El esquema exportado histórico no contiene todos los campos que usa el backend actual.
2. Aplicar `db/migracion-bot-atencion-segura.sql` antes de desplegar el API nuevo. Es aditiva y transaccional. No ejecutar el backend nuevo contra una base sin esta migración: fallará de forma cerrada al cotizar/confirmar.
3. Desplegar API y panel ODB juntos. La renovación de adjuntos se integra en el panel local; otras instalaciones externas de RESPONDE necesitan el equivalente autenticado. Los enlaces iniciales expiran al cabo de una hora.
4. Validar en números de prueba propios: foto, pack, kg, cambio de cantidad, confirmación, reintento, pausa humana, respuesta citada y fallo de transporte. No usar clientes reales para esta comprobación.
5. Conciliar por separado los 45 pendientes históricos observados (4 con respuesta guardada), los 88 productos con stock negativo y el artículo sin precio. Revisar los 1.233 candidatos de presentación con información del local: no representan errores confirmados. No inventar valores ni aplicar correcciones masivas.
6. Revisar acceso/migración de archivos históricos del bucket público con las referencias del monitor; no cambiar permisos globales a ciegas.

Para volver atrás, revertir el despliegue del API/panel conservando tablas, cotizaciones y trazas. No borrar registros de operaciones ni reejecutar avisos con entrega incierta. Los códigos nuevos de pedido tienen 12 caracteres y los parsers del bot se ajustaron a esa longitud.

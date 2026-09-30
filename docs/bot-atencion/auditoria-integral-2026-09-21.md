# Auditoría funcional integral del bot comercial ODB

> Informe histórico previo a las correcciones. Estado posterior y verificación: [correcciones-2026-09-21.md](correcciones-2026-09-21.md).

Fecha: 21 de septiembre de 2026. **Resultado: no aprobar la publicación de la versión local en su estado actual.** La mejora requiere controles transaccionales y seguimiento de consultas, además del estilo de respuesta.

## Alcance y método

Se revisó el circuito de entrada WhatsApp, texto, fotos, audio, PDF y video; historial, instrucciones y reformulaciones; catálogo y cava; presentación y cantidades; cotización, stock, creación y cancelación de pedidos; links y confirmaciones de pago; consultas al equipo, retorno al cliente, pausas, reintentos y alertas. Se revisaron también las correcciones locales del turno anterior.

Evidencia utilizada:

- Código local de BotService, instrucciones, normalizadores, controladores, PedidosService, catálogo y creación de links de Mercado Pago.
- Lectura paginada de los 10.578 artículos activos y precios actuales en la base conectada al proyecto; configuración de sucursales, consultas pendientes y carácter público del bucket de adjuntos.
- Muestra de 120 conversaciones de la línea pedidos y 868 respuestas almacenadas. Se excluyen los números de prueba reconocidos; la muestra puede incluir equipo y proveedores y no es un historial completo de cada conversación.
- 14 reproducciones adversariales con BD, modelo y envíos simulados. No se crearon pedidos reales, no se emitieron links reales, no se modificaron datos comerciales y no se contactó a clientes ni al equipo.
- Ejecución de las 42 suites existentes: **524 pruebas aprobadas**. Compilación Nest aprobada.

La auditoría no certifica todos los posibles diálogos. No se hizo un envío real extremo a extremo ni se verificó qué revisión exacta del código ejecuta el despliegue remoto. Las reproducciones prueban fallas de los controles cuando reciben determinados resultados del modelo; no demuestran que cada falla haya ocurrido con un cliente real. Las consultas pendientes pueden haber sido atendidas manualmente sin cerrar su registro.

## Hallazgos reproducidos

P1: corregir antes de publicar por riesgo de operación incorrecta, importe incorrecto o pérdida de atención. P2: corregir para que la atención sea consistente. P3: caso de menor impacto.

| ID | Prioridad | Resultado comprobado | Corrección necesaria |
|---|---|---|---|
| A01 | P1 | «No confirmo» pasa el control y llega a crear_pedido. La excepción de la expresión regular de negación permite la palabra confirmo aunque esté negada. | La negación debe prevalecer. Verificar afirmación sobre un resumen concreto, sin aceptar una palabra aislada dentro de una negativa. |
| A02 | P1 | Un resumen de 1 botella permite enviar 40 a la creación. Se valida que el SKU haya sido visto, no que cantidad, producto y total coincidan con el resumen. | Persistir una cotización identificada e inmutable; crear desde esa cotización, no desde una lista libre del modelo. Si cambia, recotizar y pedir aceptación. |
| A03 | P2 | Con stock 10, dos renglones de 6 del mismo SKU devuelven hayFaltantes=false. | Agrupar SKU repetidos antes de validar stock y calcular; conservar trazabilidad con el pedido del cliente. |
| A04 | P2 | «Agua mineral 1.5L x6» con unidades_pack=1 no se marca ambiguo; el detector exige sufijos como un o palabras como pack. | No convertir falta de detección en presentación verificada. Separar unidad de venta, contenido y evidencia de validación. |
| A05 | P1 | Si enviarPorWhatsapp devuelve enviado=false, la consulta igualmente recibe respondido_en. | Cerrar solo tras envío confirmado; conservar estado listo para enviar y reintentar de forma idempotente. |
| A06 | P2 | Una respuesta del teléfono configurado para reparto, distinto de administración, no entra al retorno de consultas. | Reconocer remitentes autorizados por área y vincularlos con la consulta exacta. En la configuración leída no hay destinos distintos: el defecto se activa al configurarlos. |
| A07 | P1 | 0,5 kg llega a crearDesdeApp y se transforma en cantidad 0 mediante Math.floor. | Respetar decimales para productos vendidos por peso; validar enteros para los demás. Usar las mismas unidades en cotización, creación y cobro. |
| A08 | P1 | La reformulación de una foto puede producir «Cuesta $999.999» sin dato de herramienta; sale al cliente porque se ejecuta después del control de importes. | Toda reformulación debe pasar un único control final de hechos, importes y acciones. No basta con indicarle al modelo que conserve los datos. |
| A09 | P3 | El texto «1,5 unidades» se interpreta como 5 unidades por la expresión regular. | Analizar cantidades completas con límites que contemplen coma y punto; si la presentación no admite fracciones, rechazarlas con el motivo correcto. |
| A10 | P1 | Cuando el mismo turno crea un pedido y consulta otro dato, el silencio suprime también el código del pedido ya creado. | Separar confirmación de acciones ejecutadas de consultas pendientes. El silencio aplica al dato desconocido, no debe ocultar una transacción. |
| A11 | P1 | Una respuesta que cita un aviso viejo no encontrado se aplica a otra consulta reciente si solo hay una en la lista. | Si hay cita, resolver esa referencia exacta o pedir aclaración; nunca caer en otra consulta. Buscar por ID antes de aplicar ventanas temporales. |
| A12 | P1 | «No tengo ese dato» se reformula a «Lo consulto y te confirmo por acá» sin crear ninguna consulta. El método regenerar no ofrece herramientas. | Separar decisión de consultar de redacción. Ejecutar la consulta con seguimiento antes de terminar el turno; una instrucción en una reformulación sin herramientas no ejecuta acciones. |
| A13 | P1 | Un contexto con total $18.000 permite enviar $1 al generador de links. El servidor solo controla monto positivo. | Generar el link a partir del pedido autorizado y su total guardado; vincular external_reference al pedido. |
| A14 | P1 | Con dos pagos pendientes, «recibido» sin cita confirma uno automáticamente. | Exigir referencia inequívoca cuando haya más de un pendiente; no elegir por recencia. |

### Ubicaciones de código

- A01–A02: [confirmación y SKU](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1548).
- A03: [stock por renglón](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:2094).
- A04: [presentación ambigua](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1756).
- A05: [cierre posterior al envío](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:2877).
- A06 y A11: [retorno de consultas](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:2764).
- A07: [redondeo al crear](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.service.ts:332).
- A08: [reformulación de fotos](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1349).
- A09: [cantidades individuales](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:2032).
- A10: [silencio del turno](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1368).
- A12: [reformulación sin herramientas](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1481).
- A13: [monto de link libre](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:1673).
- A14: [selección por recencia](/Users/leandroalonso/Projects/odb/apps/api/src/bot/bot.service.ts:2812).

A04, A08, A09 y A10 corresponden a defectos de los cambios locales recientes. No estaban cubiertos por las pruebas añadidas entonces. Los demás se encontraron en rutas preexistentes. Es necesario corregir ambos grupos.

## Datos y operación actual

### Consultas sin cierre

En la base figuran 53 consultas fuera del banco de pruebas: **45 pendientes, 29 de más de 24 horas** y 4 con respuesta de administración pero sin cierre. El retorno consulta solamente las últimas 10 pendientes creadas en 24 horas. Una respuesta citada puede quedar fuera de esa selección aunque el equipo finalmente la atienda.

Además, el nuevo silencio termina guardando esperando_desde=null, mientras el recordatorio existente trabaja sobre ese campo. No hay un seguimiento específico de bot_consultas_internas en los crons revisados. Guardar silencio exige una cola durable con responsable, estado, reintentos y escalamiento; registrar la consulta por sí solo no garantiza su resolución.

### Presentaciones y stock

- 10.578 artículos activos; 18 con unidades_pack mayor que uno.
- 1.233 candidatos a revisión usando un filtro más amplio de nombres. El conteo anterior de 607 era de un filtro más estrecho. **No son 1.233 errores confirmados.** Un envase de seis alfajores puede ser una unidad de venta perfectamente válida; el dato que falta es su contenido y si se puede fraccionar.
- 9 artículos marcados vendidos por peso: afectados por la incompatibilidad de cantidades fraccionarias del canal.
- 88 artículos tienen stock negativo en al menos una sucursal. Es un dato a conciliar; no demuestra por sí solo un error del bot.
- 1 artículo tiene stock total positivo pero no precio final positivo.
- 12 precios contienen decimales; el bot redondea precios y renglones a enteros mientras calcula subtotales con centavos. Puede mostrar cifras que no explican exactamente el total.

El listado de candidatos queda en [presentaciones-a-revisar.json](/Users/leandroalonso/Projects/odb/docs/bot-atencion/presentaciones-a-revisar.json). No se modificó el catálogo.

### Precio mayorista y cava

La RPC real catalogo_precios devuelve producto_id, precio_lista, precio_final, descuento_nombre y descuento_comunidad. **No devuelve precio_mayorista**, aunque el bot intenta leer ese campo. Tampoco pasa p_segmento al cotizar. Por lo tanto, el indicador mayorista del cliente no produce por esa ruta la diferenciación que las instrucciones prometen. Se debe resolver el precio por segmento con el mismo mecanismo del pedido y comprobarlo con datos comerciales aprobados.

La cava sigue devolviendo precio y stock sin la nueva información de presentación. Un mismo producto puede llegar al modelo con distinto nivel de información según use buscar_productos o consultar_cava. Las dos herramientas deben compartir un contrato de producto.

### Adjuntos y privacidad

Los adjuntos entrantes se suben al bucket publico y se generan URLs públicas. La configuración leída confirma public=true. Ese flujo incluye fotos, PDFs y comprobantes. Los archivos quedan accesibles mediante su enlace. Revisar acceso privado y URLs temporales, sin romper la visualización del equipo. No se descargaron documentos de clientes para esta comprobación ni se cambiaron permisos.

### Calidad de respuesta y tiempo

En las 868 respuestas de la muestra: 5 superan 600 caracteres, 1 supera 1.000, 38 contienen las fórmulas de consulta buscadas y 1 contiene narración visual detectada por el filtro. Estas métricas no miden si cada respuesta fue útil ni cubren todo el histórico. La mayoría de las molestias puede venir de preguntas innecesarias, promesas o turnos repetidos aunque cada mensaje sea corto.

Persisten instrucciones opuestas: responder en silencio frente a fórmulas antiguas de espera; no asumir variantes frente a regeneraciones que ordenan escoger «lo más común»; texto sin asteriscos frente al formateador que añade negrita; responder el dato frente a una bienvenida obligatoria. El servicio tiene múltiples reformulaciones, algunas sin herramientas y otras posteriores a validaciones. Cambiar solo el prompt no resuelve ese orden de ejecución.

El envío agrega de 2 a 8 segundos de demora artificial por simular escritura, además de las llamadas al modelo y herramientas. No se midió latencia real extremo a extremo en clientes.

## Qué quedó comprobado y qué falta

Las pruebas existentes cubren mecanismos útiles: autenticación del bot, aislamiento de pedidos por cliente en herramientas de consulta/cancelación, pausas para atención humana y numerosos casos de formato. Todas pasan. Sin embargo, las 14 reproducciones demuestran que su cobertura no alcanza para aceptar la versión.

La evaluación previa de tres casos con el modelo real utiliza herramientas simuladas y no reproduce el circuito completo de aplicación, transporte y cobros. No valida estos 14 riesgos. Tampoco se ha hecho una evaluación visual con fotos reales autorizadas de varios artículos ni una prueba de entrega efectiva de la respuesta de administración.

No se probaron escrituras contra la base real ni se verificó en vivo la versión desplegada de funciones SQL que mutan pedidos. La lectura del SQL exportado aporta contexto, pero no se presenta como prueba de ejecución actual.

## Orden de corrección y criterios de aceptación

1. **Pedido y pago:** cotización persistida, aceptación inequívoca y total/cantidades derivados del mismo registro. Negativas y modificaciones deben impedir la creación. El link debe coincidir con ese pedido.
2. **Atención pendiente:** correlación exacta de consultas y pagos; estados pendiente/respondida/lista para enviar/enviada; cierre solo tras entrega confirmada, reintentos y alerta por demora. Ninguna respuesta vieja puede ir a otro cliente.
3. **Producto:** contrato común para catálogo y cava, contenido del envase verificado, unidad de venta y cantidades por peso; agrupación de SKU; precio por segmento consistente y centavos conservados.
4. **Respuesta:** un único paso final de validación después de cualquier reformulación. Separar decisiones de acciones de la redacción; fotos sin narración y consultas sin mensajes de espera, preservando confirmaciones de operaciones hechas.
5. **Validación antes de publicar:** convertir cada reproducción en una prueba que exija el comportamiento correcto, sumar conversaciones de varios turnos, fotos y fallos de transporte; después comprobar un circuito real controlado con destinatarios autorizados.

No se hizo una nueva publicación ni se corrigieron los hallazgos durante esta auditoría. Se generaron evidencias y scripts para que la corrección sea verificable.

## Evidencia reproducible

- [14 reproducciones y resultados](/Users/leandroalonso/Projects/odb/docs/bot-atencion/auditoria-reproducciones-2026-09-21.json).
- [Datos agregados de catálogo y consultas](/Users/leandroalonso/Projects/odb/docs/bot-atencion/auditoria-datos-2026-09-21.json).
- [Muestra de conversaciones, sin contenido personal](/Users/leandroalonso/Projects/odb/docs/bot-atencion/auditoria-conversaciones-2026-09-21.json).
- [Script de reproducción sin servicios reales](/Users/leandroalonso/Projects/odb/apps/api/scripts/auditar-flujos-bot.cjs).
- [Script de auditoría de datos, solo lectura](/Users/leandroalonso/Projects/odb/apps/api/scripts/auditar-datos-bot.cjs).

Ejecutar desde apps/api: npm run build y node scripts/auditar-flujos-bot.cjs. El script marca reproducido=true cuando detecta el defecto: **no es una suite que certifique corrección**, y su salida exitosa no significa que el bot sea seguro. Para el inventario, node --env-file=.env scripts/auditar-datos-bot.cjs usa las credenciales locales sin imprimirlas.

# Auditoría integral ODB — 21 de septiembre de 2026

**Dictamen: el sistema funciona, pero no está listo para ampliar su autonomía sin corregir controles de acceso y operaciones financieras.** El razonamiento comercial resolvió packs, kilos y recibos en los casos controlados, pero también produjo una afirmación comercial no verificada ante una imagen. Los riesgos más graves están en permisos de base de datos, separación entre usuarios y operaciones que pueden quedar incompletas o duplicarse.

Se inventariaron **381 rutas en 52 controladores**. Pasaron **572 pruebas existentes en 43 suites**. Se reprodujeron **24 escenarios de fallo adicionales**, aislando base de datos, pagos y mensajería. Se ejecutó el modelo real sobre **3 facturas sintéticas y 6 situaciones comerciales**, dos de ellas con imagen de recibo y otra con una ilustración de dos botellas. API, panel y tienda compilan; la app móvil pasa TypeScript y exportación web.

Esto es una auditoría técnica con evidencia y cobertura declarada, no una certificación de ausencia de otros fallos. No se hicieron cobros, pedidos, aprobaciones, envíos de WhatsApp, emisiones fiscales ni cambios de configuración en producción. Las consultas a datos reales fueron de lectura. Los cambios locales de esta auditoría son scripts y documentación; los cambios del bot anteriores ya estaban presentes y se preservaron.

## Prioridades

1. **Inmediata:** cerrar ejecución pública de funciones internas de Supabase, especialmente las que cambian saldos y aprueban cobros. Revisar conjuntamente `anon` y `authenticated`, más los permisos por defecto de futuras migraciones.
2. **Antes de ampliar operación:** separar usuarios y revocar sesiones, hacer atómicas las rendiciones/aprobaciones/rechazos, corregir Compra Fácil por peso, pago y emisión ARCA.
3. **Antes de más autonomía IA:** garantizar que una alerta exista y tenga destinatario, impedir acciones después de escalar, conservar datos desconocidos y recuperar trabajos interrumpidos.
4. **Actualización técnica:** resolver dependencias vulnerables, empezando por Next.js y procesadores de archivos. No aplicar automáticamente downgrades sugeridos por `npm audit`.

## Evidencia y alcance

| Área | Qué se comprobó | Límite de la comprobación |
|---|---|---|
| Autenticación, usuarios y permisos | Inventario de decoradores, guard, login/registro, revocación, pruebas de cruce de usuarios | Sesiones simuladas; no se crearon cuentas reales |
| Supabase | Permisos y cuerpos de funciones críticas vigentes; buckets; tablas sin RLS accesibles a anon | No se ejecutaron funciones mutantes expuestas |
| Catálogo, stock, precios, fraccionamiento | Rutas, validaciones, RPC, tests existentes, conteos reales, navegación tienda/app | Los 10.578 artículos activos no se cotejaron individualmente con mercadería física |
| Bot comercial y asistente tienda | Prompt, herramientas, reglas, tests, modelo real con datos controlados | La evaluación del modelo usa herramientas simuladas; no prueba entrega WhatsApp de extremo a extremo |
| Compras, facturas, remitos | Lectura, normalización, bultos/peso, persistencia, estados, permisos | Tres PDFs limpios; no equivalen a precisión sobre fotos borrosas/manuscritos de proveedores |
| Cobros, recibos y cuenta corriente | Aprobación, original adjunto, folio/saldos, permisos, funciones SQL | Sin aprobar ni generar recibos de cobros reales |
| Caja, ventas y devoluciones | Propietario de caja, autorizaciones, RPC y escrituras posteriores, tests | Sin arqueo ni venta real; NC/reintegros externos sin ejecución |
| Repartos y cheques | Permisos, transiciones, rendición, doble ejecución y fallos de escritura | Casos con repositorios simulados; no se confirmó un incidente histórico |
| Mercado Pago y Compra Fácil | Firmas/configuración, importes, reintentos, atribución y kilos | Servicios externos simulados en pruebas de pago; ningún dinero movido |
| ARCA y contabilidad | Cola, numeración multiempresa, guardado CAE, cálculo y reportes | Sin emisión fiscal; concurrencia real del proveedor no ejercitada |
| Fidelización y notificaciones | Uso de identidad autenticada, canjes, push, errores y cambio de cuenta | Sin canjear puntos ni enviar push real |
| Eventos, promociones, listas, mensajes, informes, sincronización | Rutas/roles y lectura selectiva de orquestación, cálculos, errores, cruces de IDs | Cobertura estructural; no cada combinación de pantalla/datos ni envíos externos |
| Panel, tienda y app | Builds, tienda viva: buscar→ficha→carrito→checkout; app exportada: inicio y catálogo real | No sesión UI por cada rol; sin teléfono físico, cámara, GPS, biometría, push ni modo avión nativos |
| Dependencias | `npm audit --omit=dev` en los cuatro proyectos, contraste de avisos Next con el mantenedor | Versiones afectadas confirmadas; explotación no intentada |

Los 38 endpoints marcados `Publico` incluyen catálogo y webhooks deliberadamente públicos. No se consideró defecto toda ruta pública ni toda ruta sin decorador de rol: se inspeccionaron controles manuales. Tampoco se consideró exposición pública una tabla sin RLS si `anon` no tiene permisos.

## Hallazgos prioritarios con reproducción

**F01 — Crítico: funciones financieras accesibles como anon en la base activa.**
La consulta a `pg_proc`/`has_function_privilege` encontró 18 funciones `SECURITY DEFINER` ejecutables por `anon`. Dos cuerpos inspeccionados, `aprobar_cobranza` y `sumar_saldo_cta_cte`, no autentican actor ni rol. La segunda permite sumar un importe al saldo del cliente indicado; la primera aplica una cobranza pendiente. Con identificadores válidos se salta el control del backend. No se necesita concluir que las 18 son vulnerables: algunas son lecturas o triggers. No se ejecutó ninguna mutación para demostrarlo. Evidencia: [seguridad-base-vigente.json](/Users/leandroalonso/Projects/odb/docs/auditoria-integral-2026-09-21/seguridad-base-vigente.json). Corregir grants y defaults, permitir funciones internas solo al servicio y probar denegación directa tanto con anon como con sesión de cliente. Revisar auditoría histórica antes de concluir que hubo o no abuso.

**F02 — Alta: dependencias de producción con avisos de seguridad.**
`npm audit` reporta API: 6 paquetes afectados (4 altos); panel: 5 (1 crítico); tienda: 5 (1 crítico); mobile: 27 (12 altos). Son paquetes del árbol, no ese número de vulnerabilidades independientes ni explotaciones confirmadas. Next 16.2.9 cae en el rango del aviso crítico de optimización AVIF; la tienda permite cualquier hostname HTTPS en `images.remotePatterns`. El mantenedor documenta corrección de ese aviso en 16.3.3; el registro propone 16.3.5 para el conjunto. Ver [aviso oficial AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) y [aviso oficial middleware](https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24). No todos los avisos aplican al hosting/configuración de ODB. API también tiene avisos en Sharp, SheetJS y dependencias de Nest. Revisar compatibilidad, limitar fuentes de imágenes y repetir pruebas después de actualizar. Evidencia: `dependencias-*.json`.

**F03 — Alta: desactivar o bajar el rol de un usuario no invalida su token.**
`auth/auth.guard.ts` valida firma y usa el rol guardado en JWT, sin consultar usuario vigente ni versión de sesión. Duración configurada: 24 horas. S01 reproduce aceptación de un token anterior a la desactivación. La obligación de cambiar clave temporal se aplica en el panel mediante cookie, no como restricción del token en toda la API. Corregir revocación/versionado de sesión y restricciones de clave temporal en backend. Probar desactivación y reducción de rol con un token ya emitido.

**F04 — Alta: registro puede apropiarse de una ficha comercial preexistente.**
[clientes-auth/clientes-auth.service.ts:61](/Users/leandroalonso/Projects/odb/apps/api/src/clientes-auth/clientes-auth.service.ts:61) crea usuario con `email_confirm: true` y vincula cliente por email; el registro por DNI tiene un patrón semejante. Si una ficha existe pero su cuenta de autenticación todavía no fue registrada, conocer ese dato permite intentar registrarla sin probar propiedad. S13 reproduce la vinculación y modificación del nombre. No implica que se pueda sobrescribir la contraseña de una cuenta Supabase ya registrada. Exigir verificación de propiedad antes de vincular datos históricos y beneficios.

**F05 — Alta: cliente puede consultar una lectura interna de factura por ID.**
[compras/compras.controller.ts:52](/Users/leandroalonso/Projects/odb/apps/api/src/compras/compras.controller.ts:52) no exige rol para `GET /compras/entrada-foto/:id`; [listas/listas.service.ts:444](/Users/leandroalonso/Projects/odb/apps/api/src/listas/listas.service.ts:444) tampoco comprueba propietario. S02 pasa el guard como cliente y recupera el resultado de otro usuario. Restringir roles y aplicar el mismo alcance por propietario en estado, original, relectura y marcado que en la bandeja.

**F06 — Alta: movimiento en caja de otro empleado.**
[caja/caja.service.ts:58](/Users/leandroalonso/Projects/odb/apps/api/src/caja/caja.service.ts:58) comprueba que la caja exista y esté abierta, pero no que corresponda al actor. S03 registra un egreso en la caja B con empleado A. Exigir propietario o privilegio explícito de supervisión y auditar la excepción. El permiso a ver otras cajas puede ser política comercial; el permiso a escribir debe ser explícito.

**F07 — Alta: repartidor puede operar reparto o pedido ajeno.**
Los controladores pasan IDs sin actor/asignación a varios métodos. [pedidos.service.ts:365](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.service.ts:365) actualiza ubicación por pedido; [repartos.service.ts:100](/Users/leandroalonso/Projects/odb/apps/api/src/repartos/repartos.service.ts:100) cambia parada y acepta cobro negativo. S04 y S14 lo reproducen. El listado y detalle de repartos tampoco separan por repartidor. Restringir por asignación, validar estados y montos, y exigir supervisión para reasignar.

**F08 — Alta: doble rendición duplica deuda/cobros.**
[repartos.service.ts:111](/Users/leandroalonso/Projects/odb/apps/api/src/repartos/repartos.service.ts:111) permite `rendido → armado → rendido`; dos solicitudes simultáneas también pasan la lectura del estado previo. S05 y S06 producen dos asientos de deuda; S06 además dos cobros. `aplicarRendicion` escribe varias tablas sin una transacción y omite errores devueltos por Supabase. Resolver en RPC con bloqueo, transición válida e idempotencia; ante cualquier error no declarar rendición exitosa.

**F09 — Alta: se puede rechazar una OP ya pagada.**
[compras.service.ts:1438](/Users/leandroalonso/Projects/odb/apps/api/src/compras/compras.service.ts:1438) cambia estado y reabre facturas sin validar/bloquear estado previo. S07 reproduce aceptación de OP pagada. Rechazar debe ser una transición atómica desde estados admitidos; una reversión de pago requiere otro circuito y trazabilidad.

**F10 — Alta: guardar factura no garantiza coherencia fiscal ni trazabilidad de pago.**
[compras.service.ts:675](/Users/leandroalonso/Projects/odb/apps/api/src/compras/compras.service.ts:675) acepta total 100 con neto 1.000 e IVA 210 y permite `pagada:true` sin documento de pago. S08 reproduce ambos. No se propone prohibir carga histórica: debe ser un flujo identificado, con permiso y justificativo, separado del pago operativo. Validar valores finitos, identidad fiscal acorde al tipo/régimen y cantidad positiva. S15 demuestra que cantidad 0 termina guardada como 1.

**F11 — Alta: factura informada como guardada aunque fallen sus renglones.**
`guardarItemsFactura` ([compras.service.ts:1352](/Users/leandroalonso/Projects/odb/apps/api/src/compras/compras.service.ts:1352)) no verifica el error de inserción. El encabezado ya existe y se devuelve `ok`. S09 inyecta ese fallo. Persistir encabezado/renglones en la misma transacción o dejar un estado incompleto visible que no habilite pago/stock.

**F12 — Media: un importe desconocido de OCR se convierte en cero.**
[listas.service.ts:726](/Users/leandroalonso/Projects/odb/apps/api/src/listas/listas.service.ts:726) usa `Number(null)` y obtiene 0. S12 reproduce el cambio; la interpretación incluso puede indicar `cierra` sin importe verificable. La relectura tiene un control de null que la lectura inicial no tiene. Conservar `null`, distinguir cero real de ilegible y bloquear confirmación de renglones dudosos. No se demostró stock automático equivocado: hay revisión humana posterior.

**F13 — Media: el agente operativo afirma notificar sin crear aviso.**
`agente/herramientas.ts`, caso `notify_admin`, devuelve `notificado:true` sin persistir ni enviar. S10 comprueba cero escrituras. Implementar alerta con ID y estado verificable; no devolver éxito si falló. Este es el agente operativo, no la herramienta comercial `consultar_interno` corregida previamente.

**F14 — Alta: supervisión del agente no detiene todas las acciones y puede declarar éxito tras fallar.**
[agente.service.ts:60](/Users/leandroalonso/Projects/odb/apps/api/src/agente/agente.service.ts:60) termina el lote de herramientas antes de atender el escalamiento. S11 ejecuta `update_stock` después de `request_human_review`. S17 acumula seis herramientas fallidas y devuelve tarea `completada`. Además el reclamo de tarea no es atómico. Los permisos deben residir en cada herramienta, la escalada detener las siguientes y la finalización depender de resultados reales. No basarse solo en el prompt.

**F15 — Alta: webhook de pedido no compara importe/moneda con la deuda.**
[pedidos.service.ts:456](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.service.ts:456) consulta el pago auténtico, pero un `approved` con `external_reference` basta para marcar el pedido pagado. S20 simula un pago de 1 USD y comprueba las escrituras sin consulta del total. Producción sí tiene secreto de firma MP; la prueba aísla la validación de negocio y no demuestra falsificación de firma. Comparar monto, moneda, cuenta cobradora y referencia esperada, conservar ID de pago e idempotencia. Revisar el mismo contrato en Compra Fácil.

**F16 — Alta: error transitorio del webhook se responde como éxito.**
S21 simula fallo de red al consultar MP y obtiene `{ok:true}`. El comentario de código espera reintentos, pero se acusa recepción exitosa. Distinguir fallo temporal de rechazo de negocio; devolver error reintentable o guardar trabajo durable antes de acusar recepción. Compra Fácil también captura fallos al confirmar; una caída después del claim requiere recuperación explícita.

**F17 — Alta: numeración ARCA mezcla empresas.**
[caja/arca.service.ts:148](/Users/leandroalonso/Projects/odb/apps/api/src/caja/arca.service.ts:148) usa clave `punto_venta-tipo`, sin emisor. S22 simula dos empresas con el mismo PV/tipo: la segunda recibe número 102, cuando le correspondería 901. Incluir emisor en la clave y serializar por emisor/PV/tipo. No se emitió ningún comprobante fiscal real durante la prueba.

**F18 — Alta: CAE emitido puede no persistirse y declararse correcto.**
[arca.service.ts:155](/Users/leandroalonso/Projects/odb/apps/api/src/caja/arca.service.ts:155) ignora error del update de CAE. S23 devuelve `emitidos:1, errores:0` ante fallo de guardado. La cola tampoco se reclama de forma atómica en `emitirPendientes`. Se necesita estado durable, exclusión entre workers y reconciliación del comprobante ya autorizado antes de reemitir tras un corte.

**F19 — Alta: rechazo concurrente de cheque duplica deuda.**
[cheques.service.ts:152](/Users/leandroalonso/Projects/odb/apps/api/src/cheques/cheques.service.ts:152) lee estado, actualiza y agrega débito sin bloqueo/transacción. S18 reproduce dos asientos. Rechazo debe ser idempotente y atómico; revisar también el saldo materializado frente al libro de movimientos.

**F20 — Media: la app expulsa por falta de permisos.**
[mobile/src/lib/api.ts:73](/Users/leandroalonso/Projects/odb/apps/mobile/src/lib/api.ts:73) trata 401 y 403 como sesión expirada. S16 devuelve 403 por verificación pendiente y comprueba logout. Conservar sesión ante 403 y mostrar el requisito real; invalidar solo ante autenticación expirada/revocada.

**F21 — Media: cobro QR pierde identificación del cajero.**
[mercadopago.controller.ts:56](/Users/leandroalonso/Projects/odb/apps/api/src/mercadopago/mercadopago.controller.ts:56) lee `req.user`; el guard usa `req.usuario`. S19 reproduce `usuarioId: undefined`. Unificar contrato de autenticación tipado y validar actor obligatorio en la operación.

**F22 — Alta: Compra Fácil redondea kilos y precio.**
[comprafacil.service.ts:65](/Users/leandroalonso/Projects/odb/apps/api/src/comprafacil/comprafacil.service.ts:65) aplica `Math.round` tanto a precio como cantidad. S24: 0,5 kg a $1.500,50/kg prepara cobro de $1.501 en vez de $750,25. No se cobró ese importe: MP estuvo simulado. Mantener decimales, usar la unidad de venta del catálogo y construir el renglón de MP con cantidad 1 e importe extendido cuando sea venta por peso. Bloquear cantidades inválidas en vez de convertirlas a 1.

## Otros defectos y riesgos de diseño confirmados por lectura

| ID | Prioridad | Evidencia / consecuencia | Corrección y prueba de cierre |
|---|---|---|---|
| F23 | Alta | [pedidos.controller.ts:137](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.controller.ts:137): detalle, seguimiento y actualización de ubicación públicos por ID. Conocer el UUID permite acceder a información de pedido/ubicación sin verificar dueño. No es enumeración trivial de UUID. | Usar token específico de seguimiento con alcance/caducidad; separar lectura de escritura y exigir actor para modificar |
| F24 | Media | [listas.service.ts:355](/Users/leandroalonso/Projects/odb/apps/api/src/listas/listas.service.ts:355): OCR en promesa en memoria; reiniciar proceso puede dejar lectura procesando, que luego solo se declara colgada. | Cola durable, original persistido antes del trabajo, lease/reintento y recuperación tras reinicio |
| F25 | Alta | [cobranzas.controller.ts:118](/Users/leandroalonso/Projects/odb/apps/api/src/clientes/cobranzas.controller.ts:118): cobro aplicado y recibo se guardan por separado; error al emitir documento se ignora. GET posterior puede crear folio sin saldos históricos. Recibo por ID no aplica filtro de cargador usado en bandeja. | Cobro+snapshot+folio atómicos; alcance por actor coherente; probar fallo de documento y consulta de otro usuario |
| F26 | Media | [pedidos.service.ts:278](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.service.ts:278) recibe `notas` y no las persiste ni pasa a RPC. Importación Tienda Nube usa esas notas para nombre y renglones sin match. | Guardar notas en transacción y dejar pedido incompleto visible si faltan renglones externos; no presentarlo como pedido completo |
| F27 | Alta | Checkout invitado en `web/app/checkout/page.tsx` admite confirmar sin nombre/teléfono; API permite cliente nulo. Promete avisar y coordinar aunque puede no haber destinatario. | Pedir contacto mínimo verificable o sesión; conservar pedido y enlace de seguimiento; probar retiro y domicilio como invitado |
| F28 | Media | Checkout no tiene clave idempotente estable; la dirección se guarda después de crear/reservar el pedido y se ignora error ([pedidos.service.ts:349](/Users/leandroalonso/Projects/odb/apps/api/src/pedidos/pedidos.service.ts:349)). | Unificar creación/destino; reintentar con misma clave y recuperar resultado existente, sin nueva reserva |
| F29 | Alta | Logout móvil borra estado local pero no desasocia push. `/mi/push-token` asigna el mismo token a nuevas cuentas sin retirar la asociación anterior. En dispositivo compartido puede llegar aviso de A después de entrar B. | Registrar dispositivos por usuario/sesión, revocar al salir y reasignar atómicamente; probar A→logout→B |
| F30 | Media | [mobile/src/lib/estado.tsx:183](/Users/leandroalonso/Projects/odb/apps/mobile/src/lib/estado.tsx:183): respuestas de cuenta/favoritos no se descartan si cambia sesión durante la petición. Respuesta tardía de A puede repoblar estado de B. | AbortController o generación de sesión; aceptar resultado solo si el token capturado sigue vigente |
| F31 | Media | [fidelizacion.service.ts:188](/Users/leandroalonso/Projects/odb/apps/api/src/fidelizacion/fidelizacion.service.ts:188): canje se inserta antes de descontar puntos y compensación/borrado puede fallar. Movimiento de puntos no se confirma antes de éxito. | Canje+descuento+movimiento atómicos e idempotentes; notificación separada con reintento |
| F32 | Media | `NotificarService.aCliente/aClientes` ignora error de guardado y contabiliza destinatarios aunque no se confirme entrega. | Separar pendiente/enviado/fallido y registrar ID de entrega; nunca equiparar intención con notificación efectiva |
| F33 | Media | No hay secreto Tienda Nube configurado en API activa. Código deja pasar sin HMAC, aunque sí valida tienda y reconsulta pedido en TN. | Configurar secreto del proveedor y rechazar sin firma cuando integración esté activa. No se concluye que el body pueda inventar cualquier pedido |
| F34 | Media | El modelo produjo una cadena de marcado interno en `direccion` de R02, un campo no pertinente a la consulta. Tipo string no garantiza contenido comercial válido. | Validar/sanitizar campos por herramienta; omitir dirección salvo consulta de reparto. Una observación, no frecuencia estadística |

**F35 — Media, evaluación de modelo: una foto puede provocar una exclusión comercial no verificada.** En R06 el modelo vio una ilustración de dos botellas y recibió un resultado de pack x6. Acertó al no describir la imagen ni suponer que se pedían dos, pero respondió “Suelta no la manejo”. La búsqueda simulada no probaba que no hubiera otro SKU unitario. Exigir evidencia antes de afirmar ausencia de otras presentaciones. Esta prueba usa el prompt/herramientas reales, pero no la orquestación completa y sus postcontroles; no demuestra que ese texto haya sido enviado en producción.

Los problemas de concurrencia anteriores se reprodujeron contra los servicios con repositorios simulados: demuestran la secuencia defectuosa del código. No sustituyen pruebas de transacción contra una copia de la base. En particular, no se afirma que haya clientes con deuda efectivamente duplicada en producción.

## Lectura de documentos y razonamiento

| Caso | Resultado del modelo/pipeline real | Tiempo |
|---|---|---|
| Factura: 2 packs x6 + 1 pack bonificado 100% | Dos renglones; pack=6; importes 12.000 y 0; bonificación reconocida; total 14.520; pack requiere confirmar unidad contra catálogo | 10,9 s |
| Factura: 0,500 kg a 1.500,50/kg | Peso 0,5; importe 750,25; IVA 157,55; total 907,80 | 5,5 s |
| Factura de dos páginas | Dos productos sin duplicar subtotal anterior; neto 700, IVA 147, total 847 | 6,1 s |
| Bot: 12 botellas, pack x6 | Cotiza 2 unidades de venta; responde 2 packs = 12 botellas | Ver JSON |
| Bot: fecha de reposición desconocida | Ejecuta consulta interna a compras; no inventa fecha. Se detuvo antes de ejecutar alerta real | Ver JSON |
| Bot: foto de transferencia pendiente | Lee titular e importe 12.345,67; deriva pago indicando pendiente; no confirma acreditación | Ver JSON |
| Bot: medio kilo de queso | Cotiza cantidad 0,5; respuesta: “Medio kilo de queso cremoso sale $750,25.” | Ver JSON |
| Bot: factura 20.000, recibo 12.345,67 | Deriva importe correcto y diferencia 7.654,33, preservando estado pendiente | Ver JSON |
| Bot: ilustración de dos botellas, “¿Tenés de esta?” | Busca el producto, no describe las botellas ni las toma como cantidad pedida; afirma “Suelta no la manejo” sin verificar esa exclusión | Ver JSON |

Evidencia: [ocr-real.json](/Users/leandroalonso/Projects/odb/docs/auditoria-integral-2026-09-21/ocr-real.json), [razonamiento-real.json](/Users/leandroalonso/Projects/odb/docs/auditoria-integral-2026-09-21/razonamiento-real.json), [reproducciones.json](/Users/leandroalonso/Projects/odb/docs/auditoria-integral-2026-09-21/reproducciones.json). No se asigna un porcentaje global de precisión a nueve casos. El matching de proveedores/productos estuvo aislado de la extracción en los PDFs; el catálogo del bot fue simulado. Falta un corpus etiquetado con proveedores reales, distintos impuestos, fotografías difíciles y presentaciones ambiguas para cuantificar exactitud operativa.

El bot comercial, el asistente de tienda, el lector de facturas y el agente operativo son circuitos diferentes. Mejorar un prompt no corrige los demás. Deben compartir contratos de cantidades/precios, políticas de datos desconocidos, permisos de herramientas y estado verificable de derivación.

## Estado de datos y pantallas observado

- 20.205 productos totales; 10.578 activos; 10 marcados para venta por peso. Esto no prueba que solo diez deban venderse por peso: hay nombres con “x peso” y “fracción” que requieren revisión de catálogo.
- 7.583 filas de stock, **88 negativas**. Es una observación, no prueba de bug nuevo: separar negativos históricos, reservas y reglas de sobreventa antes de corregir saldos.
- 15 usuarios, 9 inactivos. Distribución total, incluyendo inactivos: 7 dueño, 4 cajero, 3 administrativo, 1 gerente. Revisar privilegios efectivos de activos, no interpretar los siete como siete dueños activos.
- 73 lecturas, todas listas al consultar; ninguna colgada >12 minutos en esa instantánea. El defecto de recuperación sigue existiendo aunque hoy no haya un trabajo colgado.
- 29 facturas: 18 pendientes, 11 pagadas. No hubo diferencias en las identidades fiscales comprobables ni pagadas con monto pagado insuficiente en esa muestra. No implica auditoría contable de los originales.
- Sin repartos, tareas del agente operativo ni cobranzas pendientes en las tablas consultadas. Los fallos de esos circuitos son capacidad defectuosa reproducida, no incidente histórico encontrado.
- Tienda viva: inicio y catálogo cargan, búsqueda encuentra resultado, ficha sin stock impide agregar, un agua disponible entra al carrito con total correcto, checkout permite retiro/domicilio. Se retiró el artículo de prueba al finalizar. No se confirmó pedido.
- App móvil exportada: inicio y catálogo conectado funcionan, y Mi cuenta pide login al invitado desde origen local autorizado. Es exportación web, no validación de cámara/GPS/push de iOS o Android.
- Categorías duplicadas y variantes de mayúsculas aparecen en tienda/app; algunas denominaciones y precios históricos merecen depuración editorial. No corregir automáticamente nombres/packs porque pueden representar SKU distintos.

## Pruebas de cierre exigibles antes de darlo por corregido

1. Matriz de dos usuarios por rol: A jamás consulta/escribe recursos privados de B; un dueño puede las excepciones expresamente autorizadas. Cliente y anon no ejecutan RPC internas.
2. Token previo a desactivación/reset/cambio de rol pierde los privilegios anteriores. Sesión temporal no opera fuera de cambio de clave.
3. Doble click y dos solicitudes concurrentes en rendición, rechazo, canje, cobro y pedido producen exactamente un efecto. Inyectar fallos entre cada escritura y verificar rollback/recuperación.
4. Precio y cantidad en unidad, pack, bulto y kg se preservan entre catálogo, bot, web, app, stock, pedido y pago. Un importe ilegible nunca se convierte en cero.
5. MP aprobado con monto, moneda o cuenta incorrecta no libera pedido; error temporal se recupera; repetir aviso no duplica efectos.
6. ARCA separa emisor/PV/tipo; corte después de autorización remota recupera CAE existente y no duplica emisión. Probar solo en homologación.
7. Aprobación de cobro crea recibo y saldos históricos en la misma transacción. Reimpresión no inventa estado histórico ni permite acceso ajeno.
8. Alerta/derivación tiene registro y estado real; fallo de envío deja reintento. Escalamiento detiene cambios y ninguna herramienta fallida produce “completada”.
9. Teléfono físico: escaneo, permisos denegados, subida de fotos, HEIC/PDF, GPS, retorno desde pago, app cerrada y cambio A→B; nunca usar clientes reales como casos de mutación.
10. Corpus OCR/comercial etiquetado y estable: medir cantidades, unidad de venta, impuestos, total, SKU, dudas correctas y concisión por caso; incluir fotos de varias botellas sin inferir cantidad pedida.

## Cómo reproducir esta auditoría

Desde `apps/api`: `npm test -- --runInBand`, `npm run build`, luego `node scripts/auditar-sistema.cjs`. Este último **comprueba la presencia de defectos**, por eso todos sus casos reproducidos pasan; no debe incorporarse como suite de aceptación verde del producto.

`auditar-ocr-real.cjs` y `auditar-razonamiento.cjs` usan API de modelo real y datos sintéticos, con herramientas/escrituras simuladas. Se ejecutaron con `node --env-file=.env ...`. Requieren fixtures en `output/pdf/auditoria-integral` y `tmp/pdfs`. `auditar-datos-lectura.cjs` consulta datos vigentes y guarda solo resúmenes sin PII. `auditoria-inventario.cjs` produce inventario de rutas.

Las pruebas reproducibles deben invertirse después de cada corrección para exigir el comportamiento seguro. Publicar solo tras validar en entorno aislado las rutas financieras y de autorización afectadas. Este informe y sus adjuntos contienen detalles de seguridad y son de uso interno.

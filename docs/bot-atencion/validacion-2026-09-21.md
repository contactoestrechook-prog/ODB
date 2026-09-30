# Atención comercial ODB — cambios y validación

Estado: implementación local. No publicada. No se modificaron productos, precios ni stock, ni se enviaron mensajes a clientes o al equipo durante la evaluación.

## Conducta esperada

- Responder precio o disponibilidad directamente, sin abrir otra conversación ni ofrecer armar pedidos sin necesidad.
- Fotos y documentos sirven para entender el requerimiento. No describir lo visible ni interpretar la cantidad fotografiada como cantidad pedida.
- Si falta un dato: registrar consulta, alertar internamente y no enviar un mensaje de espera al cliente. El flujo existente lleva la respuesta del área al cliente.
- Distinguir cantidad solicitada, unidades de venta y contenido de un pack. No convertir un nombre ambiguo en una afirmación sobre venta suelta.

## Correcciones

Las consultas de búsqueda y cotización omitían unidades_pack aunque después intentaban usarlo. Ahora lo consultan y exponen presentación y cantidades estructuradas. Se eliminó el control que comparaba cada cantidad con todos los números del mensaje; ahora la validación se limita a cantidades inequívocas de un único artículo. Se bloquea cotizar unidades individuales cuando la composición del envase requiere verificación.

El control de extensión ya no excluye cualquier respuesta que contenga un precio. Presupuestos y pedidos conservan sus renglones. Se solicita reformulación cuando una respuesta a una foto narra lo visible sin que el cliente lo haya pedido.

Una consulta interna exitosa termina el turno sin mensaje al cliente; no se guarda una promesa ni se generan vueltas adicionales para redactarla. El reintento del mismo mensaje no vuelve a producir la consulta. La consulta pendiente se registra antes del envío a WhatsApp y se conserva ante un error de transporte.

## Catálogo consultado en modo lectura

10.578 artículos activos; 18 con unidades_pack mayor que uno. Un filtro amplio encontró 607 nombres con referencias a packs, cajas o cantidades y unidades_pack=1. Son candidatos a revisión, no 607 errores confirmados. Ejemplos: kit Negroni x3, caja Guolis de media docena, figacitas envasadas x9. No se debe inferir que el envase se abre ni que el precio corresponde a cada componente.

## Validación

- 42 suites y 524 pruebas automatizadas aprobadas; compilación Nest aprobada.
- Casos cubiertos: 18 botellas sueltas, 18 botellas en packs reales de seis, cantidades no divisibles, varios artículos con cantidades distintas, falta de sucursal de preparación, cantidades inválidas, envases ambiguos, fotos sin narración, consulta silenciosa y reintentos.
- Evaluación con modelo real y herramientas simuladas: scripts/evaluar-atencion.cjs, ejecutado desde apps/api con su entorno. No conecta herramientas a base de datos ni WhatsApp. Tres escenarios: dato desconocido, stock puntual y cotización de 18 botellas en packs de seis.

## Límites

Las pruebas no garantizan todos los posibles diálogos ni verifican visualmente fotos reales de clientes. La composición de los envases ambiguos requiere datos comerciales confirmados; no se corrigió automáticamente. La entrega real de alertas y respuestas debe comprobarse en un circuito controlado antes de publicar estos cambios.

# Corrección y comparación del lector — 21/09/2026

Publicado y verificado en Railway el 21/09/2026; evidencia en `publicacion.json`. Esta intervención cubre los datos faltantes en la lectura de comprobantes y su confirmación en administración; no cierra los demás hallazgos de la auditoría integral.

## Correcciones

- Cantidad, precio e importe ausentes o inválidos se conservan como `null`. Ya no se inventan una unidad, un precio cero o un importe cero.
- El esquema pide omitir los valores ilegibles y prohíbe calcular el importe como si estuviera impreso. La normalización convierte esas omisiones en `null`. Se respeta el límite de 16 propiedades con tipos unión, comprobado con el servicio real.
- La interpretación marca el renglón `incompleto` e identifica los campos faltantes. La misma protección se usa al leer, vincular una presentación del catálogo y reabrir una lectura.
- El panel deja los campos desconocidos vacíos. Bloquea cantidades/precios inválidos en los renglones incluidos en una entrada y en todos los renglones al registrar solo la factura. Un cero explícito sigue siendo válido como precio; una rebaja admite precio negativo.
- Si falta un importe, el panel avisa que no quedó verificado. No deduce una conversión apoyándose en ese importe ausente. El operador conserva la posibilidad de revisar los valores contra el original.
- Un precio desconocido no genera una variación de costo falsa frente al catálogo.

## Comparación ejecutada

Modelo configurado en código: `claude-sonnet-5`. Se comparó esfuerzo `medium` contra `high`, con el mismo esquema corregido y los mismos tres PDFs sintéticos. Una ejecución por documento/configuración, sin escrituras en base de datos, sin subir documentos a almacenamiento y sin matching real del catálogo. Los PDFs sí se enviaron al proveedor del modelo.

| Caso | Medium | High | Campos evaluados |
|---|---:|---:|---|
| Packs de 6 y bonificación del 100% | 10,9 s | 7,3 s | Sin diferencias en ambos |
| Medio kilo, precio e importe con decimales | 5,6 s | 10,1 s | Sin diferencias en ambos |
| Dos páginas, con subtotal transportado | 6,1 s | 7,4 s | Sin diferencias en ambos |

Se verificaron cantidad de renglones, cantidades interpretadas, precios, importes, neto, IVA y total; unidades por pack y venta por peso donde correspondía. El caso de packs sigue pendiente de decidir la unidad de stock del producto vinculado, como corresponde: dos packs de seis no prueban por sí solos que el catálogo stockee botellas sueltas.

Promedio observado: medium 7,5 s; high 8,3 s. Una sola pasada y tres documentos no permiten concluir una diferencia estable de velocidad ni medir precisión en producción. Tampoco se midió costo monetario. No hubo ventaja de exactitud de high en los campos evaluados; se mantiene el esfuerzo predeterminado medium.

Azure Document Intelligence no se evaluó: el usuario confirmó que no tiene un recurso configurado. No se puede afirmar que sea mejor o peor. Queda pendiente una comparación con 50–100 comprobantes representativos y respuestas revisadas por una persona: fotos torcidas, borrosas, proveedores distintos, impuestos mixtos, descuentos, peso y presentaciones ambiguas.

## Evidencia y reproducción

- `resultados.json`: seis lecturas completas y diferencias contra valores esperados.
- `apps/api/scripts/comparar-lector.cjs`: comparación repetible sobre PDFs existentes en `output/pdf/auditoria-integral/`.
- Ejecutar desde `apps/api`: `npm run build`, después `node --env-file=.env scripts/comparar-lector.cjs`. Esto consume API del proveedor.
- Pruebas de regresión: `lectura-segura.spec.ts` y `lectura-integracion.spec.ts`; esta última comprueba lectura inicial y reapertura usando SDK y base simulados.

El archivo histórico `docs/auditoria-integral-2026-09-21/ocr-real.json` se conserva intacto. El script histórico `auditar-sistema.cjs` afirma defectos anteriores: su caso S12 ya no debe reproducir la conversión de importe desconocido a cero; no es una prueba de aceptación actual.

## Validación final

606 pruebas aprobadas en 45 suites. Compilaciones de API y administración completadas correctamente. `git diff --check` sin errores. No se realizó una prueba interactiva del panel en navegador.

## Límites pendientes

No se corrigieron en esta intervención la persistencia transaccional de facturas, los permisos de consulta de lecturas ni la recuperación de trabajos OCR tras reinicios. La validación del panel no sustituye esas protecciones del servidor. Los ceros o cantidades inventados que ya hubieran sido guardados por versiones anteriores no pueden reconstruirse sin releer el original. Se publicaron estos cambios sin registrar operaciones comerciales reales.

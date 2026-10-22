# Actualizar ODB desde el sistema viejo (Saint Thomas)

Saint Thomas sigue vendiendo con el sistema viejo; ODB se pone al día con las dos
planillas que exporta: **lista de precios** (`precios st DD-MM.xls`) e **inventario**
(`stock st DD-MM.xls`). Es una foto: desde el día siguiente ODB vuelve a atrasarse
hasta la próxima carga.

Cargas hechas: 12/6, 20/6, 21/7, 11/8, 16/9 (scripts sueltos, ya borrados) y
**1/10/2026 con estos scripts** (auditoria id 800, referencia `st-0110`).

## Pasos (desde `apps/api`, que tiene el `.env` con `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`)

1. **Simular** (solo lee): arma un Excel con lo que cambiaría y un `plan.json`.

       node ../../scripts/sistema-viejo/actualizar.mjs --simular \
         --precios "~/Downloads/precios st DD-MM.xls" --stock "~/Downloads/stock st DD-MM.xls" --salida <dir>

   Leer los `.xls` tarda varios minutos: se puede pasar un `.json` crudo en su lugar.
   Mostrarle el Excel al dueño antes de seguir.

2. **Preparar**: guarda la carga en UNA fila de `auditoria` (accion
   `importacion_sistema_viejo`). Resuelve las altas: vincula productos de ODB sin
   código viejo que son el mismo artículo, categoría por rubro, alcohol por rubro.

       node ../../scripts/sistema-viejo/preparar.mjs <dir>/plan.json st-DDMM <usuario_id del dueño>

   Revisar lo que imprime (vinculados, duplicados, sin categoría) y corregir la fila
   si hace falta: todavía no se aplicó nada.

3. **Aplicar**: `aplicar.sql` con el id de la fila. Primero con `__ENSAYO__ = true`
   (termina con un error que trae los números y vuelve todo atrás), después con
   `false`. Es un solo bloque: todo o nada.

4. **Verificar**: volver a correr el paso 1: no tiene que quedar nada para aplicar
   (salvo diferencias de redondeo de los productos por peso, al gramo). Y el libro:
   `stock.cantidad` = suma de `movimientos_stock` en todos los renglones.

## Reglas (aprendidas en las cargas anteriores)

- Cruce por `productos.codigo_legacy` (el sku es `'L' + código`), nunca por sku.
- Columnas por encabezado (`Codigo`, `Precio 1`, `Pack` = cantidad): cambian de lugar.
- Precios: vigencia NUEVA en la lista Minorista. Nunca UPDATE ni DELETE (el 11/8 se
  perdió el historial). `Precio 2` no se usa (tiene errores de x10). El precio es
  uno solo para las dos sucursales.
- Stock: solo Saint Thomas, por diferencia con `registrar_movimiento` (motivo
  `Sincronización con sistema anterior`, referencia `stock-DDMM`). Negativos → 0.
- No se aplica, va a revisión: productos dados de baja, códigos repetidos o
  reutilizados con otro nombre, precios basura (0, 0,01, menos de $100) y saltos de
  más de ±60%.
- Lo que ODB tiene y la planilla no trae, no se toca.

---

# Migración con la EXPORTACIÓN completa (`exportacion/`)

Para dejar de usar el sistema viejo. La exportación son 9 `.csv` (latin-1, `;`,
coma decimal, CRLF): `articulos`, `stock`, `codigobarras`, `listadeprecios`,
`proveedores`, `productosxproveedor`, `clientes`, `ctacte_clientes` y `ventas`.
Primera: corte del **21/10/2026 12:08**. La referencia sale del corte de cada
exportación (`export-DDMM`: la del 21/10 es `export-2110`; la del día del cambio
tendrá la suya). El circuito de
las planillas de arriba sigue igual y se puede seguir usando.

**La exportación, la salida de la simulación y los ensayos traen datos de
clientes: van AFUERA del repo** (los scripts se niegan a escribir adentro y el
`.gitignore` frena `.csv`, `.xlsx`, `plan*.json` y `ensayo*.sql`).

Mismo esquema de siempre, una entidad por vez: **simular → preparar → aplicar
(ensayo y después de verdad) → verificar**. Cada entidad es UN bloque
`aplicar/<entidad>.sql`, todo o nada, que se puede correr dos veces sin duplicar
(el ensayo lo demuestra: hace dos pasadas y la segunda tiene que dar 0).

## Pasos (desde `apps/api`, que tiene el `.env`)

1. **Simular** (solo lee):

       node ../../scripts/sistema-viejo/exportacion/simular.mjs --exportacion <dir con los .csv> --salida <dir> [--equivalencias <csv>]

   Deja `informe-exportacion.xlsx` (hojas Resumen, **Decisiones**, **Revisar** y una
   por entidad), `resumen.json` y un `plan-<entidad>.json` por entidad.
   `--equivalencias`: proveedores del viejo que el dueño confirmó que son uno de
   ODB, un renglón `código del viejo;razón social o id del proveedor de ODB`.

2. **Mostrarle el informe al dueño.** En la hoja Revisar marca `sí` en la columna
   `aprobar` lo que acepta (solo se puede aprobar lo que tiene propuesta). Las
   secciones que dependen de una decisión suya entran con `--incluir`:
   `precios: mayorista` · `costos: costos_viejos` · `barras: quitar_cajas` ·
   `ctacte: habilitar_activos`.

3. **Ensayar en producción sin escribir nada:**

       node ../../scripts/sistema-viejo/exportacion/preparar.mjs <dir> <entidad> <usuario_id del dueño> \
         [--aprobar <dir>/informe-exportacion.xlsx] [--incluir …] --ensayo <afuera>/ensayo-<entidad>.sql [--muestra N]

   El `.sql` trae la carga adentro (con control md5), crea la fila de auditoria
   dentro del mismo bloque y termina con `RAISE EXCEPTION 'ENSAYO OK …'` con los
   números de las dos pasadas: no queda nada escrito. `--muestra N` achica las
   entidades grandes para la consola SQL; `--con-migracion ../../db/migracion-ventas-historicas.sql`
   ensaya el historial con la migración opcional sin aplicarla.
   Para ver las dependencias entre entidades (altas que reciben códigos, costo y
   stock; clientes nuevos que reciben su saldo):

       node ../../scripts/sistema-viejo/exportacion/ensayo-encadenado.mjs <dir> <usuario_id> <afuera>/ensayo-encadenado.sql --n 5

   Después del ensayo, comprobar con una lectura que no quedó nada (por ejemplo
   `select count(*) from auditoria where entidad like 'sistema_viejo:%'` = 0).

4. **Preparar** (lo único que escribe este paso: UNA fila de `auditoria`, accion
   `importacion_sistema_viejo`, entidad `sistema_viejo:<entidad>`, entidad_id `export-DDMM`):

       node ../../scripts/sistema-viejo/exportacion/preparar.mjs <dir> <entidad> <usuario_id> [--aprobar …] [--incluir …]

5. **Aplicar**: `aplicar/<entidad>.sql` reemplazando `__AUDITORIA_ID__` por el id y
   `__ENSAYO__` por `true` (ensayo) y después por `false`. Guarda en
   `datos_antes.aplicado` los números y lo que se pisó (costos y saldos anteriores).

6. **Orden**: `proveedores` → `articulos` → `precios` → `costos` → `barras` →
   `clientes` → `ctacte` → `historial` → **`stock` al final, el día del cambio**,
   con el sistema viejo congelado y una exportación sacada en ese momento (la del
   21/10 es de pleno día de venta). Si una entidad se aplica sin la anterior, lo
   que depende de ella queda contado como "sin producto" / "sin cliente" / "sin
   proveedor" y no se inventa nada.
   **`ctacte` e `historial` se aplican UNA vez, con la exportación del día del
   cambio** (igual que el stock). Si igual se cargan antes, el circuito no
   duplica: la cuenta corriente agrega solo la diferencia como «Ajuste de saldo
   del sistema anterior (corte …)» y el historial agrega solo los días que faltan
   desde el último período cargado. Pero es más limpio hacerlo una sola vez.
   **Stock y precios**: simular, preparar y aplicar seguidos. Lo que cambie en
   ODB entre la simulación y el aplicar (una reserva del bot, una compra, un
   precio cambiado a mano) NO se pisa: se saltea y queda listado en el resultado
   (`cambiaron_desde_la_simulacion` / `cambiados_en_odb_despues_de_simular`).

7. **Verificar**: volver a simular (no tiene que quedar nada para aplicar) y el
   libro de stock: `stock.cantidad` = suma de `movimientos_stock`.

Pruebas: `node --test scripts/sistema-viejo/exportacion/*.test.mjs`.

## Qué hace cada entidad (y qué no)

- **articulos**: altas (sku `'L'` + código, categoría por rubro, alcohol por rubro,
  precio Minorista), vínculo de productos de ODB sin código viejo que son el mismo
  artículo, y **vendido por peso** a los que el viejo vende con decimales (la
  etiqueta de la balanza trae gramos; la caja busca por `coalesce(plu, codigo_legacy)`,
  así que el PLU no hace falta). NO toca nombre, categoría, IVA ni
  `unidades_pack` (en el viejo es la caja del proveedor; en ODB es lo que se vende).
- **precios**: Precio 1 ("Lista Unitaria") → vigencia nueva en Minorista, con las
  reglas de las planillas; además van a revisión los precios que se cambiaron a
  mano en ODB después de la última carga y los que la exportación trae con dos
  valores. Lista ODB y Restos no se cargan; la lista sin nombre (≈ costo × 1,4)
  queda propuesta para Mayorista.
- **costos**: como `aplicar_lista_proveedor` (nunca `aplicar_lista_con_precio`):
  `productos.costo` + `proveedor_productos` + `costos_historial`, con la fecha de
  costo del viejo; no pisa un costo de ODB más nuevo; costo mayor al precio a
  revisión; los de más de un año, pendientes.
- **barras**: solo códigos de UNIDAD seguros. Cajas, repetidos, códigos de otro
  producto, etiquetas de balanza y dígitos inválidos: a revisión o afuera.
- **proveedores**: cruce por CUIT y razón social exacta; lo parecido se propone
  (nunca se aplica: Molinos ≠ Olin); altas solo de los que tienen artículos.
- **clientes**: el código del viejo es OTRA numeración que `clientes.codigo_legacy`:
  nunca se cruza por código. Cruce por CUIT, DNI (del CUIT), nombre único y
  teléfono/email con nombre compatible; los nuevos quedan con `st-<código>`; a
  los existentes solo se les completa lo vacío y se corrige la condición de IVA
  en mayúsculas.
- **ctacte**: UNA línea de "Saldo inicial del sistema anterior (corte …)" por
  cliente con saldo, sin comprobante, al debe o al haber, y `saldo_cta_cte`
  igualado al libro. Ni facturas ni pagos inventados; el historial queda en el
  informe. El candado es por CLIENTE (el principio del concepto), no por corte:
  con otra exportación va solo la diferencia como ajuste. Un cliente vinculado
  con un saldo suelto de junio (sin libro) va a Revisar con dos propuestas que se
  excluyen: `saldo:<código>:reemplazar` o `saldo:<código>:sumar` (aprobar una).
- **historial**: `ventas_historicas` (la tabla aparte que leen abastecimiento,
  estadísticas y el orden de la tienda), agregada por producto y período sin
  pisar julio, con los dos últimos períodos de 30 días. Nunca en `ventas`. El
  producto de cada fila lo resuelve simular: los códigos reutilizados con otro
  nombre, los repetidos y los que el viejo ya no tiene van SIN producto (no le
  pasan sus ventas a otro).
- **stock**: igual que las planillas (registrar_movimiento por diferencia,
  negativos a 0); lo que tiene reservas de pedidos o compras de ODB que el viejo
  no registró va a revisión (contadas desde la última carga de STOCK, no de
  cualquier entidad). También van a revisión los decimales en productos que se
  venden por unidad (`stock:` redondeado o `stock-peso:` tal cual si se aprueba
  `peso:` en artículos) y las presentaciones fraccionadas (los huevos: contarlas
  el día del cambio). Santa Inés no se toca.
- **precios**: además de las reglas de siempre, el Minorista que quedaría debajo
  del costo (de ODB o del viejo) va a revisión; la Mayorista no se propone si el
  costo del viejo tiene más de un año y se controla con el costo más nuevo.

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
- No se aplica, va a revisión: productos dados de baja, códigos repetidos (en
  NÚCLEO o en el Crack: el 12252, el 10610 y el 8139 son dos artículos cada uno, y
  hasta el 12/11/2026 cada fila le pisaba el stock a la otra) o
  reutilizados con otro nombre, precios basura (0, 0,01, menos de $100) y saltos de
  más de ±60%.
- Lo que ODB tiene y la planilla no trae, no se toca.

## Carga desde los CSV del Crack (10/11/2026, auditoría 1062 + 1065, referencia `export-1011`)

Desde octubre el Crack exporta nueve CSV (`articulos`, `clientes`, `codigobarras`,
`ctacte_clientes`, `listadeprecios`, `productosxproveedor`, `proveedores`, `stock`,
`ventas`), en Windows-1252.

1. Pasarlos a UTF-8 con Python (`decode('cp1252', errors='replace')`), NO con
   `iconv`: el 10/11 `iconv` cortó `ventas.csv` en el 3/11 sin avisar y la
   simulación daba la mitad de los cambios. Contar líneas antes y después.
2. `python3 -I simular-csv.py <carpeta>`: solo lee y arma `plan.json`, `revision.json`
   y `resumen.txt`. Desde el 17/11/2026 no se edita nada a mano: el corte sale de
   `stock.csv` y la carga anterior, de la base (la última sincronización de Sant Thomas
   anterior al corte). Si Sant Thomas ya se sincronizó después del corte, frena: el
   archivo es viejo. `python3 excel-csv.py <carpeta>` arma el Excel para el dueño
   (sin `-I`: necesita openpyxl).
3. Guardar `plan.json` en una fila de `auditoria` (accion `importacion_sistema_viejo`,
   entidad `carga`, entidad_id = la `referencia` del plan) y correr `aplicar-csv.sql`
   cambiando `__FILA__` por el id de esa fila y `__ENSAYO__` por `true`; después, `false`.
4. Historiales: `importar-ctacte-clientes.mjs` y `importar-compras-clientes.mjs` con
   origen nuevo; después borrar lo viejo superpuesto (toda la cuenta corriente vieja;
   las compras viejas desde la primera fecha del export nuevo).
5. Volver a simular con `--verificar` (sin eso frena, porque el corte ya es viejo):
   tiene que dar todo en 0 (salvo redondeo de los por peso). Y el libro:
   `stock.cantidad` = suma de `movimientos_stock`.

Criterio (lo nuevo del 10/11):
- **Stock de Sant Thomas = Crack + lo que entró o salió SOLO en NÚCLEO desde la carga
  anterior** (compras de Ana, correcciones, traspasos, reservas), producto por
  producto: si el Crack también tuvo esa compra (su stock subió), no se cuenta dos
  veces. Las ventas de prueba de NÚCLEO no cuentan. Se aplica como diferencia sobre
  el stock del momento: lo que se mueva entre la simulación y la aplicación se conserva.
- Precios: la lista 1 del Crack, salvo que NÚCLEO la haya remarcado y el Crack siga con
  el precio de la carga anterior (NÚCLEO es más nuevo: esa lista se le pasa al dueño para
  la caja del Crack). Ver «17/11/2026» abajo: la regla cambió.
- Costo e IVA: los de NÚCLEO no se pisan (vienen de sus facturas); solo se completa lo vacío.
- Clientes: altas solo con saldo, cuenta corriente o compras en el último año.
- Cuenta corriente: el saldo del Crack manda (contra `clientes.saldo_cta_cte`, que es
  el que ve la gente; hay saldos de junio sin movimiento).
- **Toda lectura paginada de la base lleva un orden único** (`order=id`, o
  `vigente_desde.desc,id.desc`): ordenado solo por fecha, con miles de precios de la
  misma fecha, las páginas salteaban filas (el 10/11 se grabaron 846 precios repetidos,
  que se borraron, y 3 stocks quedaron mal hasta la verificación).

### Quién vende cada producto (10/11/2026, auditoría 1083)
- La columna que vale es **«proveedor habitual»** de `articulos.csv`. Lo verificó Leandro con sus ejemplos: Johnnie Walker va a Lalo Importados y Don Satur a Clan. El código de `productosxproveedor.csv` **está roto** para los proveedores nuevos: mandó Johnnie Walker, SodaStream y vinos a «distrisur».
- Cada escritura del Crack se traduce con `mapa-proveedores.json`, la tabla del 23/10 corregida a mano.
- **Lo decidido en NÚCLEO manda sobre el Crack** (Leandro, 10/11/2026: «que respete lo que hizo Jackie»). La tabla `proveedor_decidido` tiene un proveedor por producto: Jackie pasó 26 Mutti y Garofalo a Marquisse. La simulación no le agrega el proveedor del Crack y el espejo usa el decidido como destino, así que nunca lo saca.
- `python3 espejo-proveedores.py <carpeta>` deja los vínculos igual que el Crack: saca los que el Crack no tiene, salvo los que tienen una compra real en NÚCLEO (factura, código o alias del proveedor), y agrega los que faltan. El 10/11 sacó 1.309 y agregó 13.
- «distrisur» y «Distribuidora de Galletitas y Alimentos del Sur SA» se unificaron en la segunda, la de las facturas.

## Carga del 17/11/2026 (auditorías 1189, 1190/1192, 1193, 1196, 1199, 1200)

Lo que se arregló en los scripts después de esa carga:

- **Vincular en vez de duplicar** (`vincular.py`). Cuando Ana carga una factura con un
  producto nuevo, NÚCLEO lo crea SIN código del Crack (SKU 409xx); días después el Crack
  le pone código al mismo artículo y la carga lo daba de alta otra vez, con la compra
  contada dos veces. El 10/11 duplicó 2 y el 17/11, 17 (se unificaron a mano: auditorías
  1196 y 1199). Ahora, antes de dar de alta, se busca el artículo entre los productos
  activos sin código: por la barra de la unidad o por el nombre (sin tildes ni signos, con
  errores de tipeo, y si los dos dicen un tamaño distinto —250 g / 500 g— no es el mismo).
  Lo seguro va a `plan['vincular']`: ese producto recibe el código y sigue la carga como
  uno existente (stock con la regla de siempre, precio, barras, proveedor). Lo dudoso se da
  de alta igual y va a la planilla como «posible duplicado». Probado con los 19 casos
  reales: 19 bien, ninguna de las 36 altas verdaderas confundida.
- **Precios: manda el que cambió último.** La regla vieja respetaba lo que NÚCLEO remarcó
  solo si era posterior a la carga ANTERIOR; en la carga siguiente se pisaba con el precio
  viejo del Crack aunque nadie lo hubiera cambiado en la caja. El 17/11 volvieron atrás 91
  precios que NÚCLEO había remarcado del 4/11 al 10/11 (se restauraron: auditoría 1200).
  Ahora cada plan guarda el precio de cada artículo en el Crack (`precios_crack`; al de la
  fila 1190 se le agregó a mano) y la carga siguiente compara: si el Crack sigue igual,
  manda NÚCLEO (a la lista para la caja); si el Crack cambió y NÚCLEO no desde la carga
  anterior, manda el Crack; si cambiaron los dos, a revisión. Los precios de una carga van
  sin `creado_por`; los de NÚCLEO, con el usuario: así se distinguen.
- **Códigos de cliente repetidos en el Crack** (17 el 17/11, dos clientes cada uno): no se
  dan de alta ni se les ajusta el saldo; van a revisión con el nombre de la ficha de NÚCLEO.
- **La misma barra como unidad y como caja** (Levite 1367, Alambrado 2101, Fond de Cave
  6680): no se saca; va a revisión.
- **Fechas solas** (ver el paso 2) y `aplicar-csv.sql` con `__FILA__`: la referencia, el
  corte y los textos de cuenta corriente salen del plan.

Trampas del día:
- **«Poner al día» ANTES que la carga completa**, nunca después. Las altas de la carga
  dejan movimientos `importacion` que corren la «última sincronización»: si después se
  pone al día, las compras cargadas solo en NÚCLEO desde la carga anterior se pierden.
  (Si se usa solo esta carga, el stock y las ventas entran por acá y no hace falta.)
- El lector de la pantalla (`apps/admin/app/lib/puesta-al-dia.ts`) lee los CSV
  ORIGINALES (cp1252); con los ya pasados a UTF-8 no encuentra las columnas.
- Desde la Mac, en el sandbox: el `fetch` de Node necesita `NODE_USE_ENV_PROXY=1`, y las
  lecturas largas a veces llegan cortadas (los scripts reintentan).

## Carga del 18/11/2026 (auditorías 1242/1243, 1245, 1246)

- **Las altas traen sus barras.** Antes, la carga solo agregaba barras a productos que ya
  existían: el producto nuevo quedaba sin poder escanearse hasta la carga siguiente (el
  18/11, 7 de las 9 altas; se pusieron a mano, auditoría 1246). Ahora el plan trae
  `barras_altas` (barra de la unidad + código del Crack) y `aplicar-csv.sql` las pone
  después de crear el producto. Una barra que en NÚCLEO es de otro producto va a revisión,
  igual que siempre. Probado con un export inventado y el SQL en ensayo (fila 1249, borrada).
- **El espejo de proveedores saltea los códigos repetidos del Crack** (10610, 12252,
  8139): cada fila le sacaba al producto el proveedor de la otra, y el 18/11 iba a dejar sin
  proveedor a Domain Bousquet y a Gin Bombay Sunset.
- Desde la Mac, si `simular-csv.py` corta con `IncompleteRead` aunque reintente, es el
  proxy del sandbox: correrlo fuera del sandbox.

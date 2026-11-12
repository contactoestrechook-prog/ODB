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

## Carga desde los CSV del Crack (10/11/2026, auditoría 1062 + 1065, referencia `export-1011`)

Desde octubre el Crack exporta nueve CSV (`articulos`, `clientes`, `codigobarras`,
`ctacte_clientes`, `listadeprecios`, `productosxproveedor`, `proveedores`, `stock`,
`ventas`), en Windows-1252.

1. Pasarlos a UTF-8 con Python (`decode('cp1252', errors='replace')`), NO con
   `iconv`: el 10/11 `iconv` cortó `ventas.csv` en el 3/11 sin avisar y la
   simulación daba la mitad de los cambios. Contar líneas antes y después.
2. `python3 simular-csv.py <carpeta>`: solo lee y arma `plan.json`, `revision.json`
   y `resumen.txt`. Arriba del archivo van `T_ULTIMA` (la carga anterior) y `CORTE`.
   `python3 excel-csv.py <carpeta>` arma el Excel para el dueño.
3. Guardar `plan.json` en una fila de `auditoria` (accion `importacion_sistema_viejo`)
   y correr `aplicar-csv.sql` con el id de esa fila: primero `__ENSAYO__ = true`.
4. Historiales: `importar-ctacte-clientes.mjs` y `importar-compras-clientes.mjs` con
   origen nuevo; después borrar lo viejo superpuesto (toda la cuenta corriente vieja;
   las compras viejas desde la primera fecha del export nuevo).
5. Volver a simular: tiene que dar todo en 0 (salvo redondeo de los por peso). Y el
   libro: `stock.cantidad` = suma de `movimientos_stock`.

Criterio (lo nuevo del 10/11):
- **Stock de Sant Thomas = Crack + lo que entró o salió SOLO en NÚCLEO desde la carga
  anterior** (compras de Ana, correcciones, traspasos, reservas), producto por
  producto: si el Crack también tuvo esa compra (su stock subió), no se cuenta dos
  veces. Las ventas de prueba de NÚCLEO no cuentan. Se aplica como diferencia sobre
  el stock del momento: lo que se mueva entre la simulación y la aplicación se conserva.
- Precios: la lista 1 del Crack, salvo que NÚCLEO la haya remarcado después de la carga
  anterior (NÚCLEO es más nuevo: esa lista se le pasa al dueño para la caja del Crack).
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

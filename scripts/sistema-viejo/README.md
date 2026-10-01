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

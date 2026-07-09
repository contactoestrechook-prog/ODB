# Fusión de productos duplicados (bug del bridge)

## El problema

El bridge Access→Supabase, al sincronizar el 18/6, en vez de emparejar con los
productos ya importados del Excel (12/6) creó **copias nuevas con prefijo `L`**.
Resultado: **9.317 productos duplicados**.

| | SKU ej. | Creado | Estado | Precio | Stock | Ventas |
|---|---|---|---|---|---|---|
| **Superviviente** | `L10073` | 18/6 (bridge) | activo | ✅ (9.314) | ❌ (solo 419) | ❌ |
| **Absorbido** | `10073` | 12/6 (Excel) | inactivo | 975 | ✅ (4.731) | ✅ (643) |

**Impacto:** 4.404 productos que se venden hoy figuran con stock 0 porque su
stock (~70.363 unidades) quedó atrapado en el gemelo inactivo. La tienda y el POS
los muestran agotados aunque estén en góndola.

## Estrategia de fusión

El **superviviente** es el producto activo con precio (`L...`). Absorbe del gemelo
inactivo: stock (sumando por sucursal), movimientos, ventas, costos, lotes, etc.
El absorbido queda archivado (`activo=false`, ya lo estaba) con `descripcion`
marcada `[fusionado en <surv_id>]` para trazabilidad. **No se borra** (reversible).

Los precios NO se mueven: el superviviente ya tiene los vigentes.

## Dry-run (solo lectura, al 2026-07-02)

| Qué | Cantidad |
|---|---|
| Pares a fusionar | 9.317 |
| Renglones de venta que recuperan historial | 74.248 |
| Movimientos de stock que se reasignan | 4.744 |
| Costos históricos que se reasignan | 1.581 |
| Renglones de pedido | 7 |
| Filas de stock del inactivo | 18.634 |
| Stock: conflictos (misma sucursal en ambos → se **suman**) | 420 |
| Códigos de barra en conflicto (unique) | **0** ✅ |
| Órdenes de compra / lotes del inactivo | 0 |

Sin conflictos de código de barras ni de OC. El único merge no-trivial es el
stock (sumar 420 pares), que la función maneja con upsert.

## Cómo aplicar (sólo tras revisión)

La función `fusionar_producto(surv, abs)` está en `fusion.sql`. Se aplica en lote
con el bloque del final del archivo. Recomendado: correr `fusionar_producto` sobre
1–2 pares primero, verificar, y recién después el lote completo.

**Pendiente aparte:** arreglar la lógica del bridge para que empareje por
`codigo_legacy` y no vuelva a duplicar al re-sincronizar.

## RESULTADO (aplicada el 2026-07-02)

- **9.317/9.317 pares fusionados**, en lotes idempotentes, auditados uno a uno.
- Invariantes verificados: stock total 95.730,455 u (exacto), 78.590 ventas_items,
  4.841 movimientos — sin pérdida alguna.
- Productos activos con stock: ~575 → **4.979**.
- Bridge corregido en `legacy/bridge/sync.mjs` (adopción por sku, update sin
  renombrar sku, flag `SYNC_STOCK=0` para el cutover a la caja nueva).
- Saneo posterior: costos 1.423 → 2.149 activos (backfill desde proveedor_productos),
  mínimos/punto de reposición calculados por velocidad de venta 60d + lead time
  (1.350 filas), vista `sugerencias_compra` con filtro anti-basura
  (13.811 filas nulas → 1.169 sugerencias reales).
- Pendiente de decisión del negocio: 114 filas de stock en inactivos SIN gemelo
  (discontinuados con resto de mercadería).

# Importador del catálogo desde Excel

Migra los 13.000 artículos del Excel actual a la base del sistema: productos, marcas, categorías, códigos de barras, precio minorista y stock inicial por sucursal (como movimiento de "carga inicial", auditable).

## Pasos

1. Copiar el Excel a esta carpeta (ej. `articulos.xlsx`).
2. `cp mapeo.ejemplo.json mapeo.json` y poner en cada campo el **encabezado exacto** de la columna del Excel (`null` si esa columna no existe).
3. `npm install`
4. **Corrida en seco** (no toca la base): `node importar.mjs --dry-run` → revisa `reporte.csv` (duplicados, códigos inválidos, filas sin nombre).
5. Importación real: `DATABASE_URL=postgres://... node importar.mjs`

Todo corre dentro de una transacción: si algo falla a mitad de camino, no queda nada a medias.

## Requisitos previos en la base

- Esquema aplicado ([db/schema.sql](../../db/schema.sql)).
- Las 2 sucursales cargadas en la tabla `sucursales` (el orden define cuál es `stock_sucursal_1` y `stock_sucursal_2` del mapeo).

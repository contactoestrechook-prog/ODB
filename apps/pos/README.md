# apps/pos — Caja (web local-first)

Requisito duro: **vender sin internet**. Catálogo y precios replicados localmente (SQLite/IndexedDB), ventas con UUID generado en el cliente y cola de sincronización idempotente. Facturación ARCA en contingencia (cola/CAEA).

Flujo de venta: escaneo → DNI opcional del cliente (muestra su categoría) → medios de pago combinados (efectivo / MP QR / tarjeta / cta. cte.) → comprobante. Apertura/cierre de caja con arqueo.

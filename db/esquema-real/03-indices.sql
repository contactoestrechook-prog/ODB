-- =============================================================
-- ODB — Esquema real: índices
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-01
-- Fuente: pg_indexes (schema public), excluidos los *_pkey (los crea el PK)
-- y los índices únicos que ya crean las UNIQUE constraints de 02-tablas.sql:
--   acreditaciones_pago_id_key, clientes_codigo_legacy_key, clientes_dni_key,
--   comprobantes_tipo_punto_venta_numero_key, estacionamientos_sucursal_id_numero_key,
--   informes_fecha_key, marcas_nombre_key, productos_codigo_legacy_key,
--   productos_sku_key, proveedores_cuit_key, referidos_referido_id_key,
--   usuarios_email_key
-- Requiere extensión pg_trgm (índices gin_trgm_ops en productos).
-- =============================================================

CREATE INDEX acreditaciones_estado ON public.acreditaciones USING btree (estado, fecha_estimada);
CREATE INDEX acreditaciones_medio ON public.acreditaciones USING btree (medio, creado_en DESC);
CREATE INDEX idx_agente_auditoria_creado ON public.agente_auditoria USING btree (creado_en DESC);
CREATE INDEX idx_agente_auditoria_tarea ON public.agente_auditoria USING btree (tarea_id);
CREATE INDEX idx_agente_tareas_creado ON public.agente_tareas USING btree (creado_en DESC);
CREATE INDEX idx_agente_tareas_estado ON public.agente_tareas USING btree (estado);
CREATE INDEX auditoria_entidad_entidad_id_idx ON public.auditoria USING btree (entidad, entidad_id);
CREATE INDEX avisos_reposicion_pend ON public.avisos_reposicion USING btree (producto_id) WHERE (notificado_en IS NULL);
CREATE UNIQUE INDEX avisos_reposicion_uniq ON public.avisos_reposicion USING btree (cliente_id, producto_id) WHERE (notificado_en IS NULL);
CREATE INDEX caja_movimientos_sesion_idx ON public.caja_movimientos USING btree (sesion_id);
CREATE INDEX canjes_cliente ON public.canjes USING btree (cliente_id, creado_en DESC);
CREATE INDEX idx_cheques_cliente ON public.cheques USING btree (cliente_id);
CREATE INDEX idx_cheques_estado ON public.cheques USING btree (estado);
CREATE INDEX idx_cheques_fecha_cobro ON public.cheques USING btree (fecha_cobro);
CREATE INDEX idx_cheques_op ON public.cheques USING btree (orden_pago_id);
CREATE INDEX idx_cheques_proveedor ON public.cheques USING btree (proveedor_id);
CREATE INDEX idx_cheques_recibo ON public.cheques USING btree (recibo_id);
CREATE INDEX idx_cheques_tipo ON public.cheques USING btree (tipo);
CREATE UNIQUE INDEX clientes_codigo_referido_uniq ON public.clientes USING btree (codigo_referido) WHERE (codigo_referido IS NOT NULL);
CREATE INDEX codigos_barras_codigo_idx ON public.codigos_barras USING btree (codigo);
CREATE INDEX comprobantes_cliente_id_emitido_en_idx ON public.comprobantes USING btree (cliente_id, emitido_en DESC);
CREATE INDEX comprobantes_tipo_emitido_en_idx ON public.comprobantes USING btree (tipo, emitido_en DESC);
CREATE INDEX comprobantes_venta_id_idx ON public.comprobantes USING btree (venta_id);
CREATE INDEX cuenta_corriente_cliente_id_id_idx ON public.cuenta_corriente USING btree (cliente_id, id DESC);
CREATE INDEX descuentos_desde_hasta_idx ON public.descuentos USING btree (desde, hasta) WHERE activo;
CREATE INDEX idx_eventos_cliente ON public.eventos USING btree (cliente_id);
CREATE INDEX idx_eventos_estado ON public.eventos USING btree (estado, fecha);
CREATE INDEX idx_eventos_items ON public.eventos_items USING btree (evento_id);
CREATE INDEX favoritos_cliente_idx ON public.favoritos USING btree (cliente_id);
CREATE INDEX integraciones_log_servicio_creado_en_idx ON public.integraciones_log USING btree (servicio, creado_en DESC);
CREATE INDEX idx_listas_items_ean ON public.listas_proveedor_items USING btree (ean) WHERE (ean IS NOT NULL);
CREATE INDEX lpi_lista ON public.listas_proveedor_items USING btree (lista_id);
CREATE INDEX lpi_producto ON public.listas_proveedor_items USING btree (producto_id);
CREATE INDEX lotes_vencimiento_idx ON public.lotes USING btree (vencimiento);
CREATE INDEX movimientos_stock_producto_id_sucursal_id_creado_en_idx ON public.movimientos_stock USING btree (producto_id, sucursal_id, creado_en DESC);
CREATE INDEX notificaciones_cliente_id_leida_id_idx ON public.notificaciones USING btree (cliente_id, leida, id DESC);
CREATE INDEX pagos_venta ON public.pagos USING btree (venta_id);
CREATE INDEX pedidos_sucursal_id_estado_idx ON public.pedidos USING btree (sucursal_id, estado);
CREATE INDEX precios_producto_id_lista_id_vigente_desde_idx ON public.precios USING btree (producto_id, lista_id, vigente_desde DESC);
CREATE INDEX idx_productos_tiendanube ON public.productos USING btree (tiendanube_id) WHERE (tiendanube_id IS NOT NULL);
CREATE INDEX productos_nombre_norm_trgm ON public.productos USING gin (nombre_normalizado gin_trgm_ops);
CREATE INDEX productos_nombre_trgm ON public.productos USING gin (nombre gin_trgm_ops);
CREATE INDEX productos_sku_trgm ON public.productos USING gin (sku gin_trgm_ops);
CREATE INDEX puntos_mov_cliente ON public.puntos_movimientos USING btree (cliente_id, creado_en DESC);
CREATE UNIQUE INDEX puntos_mov_ref ON public.puntos_movimientos USING btree (referencia);
CREATE INDEX idx_recimp_factura ON public.recibo_imputaciones USING btree (factura_id);
CREATE INDEX idx_recimp_recibo ON public.recibo_imputaciones USING btree (recibo_id);
CREATE INDEX idx_recmed_recibo ON public.recibo_medios USING btree (recibo_id);
CREATE INDEX referidos_referrer ON public.referidos USING btree (referrer_id);
CREATE INDEX paradas_reparto ON public.repartos_paradas USING btree (reparto_id);
CREATE INDEX idx_solicitudes_cliente ON public.solicitudes USING btree (cliente_id, creado_en DESC);
CREATE INDEX idx_solicitudes_estado ON public.solicitudes USING btree (estado, creado_en DESC);
CREATE INDEX idx_sync_runs_corrida ON public.sync_runs USING btree (corrida_en DESC);
CREATE INDEX ventas_cliente_id_vendida_en_idx ON public.ventas USING btree (cliente_id, vendida_en DESC);
CREATE INDEX ventas_sucursal_id_vendida_en_idx ON public.ventas USING btree (sucursal_id, vendida_en DESC);
CREATE INDEX ventas_vendida_en_desc ON public.ventas USING btree (vendida_en DESC);
CREATE INDEX ventas_items_producto ON public.ventas_items USING btree (producto_id);
CREATE INDEX ventas_items_venta ON public.ventas_items USING btree (venta_id);
-- Solo una sesión de caja abierta por caja (P1-04: corta apertura concurrente)
CREATE UNIQUE INDEX ux_sesiones_caja_abierta ON public.sesiones_caja USING btree (caja_id) WHERE (cerrada_en IS NULL);

-- =============================================================
-- ODB — Esquema real: tipos (enums)
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-01
-- Fuente: pg_type / pg_enum (schema public)
-- =============================================================

create type alcance_descuento as enum ('global', 'categoria', 'marca', 'producto');

create type canal_venta as enum ('mostrador', 'self_checkout', 'web', 'whatsapp', 'pickup', 'domicilio');

create type estado_evento as enum ('prospecto', 'propuesta', 'confirmado', 'realizado', 'cancelado');

create type estado_oc as enum ('borrador', 'pendiente_aprobacion', 'aprobada', 'enviada', 'recibida_parcial', 'recibida', 'cancelada');

create type estado_pedido as enum ('recibido', 'pagado', 'en_preparacion', 'listo', 'entregado', 'cancelado', 'en_camino');

create type estado_solicitud as enum ('abierta', 'en_proceso', 'resuelta', 'cerrada');

create type rol_usuario as enum ('dueno', 'gerente', 'comprador', 'cajero', 'deposito', 'repartidor');

create type tipo_cliente as enum ('nuevo', 'ocasional', 'frecuente', 'mayorista', 'vip');

create type tipo_comprobante as enum ('FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC', 'REM', 'REC', 'ANT', 'SIN');

create type tipo_descuento as enum ('porcentaje', 'monto_fijo', 'precio_fijo');

create type tipo_evento as enum ('cumpleanos', 'casamiento', 'corporativo', 'fin_de_ano', 'otro');

create type tipo_movimiento as enum ('venta', 'devolucion', 'compra', 'ajuste', 'merma', 'transferencia_salida', 'transferencia_entrada', 'reserva', 'liberacion_reserva');

create type tipo_solicitud as enum ('devolucion', 'consulta', 'pedido', 'reclamo');

-- ============================================================
-- LA COTIZACIÓN VENCIDA SE RECOTIZA UNA SOLA VEZ (9/10/2026, revisión)
--
-- Cuando el cliente acepta un resumen cuya cotización venció (la base le da 30
-- minutos), el servidor la recotiza en silencio (crearPedido). Para que dos
-- mensajes que llegan a la vez no la recotizen dos veces y creen dos pedidos,
-- el servidor la «toma» con un UPDATE condicional sobre esta columna: solo el
-- que la marca primero recotiza. Columna nueva, sin valores: nada de lo que ya
-- existe cambia.
-- ============================================================
alter table public.bot_cotizaciones add column if not exists recotizada_en timestamptz;
comment on column public.bot_cotizaciones.recotizada_en is 'Cuándo el servidor recotizó esta cotización vencida porque el cliente aceptó el resumen (9/10/2026). Una sola vez por cotización.';

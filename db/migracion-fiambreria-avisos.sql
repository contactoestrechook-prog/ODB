-- Ventana de fiambrería (Leandro, 19/11/2026: «que a las cajas les salga el
-- pop up cada vez que hay un pedido, también a fiambrería si es que hay algo de
-- fiambrería, así lo preparan»).
--
-- Fiambrería recibe la ventana de cada pedido abierto que traiga productos de
-- Fiambres, Quesos o Chacinados. «Lo preparo» la cierra para toda fiambrería y
-- deja quién y cuándo (no toma el pedido entero: el resto lo sigue la caja).
alter table pedidos add column if not exists fiambreria_por uuid references usuarios(id);
alter table pedidos add column if not exists fiambreria_en timestamptz;

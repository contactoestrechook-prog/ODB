-- CONFIRMACIÓN DE ENTREGA DEL PROVEEDOR POR WHATSAPP (Leandro, 23/10/2026).
-- «Cuando la nota de pedido se apruebe, que el bot le mande al proveedor el pedido,
-- le pregunte cuándo lo puede entregar, que confirme por ese medio, y que el
-- sistema registre la fecha. Y un módulo de cuándo vamos a recibir la mercadería».
--
-- Estado de la entrega en cada orden:
--   esperando     → salió el pedido y se espera la fecha del proveedor
--   confirmada    → el proveedor dijo la fecha (entrega_confirmada_para)
--   sin_respuesta → no contestó ni después del recordatorio (aviso a administración)
--   a_revisar     → contestó algo que el bot no supo leer (lo mira una persona)
-- whatsapp_sesion: por qué línea salió el pedido (la respuesta se lee y se
-- contesta por esa misma).
-- Aditiva: sin ella el envío sigue como antes y nada lee estos campos.

alter table ordenes_compra
  add column if not exists whatsapp_sesion text,
  add column if not exists entrega_estado text check (entrega_estado in ('esperando', 'confirmada', 'sin_respuesta', 'a_revisar')),
  add column if not exists entrega_confirmada_para date,
  add column if not exists entrega_horario text,
  add column if not exists entrega_confirmada_en timestamptz,
  add column if not exists entrega_respuesta text,
  add column if not exists entrega_faltantes text,
  add column if not exists entrega_repreguntado_en timestamptz,
  add column if not exists entrega_recordado_en timestamptz;

create index if not exists ordenes_compra_entrega_esperando_idx
  on ordenes_compra (whatsapp_telefono) where entrega_estado = 'esperando';

-- LA PREGUNTA DE UN CLIENTE SUENA EN LA CAJA (21/11/2026).
-- Lo que el bot no sabe ya no va por WhatsApp a administración ni pasa sola a una
-- persona: queda con enviado_a = 'caja' y la ventana del panel la hace sonar en la
-- caja hasta que alguien la contesta. Estas columnas son para esa ventana:
--   archivo_url    lo que mandó el cliente con la pregunta (foto, PDF), para verlo
--   insistio_en    el cliente volvió a preguntar: la caja suena al máximo
--   respondida_por quién la contestó (o la cerró) desde la caja
-- Sin estas columnas el sistema funciona igual (las escrituras se ignoran).

alter table public.bot_consultas_internas add column if not exists archivo_url text;
alter table public.bot_consultas_internas add column if not exists insistio_en timestamptz;
alter table public.bot_consultas_internas add column if not exists respondida_por uuid;

create index if not exists bot_consultas_internas_caja_abiertas
  on public.bot_consultas_internas (creado_en)
  where enviado_a = 'caja' and respondido_en is null;

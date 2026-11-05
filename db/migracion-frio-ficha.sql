-- FRÍO, segunda vuelta (Leandro, 4/11/2026): «más chico todo, prolijo, más info,
-- editable, todo lo que nos permita la API, filtros por equipo».
--   - la ficha de cada equipo se edita desde /frio: lugar, tipo, a los cuántos
--     minutos sin datos se lo da por mudo, a quién avisar y notas;
--   - los rangos que confirmó Leandro el 4/11 reemplazan a los de las alarmas
--     del panel de QBIT (3/11).
-- Los avisos por WhatsApp siguen apagados: «a quién avisar» se guarda para
-- cuando se prendan.
-- Aditiva.

alter table public.frio_equipos
  add column if not exists lugar text,
  add column if not exists tipo text check (tipo is null or tipo in ('congelados', 'refrigerados', 'lacteos', 'bebidas', 'otro')),
  add column if not exists mudo_min int not null default 20 check (mudo_min between 2 and 1440),
  add column if not exists avisar text,
  add column if not exists notas text,
  add column if not exists editado_por uuid references public.usuarios(id),
  add column if not exists editado_en timestamptz;

update public.frio_equipos set minimo = -22, maximo = -15, tipo = 'congelados', lugar = coalesce(lugar, 'Depósito') where idequipo = '2793';
update public.frio_equipos set minimo =   2, maximo =   8, tipo = 'lacteos',    lugar = coalesce(lugar, 'Depósito') where idequipo = '2794';
update public.frio_equipos set minimo = -18, maximo =  -8, tipo = 'congelados', lugar = coalesce(lugar, 'Salón')    where idequipo = '2795';

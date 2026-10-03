-- TODA CONFIRMACIÓN DE PEDIDO SALE AL TELÉFONO DE ADMINISTRACIÓN (regla de
-- Leandro, 3/10/2026). Ese día el bot confirmó PICKUP-5F2451C6C111 (3 picadas,
-- $133.500, retiro el domingo) y no se le avisó a NADIE del local: el aviso no
-- existía. "No puede pasar… que no vuelva a pasar nunca más."
--
-- Cómo queda garantizado:
-- 1. La base: todo pedido nuevo deja un aviso pendiente en avisos_pedidos (un
--    trigger). No depende de qué camino creó el pedido (bot, app, web,
--    PedidosYa, Tiendanube, panel): hoy son dos funciones y mañana pueden ser más.
-- 2. La red de seguridad: encolar_avisos_faltantes() vuelve a mirar los pedidos
--    de las últimas 48 h sin aviso (por si el trigger fallara) y los encola.
-- 3. El API (avisos-pedidos.service.ts) toma los pendientes con
--    tomar_avisos_pedidos() —de a uno por proceso, aunque durante un deploy
--    corran dos—, los manda por WhatsApp a lineas_whatsapp.derivar_pagos_a,
--    reintenta con espera creciente, verifica que el mensaje LLEGÓ (ack de
--    WhatsApp) y, si no sale o no llega en minutos, avisa a los dueños.
--
-- El trigger NUNCA puede trabar un pedido: si el insert del aviso fallara, se
-- deja una advertencia y el pedido sigue; la red de seguridad lo encola después.

create table if not exists public.avisos_pedidos (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  creado_en timestamptz not null default now(),
  -- pendiente → enviado (WhatsApp lo aceptó) → entregado (llegó al teléfono);
  -- omitido: no corresponde avisar (pedido del simulador de PedidosYa)
  estado text not null default 'pendiente',
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  tomado_hasta timestamptz,
  destino text,
  waha_id text,
  enviado_en timestamptz,
  entregado_en timestamptz,
  ack integer,
  incierto boolean not null default false,
  ultimo_error text,
  motivo text,
  escalado_en timestamptz,
  escalado_entrega_en timestamptz
);
create index if not exists avisos_pedidos_estado_idx on public.avisos_pedidos (estado, proximo_intento);
alter table public.avisos_pedidos enable row level security;
revoke all on public.avisos_pedidos from anon, authenticated;
grant all on public.avisos_pedidos to service_role;

create or replace function public.encolar_aviso_pedido()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  begin
    insert into avisos_pedidos(pedido_id) values (new.id) on conflict (pedido_id) do nothing;
  exception when others then
    -- el pedido no se traba nunca por el aviso: lo encola la red de seguridad
    raise warning 'aviso del pedido % no encolado: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.encolar_aviso_pedido() from public, anon, authenticated;

drop trigger if exists pedidos_aviso_administracion on public.pedidos;
create trigger pedidos_aviso_administracion after insert on public.pedidos
  for each row execute function public.encolar_aviso_pedido();

-- Red de seguridad: pedidos de las últimas 48 h sin aviso (devuelve cuántos encoló)
create or replace function public.encolar_avisos_faltantes()
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  with nuevos as (
    insert into avisos_pedidos(pedido_id)
    select p.id from pedidos p
    where p.creado_en > now() - interval '48 hours'
      and not exists (select 1 from avisos_pedidos a where a.pedido_id = p.id)
    on conflict (pedido_id) do nothing
    returning 1
  )
  select count(*)::integer from nuevos;
$function$;

-- Toma avisos para mandar, sin que dos procesos tomen el mismo: los pendientes
-- cuyo próximo intento ya llegó y que tienen al menos 10 segundos (para que el
-- pedido termine de grabarse: los renglones, el total y la dirección de un
-- envío de la app se escriben después del INSERT). La toma dura 2 minutos.
create or replace function public.tomar_avisos_pedidos(p_limite integer default 5)
 returns setof public.avisos_pedidos
 language sql
 security definer
 set search_path to 'public'
as $function$
  update avisos_pedidos a
     set tomado_hasta = now() + interval '2 minutes', intentos = a.intentos + 1
   where a.pedido_id in (
     select x.pedido_id from avisos_pedidos x
      where x.estado = 'pendiente'
        and x.proximo_intento <= now()
        and x.creado_en <= now() - interval '10 seconds'
        and (x.tomado_hasta is null or x.tomado_hasta < now())
      order by x.creado_en
      limit greatest(1, least(p_limite, 20))
      for update skip locked)
  returning a.*;
$function$;

revoke all on function public.encolar_avisos_faltantes() from public, anon, authenticated;
revoke all on function public.tomar_avisos_pedidos(integer) from public, anon, authenticated;
grant execute on function public.encolar_avisos_faltantes() to service_role;
grant execute on function public.tomar_avisos_pedidos(integer) to service_role;

-- Los pedidos activos de los últimos 3 días que ya existían se encolan ahora:
-- el del 3/10 (PICKUP-5F2451C6C111, retiro el 4/10) sale como primer aviso
-- (lo decidió Leandro: "Real, avisa el arreglo").
insert into public.avisos_pedidos(pedido_id)
select id from public.pedidos
where creado_en > now() - interval '3 days' and estado not in ('entregado', 'cancelado')
on conflict (pedido_id) do nothing;

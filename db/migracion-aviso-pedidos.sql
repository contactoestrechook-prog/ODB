-- TODA CONFIRMACIÓN DE PEDIDO SALE AL TELÉFONO DE ADMINISTRACIÓN (regla de
-- Leandro, 3/10/2026). Ese día el bot confirmó PICKUP-5F2451C6C111 (3 picadas,
-- $133.500, retiro el domingo) y no se le avisó a NADIE del local: el aviso no
-- existía. "No puede pasar… que no vuelva a pasar nunca más."
--
-- Versión 2 (misma fecha, después de atacar la primera con agentes): un aviso
-- por (pedido, tipo) —el alta, la BAJA si se cancela después de avisado y el
-- PAGO si se paga por Mercado Pago después de avisado— y avisos SIN pedido (el
-- cliente confirmó y el pedido no se pudo cargar: es el caso en que más falta
-- hace avisar).
--
-- Cómo queda garantizado:
-- 1. La base: el trigger de pedidos deja el aviso pendiente al crear, cancelar o
--    pagar. No depende de qué camino tocó el pedido (bot, app, web, PedidosYa,
--    Tiendanube, panel).
-- 2. La red de seguridad: encolar_avisos_faltantes() vuelve a mirar las últimas
--    48 h y encola lo que falte (por si el trigger fallara).
-- 3. El API (apps/api/src/avisos) toma los pendientes con tomar_avisos_pedidos()
--    —de a uno, aunque corran dos procesos—, los manda por WhatsApp a
--    lineas_whatsapp.derivar_pagos_a, reintenta, verifica que LLEGÓ (ack) y si
--    no sale o no llega escala a los dueños hasta lograrlo, con la franja roja
--    del panel mientras tanto.
--
-- El trigger NUNCA puede trabar un pedido: si el insert del aviso fallara, se
-- deja una advertencia y el pedido sigue; la red de seguridad lo encola después.

-- la versión 1 (aplicada hace un rato, con un solo aviso pendiente: el de las picadas)
drop trigger if exists pedidos_aviso_administracion on public.pedidos;
drop function if exists public.tomar_avisos_pedidos(integer);
drop function if exists public.encolar_avisos_faltantes();
drop table if exists public.avisos_pedidos;

create table public.avisos_pedidos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  -- pedido_nuevo | pedido_cancelado | pedido_pagado | pedido_sin_cargar
  tipo text not null default 'pedido_nuevo',
  -- lo que no está en pedidos (pedido sin cargar: teléfono del chat y la nota)
  detalle jsonb,
  creado_en timestamptz not null default now(),
  -- pendiente → enviado (WhatsApp lo aceptó) → entregado (llegó al teléfono);
  -- omitido: no corresponde (simuladores, pedido cancelado antes de avisar)
  estado text not null default 'pendiente',
  pendiente_desde timestamptz not null default now(),
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  tomado_hasta timestamptz,
  destino text,
  waha_id text,
  waha_ids text[] not null default '{}',
  enviado_en timestamptz,
  entregado_en timestamptz,
  ack integer,
  incierto boolean not null default false,
  ultimo_error text,
  motivo text,
  -- escalamiento a los dueños: se marca SOLO cuando salió; si no, se reintenta
  escalado_en timestamptz,
  escalado_entrega_en timestamptz,
  escalar_intentos integer not null default 0,
  escalar_proximo timestamptz,
  -- "Ya avisé al local" desde la franja roja del panel
  visto_en timestamptz,
  visto_por uuid
);
create unique index avisos_pedidos_pedido_tipo on public.avisos_pedidos (pedido_id, tipo) where pedido_id is not null;
create index avisos_pedidos_estado_idx on public.avisos_pedidos (estado, proximo_intento);
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
    if tg_op = 'INSERT' then
      insert into avisos_pedidos(pedido_id, tipo) values (new.id, 'pedido_nuevo')
        on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
    elsif new.estado = 'cancelado' and old.estado is distinct from 'cancelado' then
      -- la baja se avisa solo si el alta ya salió; si no, el alta se omite al mandarla
      if exists (select 1 from avisos_pedidos where pedido_id = new.id and tipo = 'pedido_nuevo' and estado in ('enviado', 'entregado')) then
        insert into avisos_pedidos(pedido_id, tipo) values (new.id, 'pedido_cancelado')
          on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
      end if;
    elsif new.pagado_en is not null and old.pagado_en is null then
      if exists (select 1 from avisos_pedidos where pedido_id = new.id and tipo = 'pedido_nuevo' and estado in ('enviado', 'entregado')) then
        insert into avisos_pedidos(pedido_id, tipo) values (new.id, 'pedido_pagado')
          on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
      end if;
    end if;
  exception when others then
    -- el pedido no se traba nunca por el aviso: lo encola la red de seguridad
    raise warning 'aviso del pedido % no encolado: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.encolar_aviso_pedido() from public, anon, authenticated;

create trigger pedidos_aviso_administracion after insert or update of estado, pagado_en on public.pedidos
  for each row execute function public.encolar_aviso_pedido();

-- Red de seguridad (últimas 48 h): altas que falten, y bajas y pagos de pedidos
-- cuyo alta ya salió. Devuelve cuántos encoló.
create or replace function public.encolar_avisos_faltantes()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer := 0; m integer;
begin
  insert into avisos_pedidos(pedido_id, tipo)
  select p.id, 'pedido_nuevo' from pedidos p
  where p.creado_en > now() - interval '48 hours'
    and not exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_nuevo')
  on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
  get diagnostics m = row_count; n := n + m;

  insert into avisos_pedidos(pedido_id, tipo)
  select p.id, 'pedido_cancelado' from pedidos p
  where p.creado_en > now() - interval '48 hours' and p.estado = 'cancelado'
    and exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_nuevo' and a.estado in ('enviado', 'entregado'))
    and not exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_cancelado')
  on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
  get diagnostics m = row_count; n := n + m;

  insert into avisos_pedidos(pedido_id, tipo)
  select p.id, 'pedido_pagado' from pedidos p
  where p.creado_en > now() - interval '48 hours' and p.pagado_en is not null
    and exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_nuevo' and a.estado in ('enviado', 'entregado'))
    and not exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_pagado')
  on conflict (pedido_id, tipo) where pedido_id is not null do nothing;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$function$;

-- Toma avisos para mandar, sin que dos procesos tomen el mismo: los pendientes
-- cuyo próximo intento ya llegó y que tienen al menos 10 segundos (para que el
-- pedido termine de grabarse: los renglones, el total y la dirección de un
-- envío de la app se escriben después del INSERT). La toma dura 5 minutos (más
-- que el peor caso de un envío: tres páginas y el texto con WhatsApp lento).
create or replace function public.tomar_avisos_pedidos(p_limite integer default 1)
 returns setof public.avisos_pedidos
 language sql
 security definer
 set search_path to 'public'
as $function$
  update avisos_pedidos a
     set tomado_hasta = now() + interval '5 minutes', intentos = a.intentos + 1
   where a.id in (
     select x.id from avisos_pedidos x
      where x.estado = 'pendiente'
        and x.proximo_intento <= now()
        and x.creado_en <= now() - interval '10 seconds'
        and (x.tomado_hasta is null or x.tomado_hasta < now())
      order by x.creado_en
      limit greatest(1, least(p_limite, 5))
      for update skip locked)
  returning a.*;
$function$;

revoke all on function public.encolar_avisos_faltantes() from public, anon, authenticated;
revoke all on function public.tomar_avisos_pedidos(integer) from public, anon, authenticated;
grant execute on function public.encolar_avisos_faltantes() to service_role;
grant execute on function public.tomar_avisos_pedidos(integer) to service_role;

-- Los pedidos activos de los últimos 3 días: el del 3/10 (PICKUP-5F2451C6C111,
-- retiro el 4/10) sale como primer aviso (lo decidió Leandro: "Real, avisa el arreglo").
insert into public.avisos_pedidos(pedido_id, tipo)
select id, 'pedido_nuevo' from public.pedidos
where creado_en > now() - interval '3 days' and estado not in ('entregado', 'cancelado')
on conflict (pedido_id, tipo) where pedido_id is not null do nothing;

-- Versión 3 (3/10/2026, tras la verificación de la v8 del API): la BAJA y el
-- PAGO se avisan también si el alta quedó pendiente pero alguien ya se enteró
-- por otro medio (se escaló a los dueños, marcaron "Ya avisé al local", o se
-- cortaron los reenvíos por errores de entrega). Antes, con el alta cortada, una
-- cancelación posterior no le llegaba a nadie y el local preparaba un pedido cancelado.
create or replace function public.alta_avisada(p_pedido uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from avisos_pedidos a where a.pedido_id = p_pedido and a.tipo = 'pedido_nuevo'
    and (a.estado in ('enviado', 'entregado')
      or (a.estado = 'pendiente' and (a.escalado_en is not null or a.visto_en is not null or a.proximo_intento = 'infinity'))));
$function$;
revoke all on function public.alta_avisada(uuid) from public, anon, authenticated;
-- encolar_aviso_pedido() y encolar_avisos_faltantes() usan alta_avisada(id) en
-- lugar de "estado in ('enviado', 'entregado')" (aplicado como migración
-- aviso_pedidos_alta_avisada; el cuerpo completo está en la base).

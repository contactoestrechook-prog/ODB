-- DEVOLVER UN PEDIDO Y CONSULTARLE A QUIEN LO ASIGNÓ (Juan Pablo, 20/11/2026:
-- «si tienen que devolver un pedido, si tienen que deshacer algo, si le tienen
-- que hacer una consulta a la persona que se los asignó. Todo eso tiene que
-- estar previsto desde la app»).
--
-- 1. pedidos.devuelto_*: quien arma dice «No lo puedo armar» con el motivo. El
--    pedido queda sin armador (vuelve a «Esperan quién lo arme»), con lo que ya
--    cargó en el carro, y la caja ve quién lo devolvió y por qué hasta que se lo
--    asigna a otra persona.
-- 2. pedidos_mensajes: la charla del pedido entre quien arma (lado 'armado') y
--    la caja (lado 'caja'). Cada mensaje queda con quién lo escribió y cuándo lo
--    vio el otro lado.
-- 3. encolar_aviso_armado_sacado: si el pedido lo devolvió el mismo que lo
--    armaba, no se le manda «YA NO LO ARMÁS» (lo sabe: lo hizo él).
--
-- ORDEN: se aplica ANTES de publicar la API (la API nueva lee estas columnas;
-- la vieja no las mira). Todo es agregado: no cambia nada de lo que existe.

alter table public.pedidos
  add column if not exists devuelto_por uuid references public.usuarios(id),
  add column if not exists devuelto_en timestamptz,
  add column if not exists devuelto_motivo text;

create table if not exists public.pedidos_mensajes (
  id bigserial primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  -- quién lo escribió y desde qué lado: el que arma o la caja
  de uuid references public.usuarios(id),
  lado text not null check (lado in ('armado', 'caja')),
  texto text not null check (char_length(texto) between 1 and 600),
  creado_en timestamptz not null default now(),
  -- cuándo lo vio el otro lado (contestar también lo da por visto)
  visto_en timestamptz,
  visto_por uuid references public.usuarios(id)
);
create index if not exists pedidos_mensajes_pedido on public.pedidos_mensajes (pedido_id, creado_en);
create index if not exists pedidos_mensajes_sin_ver on public.pedidos_mensajes (lado, creado_en) where visto_en is null;

alter table public.pedidos_mensajes enable row level security;
revoke all on public.pedidos_mensajes from anon, authenticated;
revoke all on sequence public.pedidos_mensajes_id_seq from anon, authenticated;

create or replace function public.encolar_aviso_armado_sacado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_motivo text;
begin
  if old.asignado_a is null or old.estado not in ('recibido', 'pagado', 'en_preparacion') then return new; end if;
  if new.estado = 'cancelado' then v_motivo := 'cancelado';
  elsif new.asignado_a is distinct from old.asignado_a then v_motivo := case when new.asignado_a is null then 'sin_asignar' else 'reasignado' end;
  else return new;
  end if;
  -- lo devolvió él mismo («No lo puedo armar», 21/11/2026): no hay nada que avisarle
  if new.asignado_a is null and new.estado <> 'cancelado'
     and new.devuelto_por = old.asignado_a and new.devuelto_en is distinct from old.devuelto_en then
    return new;
  end if;
  -- solo si a esa persona ya le había salido el PEDIDO PARA ARMAR
  if not exists (
    select 1 from avisos_pedidos a
     where a.pedido_id = new.id and a.tipo = 'pedido_asignado'
       and a.detalle->>'usuario_id' = old.asignado_a::text
       and (a.enviado_en is not null or a.entregado_en is not null or coalesce(cardinality(a.waha_ids), 0) > 0)
  ) then return new; end if;

  insert into avisos_pedidos (pedido_id, tipo, detalle)
  values (new.id, 'armado_sacado', jsonb_build_object(
    'usuario_id', old.asignado_a,
    'nombre', (select nombre from usuarios where id = old.asignado_a),
    'motivo', v_motivo,
    'nuevo_id', new.asignado_a,
    'nuevo_nombre', (select nombre from usuarios where id = new.asignado_a)))
  on conflict (pedido_id, tipo) where pedido_id is not null do update set
    detalle = excluded.detalle, estado = 'pendiente', pendiente_desde = now(), proximo_intento = now(), intentos = 0,
    tomado_hasta = null, destino = null, waha_id = null, waha_ids = '{}', enviado_en = null, entregado_en = null,
    ack = null, incierto = false, ultimo_error = null, motivo = null, visto_en = null, visto_por = null;
  return new;
end $$;
revoke all on function public.encolar_aviso_armado_sacado() from public, anon, authenticated;

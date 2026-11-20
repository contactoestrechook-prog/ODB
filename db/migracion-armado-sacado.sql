-- AL QUE LE SACAN UN PEDIDO, UN WHATSAPP (Leandro, 20/11/2026: «le designé el
-- pedido a Alexis y me equivoqué… lo cambié pero a él no le llegó una alerta de
-- que ese pedido fue reasignado a otro compañero; le quedaron los dos pedidos
-- para armar sin avisarle que uno ya lo está preparando otro compañero»).
--
-- Cuando un pedido abierto deja de ser de alguien (se lo pasan a otra persona,
-- se lo sacan o se cancela) y a esa persona YA le había salido el PEDIDO PARA
-- ARMAR, se encola el aviso `armado_sacado` a su celular: «YA NO LO ARMÁS ·
-- PICKUP-…  Alexis, este pedido ahora lo arma Melina: no lo armes». Lo manda la
-- API (avisos-pedidos.service › textoDeSacado); si antes de salir se lo
-- devuelven a la misma persona, se omite.
--
-- Un trigger y no el código de «asignar»: así cubre también la cancelación,
-- venga de donde venga (caja, bot, web, cancelar_pedido). Va en la misma
-- escritura del pedido, ANTES de que «asignar» rearme el pedido_asignado para la
-- persona nueva, así que todavía ve a quién le había llegado.
--
-- ORDEN: aplicar DESPUÉS de publicar la API que conoce `armado_sacado` (una API
-- vieja lo mandaría a administración con otro texto).
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
drop trigger if exists pedidos_aviso_armado_sacado on public.pedidos;
create trigger pedidos_aviso_armado_sacado after update of asignado_a, estado on public.pedidos
  for each row execute function public.encolar_aviso_armado_sacado();

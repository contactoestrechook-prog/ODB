-- EL CIRCUITO ENTRE ÁREAS, parte 2 (6/10/2026): los avisos se cierran solos
-- cuando el hecho se resuelve, y cada pedido sabe por dónde entró.
--
-- Antes: el aviso de un cobro seguía en la campanita después de aprobarlo; el de
-- "el WhatsApp del pedido no salió" seguía después de que llegó o de que alguien
-- marcó "Ya avisé al local". Había que cerrarlos a mano uno por uno, y una
-- campanita llena de cosas resueltas es una campanita que nadie mira (el 1/10
-- tenía 1.673 sin leer).

-- 1. Por dónde entró: lo que se deduce del código al grabarlo (PedidosYa,
--    Tiendanube, cargado a mano); web y app lo graba la API; el bot, abajo.
create or replace function public.origen_por_defecto_pedido()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.origen is null then
    new.origen := case
      when new.qr_retiro like 'PY-%' then 'pedidosya'
      when new.qr_retiro like 'TN-%' then 'tiendanube'
      when new.qr_retiro like 'WA-%' or new.canal = 'whatsapp' then 'panel'
    end;
  end if;
  return new;
end;
$function$;
drop trigger if exists pedidos_origen_por_defecto on public.pedidos;
create trigger pedidos_origen_por_defecto before insert on public.pedidos
  for each row execute function public.origen_por_defecto_pedido();

-- el bot graba el pedido y después le pone el pedido_id a su cotización
create or replace function public.origen_bot_del_pedido()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  begin
    if new.pedido_id is not null and old.pedido_id is distinct from new.pedido_id then
      update pedidos set origen = 'bot' where id = new.pedido_id and origen is null;
    end if;
  exception when others then
    raise warning 'origen del pedido % no grabado: %', new.pedido_id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.origen_bot_del_pedido() from public, anon, authenticated;
drop trigger if exists bot_cotizaciones_origen_pedido on public.bot_cotizaciones;
create trigger bot_cotizaciones_origen_pedido after update of pedido_id on public.bot_cotizaciones
  for each row execute function public.origen_bot_del_pedido();

-- 2. "El WhatsApp del pedido no salió / no llegó": se cierra cuando llega, o
--    cuando alguien marca "Ya avisé al local" (queda su nombre).
create or replace function public.cerrar_alerta_aviso_resuelto()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  begin
    if (new.estado = 'entregado' and old.estado is distinct from 'entregado')
       or (new.visto_en is not null and old.visto_en is null) then
      update alertas_internas set leida_en = now(), leida_por = coalesce(leida_por, new.visto_por)
       where tipo = 'pedido_sin_aviso' and referencia->>'aviso_id' = new.id::text and leida_en is null;
    end if;
  exception when others then
    raise warning 'alerta del aviso % no cerrada: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.cerrar_alerta_aviso_resuelto() from public, anon, authenticated;
drop trigger if exists avisos_pedidos_cierra_alerta on public.avisos_pedidos;
create trigger avisos_pedidos_cierra_alerta after update of estado, visto_en on public.avisos_pedidos
  for each row execute function public.cerrar_alerta_aviso_resuelto();

-- 3. Cobros: el aviso del comprobante (bot) y el de "cobro a ingresar" (caja)
--    se cierran cuando el dueño lo aprueba o lo rechaza, a nombre de quien lo resolvió.
create or replace function public.cerrar_alertas_de_cobranza()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  begin
    if new.estado is distinct from old.estado and new.estado <> 'pendiente' then
      update alertas_internas set leida_en = now(), leida_por = new.resuelta_por
       where tipo in ('pago', 'cobranza') and referencia->>'cobranzaId' = new.id::text and leida_en is null;
    end if;
  exception when others then
    raise warning 'alertas del cobro % no cerradas: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.cerrar_alertas_de_cobranza() from public, anon, authenticated;
drop trigger if exists cobranzas_cierran_alertas on public.cobranzas_pendientes;
create trigger cobranzas_cierran_alertas after update of estado on public.cobranzas_pendientes
  for each row execute function public.cerrar_alertas_de_cobranza();

-- PEDIDO DE UN PROBADOR = PEDIDO DE PRUEBA (Leandro, 20/11/2026). APLICADA por
-- MCP en utemmsmuwocerhmuxrbs como pedido_de_probador_es_prueba(_texto).
--
-- «Hice un pedido desde el celular antes mencionado, necesito que figure que es
-- una prueba» y «el pedido lo voy a realizar pero no facturar, así sé si los
-- códigos funcionan». Si la cotización del bot que se confirma es de un
-- contacto con la etiqueta «probador» (bot_contactos.etiquetas, ver
-- apps/api/src/bot/pausa.ts › esProbador), el pedido queda con origen
-- 'simulador': el panel lo muestra «PRUEBA · no es un pedido real» y no deja
-- pasarlo a entregado (pedidos.service › ORIGEN_PRUEBA). Se asigna y se arma
-- como cualquiera (para probar el escaneo); al terminar la prueba se cancela.
create or replace function public.marcar_pedido_de_probador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pedido_id is not null
     and (tg_op = 'INSERT' or old.pedido_id is distinct from new.pedido_id)
     and exists (select 1 from bot_contactos k where k.telefono = new.telefono and 'probador' = any(coalesce(k.etiquetas, '{}'::text[]))) then
    update pedidos
       set origen = 'simulador',
           notas = case when coalesce(notas, '') ilike 'PRUEBA%' then notas
                        else 'PRUEBA — se arma pero NO se cobra ni se entrega (simulacro). ' || coalesce(notas, '') end
     where id = new.pedido_id;
  end if;
  return new;
end $$;
revoke all on function public.marcar_pedido_de_probador() from public, anon, authenticated;
drop trigger if exists trg_cotizacion_probador on public.bot_cotizaciones;
create trigger trg_cotizacion_probador after insert or update of pedido_id on public.bot_cotizaciones
  for each row execute function public.marcar_pedido_de_probador();

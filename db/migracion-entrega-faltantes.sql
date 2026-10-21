-- AL ENTREGAR, SI FALTA ALGO: SACARLO O REEMPLAZARLO (Leandro, 21/10/2026)
--
-- Ese día alguien apretó 4 veces "Entregar" en un pedido y el sistema contestó
-- cuatro veces "Stock insuficiente: la operación dejaría -6.000 unidades", sin
-- decir de qué producto ni qué hacer. Leandro: "que el sistema sea inteligente:
-- si voy a entregar y no hay algo en stock, que pregunte qué hacemos con esto y
-- que dé la opción de sacarlo o reemplazarlo, nada más".
--
-- 1. faltantes_pedido(pedido): los productos del pedido que no alcanzan en la
--    sucursal del pedido (cuenta lo que el propio pedido tiene reservado). El API
--    la consulta ANTES de entregar y, si hay, devuelve la lista en vez de fallar.
-- 2. resolver_faltante_pedido(pedido, producto, reemplazo?, cantidad?, usuario):
--    en una sola transacción, con la fila del pedido bloqueada, saca del pedido
--    lo que falta (si hay 2 de 6, quedan las 2) y, si se eligió, pone el
--    reemplazo al precio vigente. Ajusta la reserva, el total por diferencia
--    (no se recalcula de cero: así no se pierde un costo de envío) y deja el
--    cambio en el historial con quién lo hizo.

create or replace function public.faltantes_pedido(p_pedido uuid)
 returns table(producto_id uuid, sku text, nombre text, pide numeric, hay numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select i.producto_id, pr.sku, pr.nombre, sum(i.cantidad) as pide,
         greatest(coalesce(s.cantidad, 0) + case when p.reserva_stock then sum(i.cantidad) else 0 end, 0) as hay
    from pedidos p
    join pedidos_items i on i.pedido_id = p.id
    join productos pr on pr.id = i.producto_id
    left join stock s on s.producto_id = i.producto_id and s.sucursal_id = p.sucursal_id
   where p.id = p_pedido
   group by i.producto_id, pr.sku, pr.nombre, s.cantidad, p.reserva_stock
  having coalesce(s.cantidad, 0) + case when p.reserva_stock then sum(i.cantidad) else 0 end < sum(i.cantidad)
   order by pr.nombre;
$function$;

create or replace function public.resolver_faltante_pedido(
  p_pedido uuid, p_producto uuid, p_reemplazo uuid default null,
  p_cantidad numeric default null, p_usuario uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_nombre text; v_precio_viejo numeric; v_pide numeric; v_hay numeric; v_saca numeric;
  v_nuevo productos%rowtype; v_cant numeric; v_precio numeric; v_hay_nuevo numeric; v_ya numeric;
  v_segmento tipo_cliente; v_verificado boolean := false; v_medio text;
  v_total_antes numeric; v_total numeric; v_quedan int;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.estado in ('entregado', 'cancelado') or v_pedido.venta_id is not null then
    raise exception 'El pedido ya está %: no se le pueden cambiar los productos', v_pedido.estado;
  end if;

  select pr.nombre, i.cantidad, i.precio_unitario into v_nombre, v_pide, v_precio_viejo
    from pedidos_items i join productos pr on pr.id = i.producto_id
   where i.pedido_id = p_pedido and i.producto_id = p_producto;
  if not found then raise exception 'Ese producto ya no está en el pedido: actualizá la pantalla'; end if;

  select greatest(coalesce(s.cantidad, 0) + case when v_pedido.reserva_stock then v_pide else 0 end, 0) into v_hay
    from (select 1) x left join stock s on s.producto_id = p_producto and s.sucursal_id = v_pedido.sucursal_id;
  if v_hay >= v_pide then
    raise exception 'Ya hay stock de % para este pedido: actualizá la pantalla y entregalo', v_nombre;
  end if;
  v_saca := v_pide - v_hay;

  -- con el mismo criterio de precio que la entrega
  if v_pedido.cliente_id is not null then
    select tipo, verificado into v_segmento, v_verificado from clientes where id = v_pedido.cliente_id;
  end if;
  v_medio := case when v_pedido.qr_retiro like 'PY-%' then 'pedidosya'
                  when v_pedido.pagado_en is not null then 'mercadopago' end;
  if v_precio_viejo is null then
    select pv.precio_final into v_precio_viejo
      from precio_vigente(p_producto, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv;
  end if;

  -- 1. sacar lo que falta (si quedaba algo, el renglón sigue con lo que hay)
  if v_hay > 0 then
    update pedidos_items set cantidad = v_hay where pedido_id = p_pedido and producto_id = p_producto;
  else
    delete from pedidos_items where pedido_id = p_pedido and producto_id = p_producto;
  end if;
  if v_pedido.reserva_stock then
    perform registrar_movimiento(p_producto, v_pedido.sucursal_id, 'liberacion_reserva', v_saca,
      null, 'pedido', p_pedido::text, p_usuario);
  end if;
  v_total_antes := coalesce(v_pedido.total, 0);
  v_total := v_total_antes - round(v_saca * coalesce(v_precio_viejo, 0), 2);

  -- 2. el reemplazo, si se eligió
  if p_reemplazo is not null then
    if p_reemplazo = p_producto then raise exception 'El reemplazo tiene que ser otro producto'; end if;
    select * into v_nuevo from productos where id = p_reemplazo;
    if not found or v_nuevo.activo is false then raise exception 'Ese producto no existe o está dado de baja'; end if;
    v_cant := coalesce(p_cantidad, v_saca);
    if v_cant <= 0 then raise exception 'La cantidad del reemplazo tiene que ser mayor que 0'; end if;

    select coalesce(i.cantidad, 0) into v_ya from (select 1) x
      left join pedidos_items i on i.pedido_id = p_pedido and i.producto_id = p_reemplazo;
    select coalesce(s.cantidad, 0) + case when v_pedido.reserva_stock then v_ya else 0 end into v_hay_nuevo
      from (select 1) x left join stock s on s.producto_id = p_reemplazo and s.sucursal_id = v_pedido.sucursal_id;
    if v_hay_nuevo < v_ya + v_cant then
      raise exception 'Tampoco alcanza % en la sucursal: hay %', v_nuevo.nombre, greatest(v_hay_nuevo - v_ya, 0);
    end if;

    select pv.precio_final into v_precio
      from precio_vigente(p_reemplazo, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv;
    if v_precio is null then raise exception '% no tiene precio cargado: elegí otro', v_nuevo.nombre; end if;

    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario)
    values (p_pedido, p_reemplazo, v_cant, round(v_precio, 2))
    on conflict (pedido_id, producto_id) do update set cantidad = pedidos_items.cantidad + excluded.cantidad;
    if v_pedido.reserva_stock then
      perform registrar_movimiento(p_reemplazo, v_pedido.sucursal_id, 'reserva', -v_cant,
        null, 'pedido', p_pedido::text, p_usuario);
    end if;
    -- si ya estaba en el pedido, el agregado va a su precio de siempre
    select coalesce(precio_unitario, round(v_precio, 2)) into v_precio
      from pedidos_items where pedido_id = p_pedido and producto_id = p_reemplazo;
    v_total := v_total + round(v_cant * v_precio, 2);
  end if;

  select count(*) into v_quedan from pedidos_items where pedido_id = p_pedido;
  if v_quedan = 0 then
    raise exception 'No queda ningún producto en el pedido: si no hay nada para darle, cancelá el pedido';
  end if;

  v_total := greatest(round(v_total, 2), 0);
  update pedidos set total = v_total, cambio_por = coalesce(p_usuario, cambio_por), cambio_en = now()
   where id = p_pedido;

  insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
  values (p_pedido, 'productos', v_pedido.estado::text, p_usuario, jsonb_build_object(
    'saco', jsonb_build_object('producto_id', p_producto, 'nombre', v_nombre, 'cantidad', v_saca),
    'puso', case when p_reemplazo is null then null
                 else jsonb_build_object('producto_id', p_reemplazo, 'nombre', v_nuevo.nombre, 'cantidad', v_cant) end,
    'total_antes', v_total_antes, 'total', v_total,
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%'));

  return jsonb_build_object(
    'saco', jsonb_build_object('nombre', v_nombre, 'cantidad', v_saca),
    'puso', case when p_reemplazo is null then null else jsonb_build_object('nombre', v_nuevo.nombre, 'cantidad', v_cant) end,
    'totalAntes', v_total_antes, 'total', v_total,
    -- pagado de antemano (Mercado Pago o PedidosYa): la diferencia se arregla con el cliente
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%');
end $function$;

revoke all on function public.faltantes_pedido(uuid) from public, anon, authenticated;
revoke all on function public.resolver_faltante_pedido(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.faltantes_pedido(uuid) to service_role;
grant execute on function public.resolver_faltante_pedido(uuid, uuid, uuid, numeric, uuid) to service_role;

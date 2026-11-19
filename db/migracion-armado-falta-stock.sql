-- ============================================================
-- ODB — Al armar, el que arma cambia lo que no hay (19/11/2026)
--
-- Leandro: «el que arma el pedido tiene que poder modificar artículos por
-- falta de stock». Ya existía resolver_faltante_pedido (al entregar: sacar lo
-- que no hay o cambiarlo por otro), pero se niega si el SISTEMA dice que hay
-- («Ya hay stock de … para este pedido»): sirve para el reparto, no para el
-- que está frente a la góndola vacía. Y el que arma (salón, fiambrería) no
-- tenía permiso.
--
-- resolver_falta_armado hace lo mismo pero con lo que HAY de verdad:
--   · p_hay: cuánto hay en la góndola (0 = no hay nada). El renglón queda con
--     eso; si es 0, sale del pedido (y del carro).
--   · p_reemplazo / p_cantidad: si se eligió otro producto en su lugar, entra
--     con su precio vigente (mismo criterio que la entrega). No se frena por el
--     stock del sistema: lo tiene en la mano el que arma.
--   · El total del pedido se recalcula; si el pedido ya estaba pagado (Mercado
--     Pago o PedidosYa) lo dice, para que la caja arregle la diferencia.
--   · En el historial queda qué se sacó, qué se puso, cuánto había y cuánto
--     decía el sistema (para revisar el stock).
-- ============================================================

create or replace function public.resolver_falta_armado(
  p_pedido uuid, p_producto uuid, p_hay numeric default 0,
  p_reemplazo uuid default null, p_cantidad numeric default null, p_usuario uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_nombre text; v_precio_viejo numeric; v_pide numeric; v_hay numeric; v_saca numeric; v_sistema numeric;
  v_nuevo productos%rowtype; v_cant numeric; v_precio numeric;
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

  v_hay := coalesce(p_hay, 0);
  if v_hay < 0 then raise exception 'Lo que hay no puede ser menos de 0'; end if;
  if v_hay >= v_pide then raise exception 'Si hay % o más, no falta nada de %', trim_scale(v_pide), v_nombre; end if;
  v_saca := v_pide - v_hay;
  -- lo que decía el sistema (para el historial: si no coincide, hay que revisar el stock)
  select coalesce(s.cantidad, 0) + case when v_pedido.reserva_stock then v_pide else 0 end into v_sistema
    from (select 1) x left join stock s on s.producto_id = p_producto and s.sucursal_id = v_pedido.sucursal_id;

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

  -- 1. lo que no hay sale del pedido (si hay algo, el renglón queda con eso)
  if v_hay > 0 then
    update pedidos_items set cantidad = v_hay where pedido_id = p_pedido and producto_id = p_producto;
  else
    delete from pedidos_items where pedido_id = p_pedido and producto_id = p_producto;
    delete from pedidos_carro where pedido_id = p_pedido and producto_id = p_producto;
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
    raise exception 'No queda ningún producto en el pedido: avisale a la caja para que lo cancele';
  end if;

  v_total := greatest(round(v_total, 2), 0);
  update pedidos set total = v_total, cambio_por = coalesce(p_usuario, cambio_por), cambio_en = now()
   where id = p_pedido;

  insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
  values (p_pedido, 'productos', v_pedido.estado::text, p_usuario, jsonb_build_object(
    'donde', 'armado',
    'saco', jsonb_build_object('producto_id', p_producto, 'nombre', v_nombre, 'cantidad', v_saca),
    'puso', case when p_reemplazo is null then null
                 else jsonb_build_object('producto_id', p_reemplazo, 'nombre', v_nuevo.nombre, 'cantidad', v_cant) end,
    'habia', v_hay, 'decia_el_sistema', v_sistema,
    'total_antes', v_total_antes, 'total', v_total,
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%'));

  return jsonb_build_object(
    'saco', jsonb_build_object('nombre', v_nombre, 'cantidad', v_saca),
    'quedo', v_hay,
    'puso', case when p_reemplazo is null then null else jsonb_build_object('nombre', v_nuevo.nombre, 'cantidad', v_cant) end,
    'totalAntes', v_total_antes, 'total', v_total,
    'sistemaDecia', v_sistema,
    -- pagado de antemano (Mercado Pago o PedidosYa): la diferencia se arregla con el cliente
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%');
end;
$function$;

revoke all on function public.resolver_falta_armado(uuid, uuid, numeric, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.resolver_falta_armado(uuid, uuid, numeric, uuid, numeric, uuid) to service_role;

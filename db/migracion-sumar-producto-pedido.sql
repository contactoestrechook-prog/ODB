-- SUMAR UN PRODUCTO A UN PEDIDO QUE YA ENTRÓ (25/11/2026). Leandro: «necesito que si un cliente
-- agrega algo exista la posibilidad de sumar el producto». El caso: DOM-151CAD773262 (St Thomas
-- Oeste 623); la clienta sumó 4 bidones Villa del Sur por WhatsApp y el pedido ya estaba cargado
-- y armándose. Hasta hoy un pedido solo podía perder productos (el faltante) o cambiarlos por un
-- parecido; sumar, no.
--
-- Lo mismo que hace el «puso» de resolver_faltante_pedido, sin sacar nada: precio de lista del
-- momento (el del segmento del cliente), reserva de stock si el pedido reserva, total nuevo y la
-- línea en el historial (evento 'agregado'). Si el producto ya estaba, suma a ese renglón.
-- No se puede en un pedido entregado, cancelado, con venta o ya pagado (el cobro no cubriría lo nuevo).
--
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (sumar_producto_pedido).
create or replace function public.sumar_producto_pedido(p_pedido uuid, p_producto uuid, p_cantidad numeric, p_usuario uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_prod productos%rowtype;
  v_segmento tipo_cliente; v_verificado boolean := false;
  v_precio numeric; v_hay numeric; v_ya numeric; v_ya_r numeric;
  v_total_antes numeric; v_total numeric;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.estado in ('entregado', 'cancelado') or v_pedido.venta_id is not null then
    raise exception 'El pedido ya está %: no se le pueden sumar productos', v_pedido.estado;
  end if;
  if v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%' then
    raise exception 'El pedido ya está pagado: lo nuevo va en otro pedido';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 9999 then
    raise exception 'La cantidad tiene que ser mayor que 0';
  end if;
  select * into v_prod from productos where id = p_producto;
  if not found or v_prod.activo is false then raise exception 'Ese producto no existe o está dado de baja'; end if;

  if v_pedido.cliente_id is not null then
    select tipo, verificado into v_segmento, v_verificado from clientes where id = v_pedido.cliente_id;
  end if;

  select coalesce(i.cantidad, 0), coalesce(reservado_del_renglon(v_pedido.reserva_stock, i.cantidad, i.reservado), 0)
    into v_ya, v_ya_r from (select 1) x
    left join pedidos_items i on i.pedido_id = p_pedido and i.producto_id = p_producto;
  select greatest(coalesce(s.cantidad, 0), 0) into v_hay
    from (select 1) x left join stock s on s.producto_id = p_producto and s.sucursal_id = v_pedido.sucursal_id;
  if v_hay < (v_ya - v_ya_r) + p_cantidad then
    raise exception 'No alcanza % en la sucursal: hay %', v_prod.nombre, greatest(v_hay - (v_ya - v_ya_r), 0);
  end if;

  select pv.precio_final into v_precio
    from precio_vigente(p_producto, now(), v_segmento, null, coalesce(v_verificado, false), false) pv;
  if v_precio is null then raise exception '% no tiene precio cargado', v_prod.nombre; end if;

  insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario, reservado)
  values (p_pedido, p_producto, p_cantidad, round(v_precio, 2), case when v_pedido.reserva_stock then p_cantidad end)
  on conflict (pedido_id, producto_id) do update set
    cantidad = pedidos_items.cantidad + excluded.cantidad,
    reservado = case when v_pedido.reserva_stock then v_ya_r + p_cantidad else pedidos_items.reservado end;
  if v_pedido.reserva_stock then
    perform registrar_movimiento(p_producto, v_pedido.sucursal_id, 'reserva', -p_cantidad, null, 'pedido', p_pedido::text, p_usuario);
  end if;
  -- si ya estaba, el renglón conserva su precio
  select coalesce(precio_unitario, round(v_precio, 2)) into v_precio from pedidos_items where pedido_id = p_pedido and producto_id = p_producto;

  v_total_antes := coalesce(v_pedido.total, 0);
  v_total := round(v_total_antes + p_cantidad * v_precio, 2);
  update pedidos set total = v_total, cambio_por = coalesce(p_usuario, cambio_por), cambio_en = now() where id = p_pedido;
  insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
  values (p_pedido, 'agregado', v_pedido.estado::text, p_usuario, jsonb_build_object(
    'puso', jsonb_build_object('producto_id', p_producto, 'nombre', v_prod.nombre, 'cantidad', p_cantidad, 'precio', v_precio),
    'total_antes', v_total_antes, 'total', v_total));
  return jsonb_build_object('nombre', v_prod.nombre, 'cantidad', p_cantidad, 'precio', v_precio, 'totalAntes', v_total_antes, 'total', v_total,
                            'asignadoA', v_pedido.asignado_a, 'estado', v_pedido.estado);
end;
$function$;
revoke all on function public.sumar_producto_pedido(uuid, uuid, numeric, uuid) from public, anon, authenticated;

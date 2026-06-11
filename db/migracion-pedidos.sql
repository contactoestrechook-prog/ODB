-- Migración: pipeline de pedidos externos (PedidosYa / web / pick-up)
-- Parte 1 (correr sola, fuera de transacción):
alter type canal_venta add value if not exists 'pedidosya';

-- Parte 2:
alter table pedidos add column if not exists referencia_externa text;
alter table pedidos add column if not exists notas text;

-- Crear pedido con reserva de stock (el disponible baja, la venta se registra al entregar)
create or replace function crear_pedido(
  p_canal canal_venta,
  p_sucursal uuid,
  p_items jsonb,              -- [{producto_id, cantidad}]
  p_cliente_dni text default null,
  p_referencia text default null,
  p_notas text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_cliente_id uuid;
  v_item record;
  v_pv record;
  v_total numeric := 0;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  if p_referencia is not null and exists (
    select 1 from pedidos where referencia_externa = p_referencia
  ) then
    return (select jsonb_build_object('pedido_id', id, 'duplicado', true)
            from pedidos where referencia_externa = p_referencia);
  end if;

  if p_cliente_dni is not null and trim(p_cliente_dni) <> '' then
    select id into v_cliente_id from clientes where dni = trim(p_cliente_dni);
    if not found then
      insert into clientes (dni) values (trim(p_cliente_dni)) returning id into v_cliente_id;
    end if;
  end if;

  insert into pedidos (id, cliente_id, canal, sucursal_id, estado, total, referencia_externa, notas, qr_retiro)
  values (v_id, v_cliente_id, p_canal, p_sucursal, 'recibido', 0, p_referencia, p_notas,
          encode(extensions.digest(v_id::text || clock_timestamp()::text, 'sha256'), 'hex'));

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    select * into v_pv from precio_vigente(v_item.producto_id);
    if v_pv.precio_lista is null then
      raise exception 'El producto % no tiene precio', v_item.producto_id;
    end if;
    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario)
    values (v_id, v_item.producto_id, v_item.cantidad, round(v_pv.precio_final, 2));
    v_total := v_total + round(v_item.cantidad * v_pv.precio_final, 2);
    perform registrar_movimiento(
      v_item.producto_id, p_sucursal, 'reserva', -v_item.cantidad,
      null, 'pedido', v_id::text, null);
  end loop;

  update pedidos set total = v_total where id = v_id;
  return jsonb_build_object('pedido_id', v_id, 'total', v_total);
end $$;

-- Avance de estados con transiciones válidas; al entregar registra la venta
create or replace function avanzar_pedido(
  p_pedido uuid,
  p_estado estado_pedido,
  p_usuario uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pedido pedidos%rowtype;
  v_item record;
  v_items jsonb := '[]'::jsonb;
  v_medio text;
  v_res jsonb;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;

  if not (
    (v_pedido.estado = 'recibido' and p_estado in ('en_preparacion','cancelado')) or
    (v_pedido.estado = 'pagado' and p_estado in ('en_preparacion','cancelado')) or
    (v_pedido.estado = 'en_preparacion' and p_estado in ('listo','cancelado')) or
    (v_pedido.estado = 'listo' and p_estado in ('entregado','cancelado'))
  ) then
    raise exception 'Transición inválida: % -> %', v_pedido.estado, p_estado;
  end if;

  if p_estado in ('entregado','cancelado') then
    for v_item in select producto_id, cantidad from pedidos_items where pedido_id = p_pedido loop
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_item.cantidad,
        null, 'pedido', p_pedido::text, p_usuario);
      if p_estado = 'entregado' then
        v_items := v_items || jsonb_build_object('producto_id', v_item.producto_id, 'cantidad', v_item.cantidad);
      end if;
    end loop;
  end if;

  if p_estado = 'entregado' then
    v_medio := case when v_pedido.canal = 'pedidosya' then 'pedidosya' else 'mercadopago' end;
    -- el monto se calcula con la MISMA lógica que registrar_venta
    -- (precio_vigente con segmento del cliente y medio de pago) para que cierre exacto
    declare
      v_dni text := (select dni from clientes where id = v_pedido.cliente_id);
      v_segmento tipo_cliente := (select tipo from clientes where id = v_pedido.cliente_id);
      v_monto numeric := 0;
      v_pi record;
    begin
      for v_pi in select producto_id, cantidad from pedidos_items where pedido_id = p_pedido loop
        v_monto := v_monto + round(
          v_pi.cantidad * (select precio_final from precio_vigente(v_pi.producto_id, now(), v_segmento, v_medio)), 2);
      end loop;
      v_res := registrar_venta(
        v_pedido.sucursal_id, v_items,
        jsonb_build_array(jsonb_build_object('medio', v_medio, 'monto', v_monto)),
        v_pedido.canal, v_dni, null, p_usuario, null);
    end;
    update pedidos set estado = p_estado, entregado_en = now() where id = p_pedido;
    return jsonb_build_object('estado', p_estado, 'venta', v_res);
  end if;

  update pedidos set estado = p_estado,
    listo_en = case when p_estado = 'listo' then now() else listo_en end
  where id = p_pedido;
  return jsonb_build_object('estado', p_estado);
end $$;

revoke execute on function crear_pedido(canal_venta,uuid,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function avanzar_pedido(uuid,estado_pedido,uuid) from public, anon, authenticated;
-- ============================================================
-- ODB — Reservar lo que hay (20/11/2026)
--
-- Leandro: «Sí, reservá lo que hay». Hasta hoy la reserva era todo o nada: si
-- a un pedido pasado desde la charla le faltaba UN producto, se creaba sin
-- reservar ninguno (el de Andrea, DOM-87B017B4EA14: faltaban el Adler y el pan,
-- y los otros 27 tampoco quedaron reservados: se podían vender en el mostrador
-- mientras se armaba).
--
-- Ahora cada renglón dice cuánto reservó (pedidos_items.reservado):
--   · NULL: lo de siempre (todo, si el pedido reserva; nada, si no). Así quedan
--     todos los pedidos que ya existen y los que crean el bot y la web.
--   · un número: lo reservado de verdad (puede ser menos que lo pedido).
-- reservado_del_renglon() es la única cuenta y la usan todas las funciones que
-- reservan, liberan o miran lo reservado: crear desde la charla
-- (reservar_lo_que_hay), cancelar, entregar, faltantes, los dos «falta stock»
-- y el control de fracciones.
-- ============================================================

alter table public.pedidos_items add column if not exists reservado numeric check (reservado is null or reservado >= 0);
comment on column public.pedidos_items.reservado is
  'Cuánto de este renglón está reservado (20/11/2026). NULL: todo si el pedido reserva, nada si no.';

create or replace function public.reservado_del_renglon(p_reserva boolean, p_cantidad numeric, p_reservado numeric)
 returns numeric language sql immutable
as $$ select coalesce(p_reservado, case when p_reserva then p_cantidad else 0 end) $$;

-- Reserva, renglón por renglón, lo que hay en la sucursal (hasta lo pedido).
-- Para un pedido recién creado sin reserva. Devuelve lo que no alcanzó.
create or replace function public.reservar_lo_que_hay(p_pedido uuid, p_usuario uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_item record; v_disp numeric; v_r numeric;
  v_faltas jsonb := '[]'::jsonb; v_reservados int := 0;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.reserva_stock then
    return jsonb_build_object('yaReservaba', true, 'faltas', '[]'::jsonb);
  end if;
  for v_item in
    select i.producto_id, i.cantidad, pr.nombre from pedidos_items i join productos pr on pr.id = i.producto_id
     where i.pedido_id = p_pedido for update of i
  loop
    select greatest(coalesce(s.cantidad, 0), 0) into v_disp
      from (select 1) x left join stock s on s.producto_id = v_item.producto_id and s.sucursal_id = v_pedido.sucursal_id;
    v_r := least(v_item.cantidad, v_disp);
    if v_r > 0 then
      perform registrar_movimiento(v_item.producto_id, v_pedido.sucursal_id, 'reserva', -v_r,
        null, 'pedido', p_pedido::text, p_usuario);
      v_reservados := v_reservados + 1;
    end if;
    update pedidos_items set reservado = v_r where pedido_id = p_pedido and producto_id = v_item.producto_id;
    if v_r < v_item.cantidad then
      v_faltas := v_faltas || jsonb_build_object('producto_id', v_item.producto_id, 'nombre', v_item.nombre, 'pide', v_item.cantidad, 'hay', v_r);
    end if;
  end loop;
  update pedidos set reserva_stock = true where id = p_pedido;
  return jsonb_build_object('reservados', v_reservados, 'faltas', v_faltas);
end;
$function$;

-- Cancelar: se devuelve exactamente lo reservado de cada renglón.
create or replace function public.cancelar_pedido(p_pedido uuid, p_usuario uuid default null::uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_item record;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;

  if v_pedido.estado = 'cancelado' then
    return jsonb_build_object('pedido_id', p_pedido, 'estado', 'cancelado', 'duplicada', true);
  end if;
  if v_pedido.estado not in ('recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino') then
    raise exception 'Transicion invalida: % -> cancelado', v_pedido.estado;
  end if;

  for v_item in
    select producto_id, reservado_del_renglon(v_pedido.reserva_stock, cantidad, reservado) r
      from pedidos_items where pedido_id = p_pedido
  loop
    if v_item.r > 0 then
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_item.r,
        null, 'pedido', p_pedido::text, p_usuario);
    end if;
  end loop;
  perform liberar_estacionamiento(p_pedido);

  update pedidos set estado = 'cancelado', cambio_por = p_usuario, cambio_en = now() where id = p_pedido;
  update alertas_internas set leida_en = now(), leida_por = p_usuario
   where tipo = 'pedido_sin_tomar' and referencia->>'pedido_id' = p_pedido::text and leida_en is null;
  return jsonb_build_object('pedido_id', p_pedido, 'estado', 'cancelado');
end $function$;

-- Entregar: se libera lo reservado de cada renglón y se vende todo (registrar_venta descuenta).
create or replace function public.entregar_pedido(p_pedido uuid, p_usuario uuid default null::uuid, p_medio text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_item record;
  v_medio text;
  v_segmento tipo_cliente;
  v_verificado boolean := false;
  v_dni text;
  v_precio numeric;
  v_total numeric := 0;
  v_sesion uuid;
  v_venta_id uuid;
  v_venta jsonb;
  v_r numeric;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;

  if v_pedido.estado = 'entregado' and v_pedido.venta_id is not null then
    return jsonb_build_object('pedido_id', p_pedido, 'venta_id', v_pedido.venta_id, 'estado', 'entregado', 'duplicada', true);
  end if;
  if v_pedido.estado not in ('listo', 'en_camino') then
    raise exception 'Transicion invalida: % -> entregado', v_pedido.estado;
  end if;

  if v_pedido.cliente_id is not null then
    select tipo, verificado, dni into v_segmento, v_verificado, v_dni
    from clientes where id = v_pedido.cliente_id;
  end if;

  v_medio := case
    when v_pedido.qr_retiro like 'PY-%' then 'pedidosya'
    when v_pedido.pagado_en is not null then 'mercadopago'
    else coalesce(nullif(trim(p_medio), ''), 'efectivo')
  end;
  -- cuenta corriente no pasa por acá: exige validar límite y generar la deuda,
  -- y eso vive en el circuito de ventas, no en la entrega de un pedido
  if v_medio not in ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'pedidosya') then
    raise exception 'Medio de pago % no válido para entregar un pedido', v_medio;
  end if;

  -- la plata del mostrador tiene que caer en una caja abierta
  select s.id into v_sesion
  from sesiones_caja s join cajas c on c.id = s.caja_id
  where s.cerrada_en is null and c.sucursal_id = v_pedido.sucursal_id
  order by (s.usuario_id = p_usuario) desc, s.abierta_en desc
  limit 1;
  if v_medio = 'efectivo' and v_sesion is null then
    raise exception 'Abrí la caja de la sucursal antes de entregar un pedido cobrando en efectivo';
  end if;

  v_venta_id := coalesce(v_pedido.venta_id, gen_random_uuid());

  for v_item in
    select producto_id, cantidad, precio_unitario, reservado from pedidos_items where pedido_id = p_pedido
  loop
    v_r := reservado_del_renglon(v_pedido.reserva_stock, v_item.cantidad, v_item.reservado);
    if v_r > 0 then
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_r,
        null, 'pedido', p_pedido::text, p_usuario);
    end if;
    if v_item.precio_unitario is not null then
      v_precio := v_item.precio_unitario;
    else
      select pv.precio_final into v_precio
      from precio_vigente(v_item.producto_id, now(), v_segmento, v_medio, v_verificado, false) pv;
    end if;
    v_total := v_total + round(v_item.cantidad * coalesce(v_precio, 0), 2);
  end loop;

  perform liberar_estacionamiento(p_pedido);

  v_venta := registrar_venta(
    v_pedido.sucursal_id,
    (select coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad, 'precio_unitario', precio_unitario)), '[]'::jsonb)
       from pedidos_items where pedido_id = p_pedido),
    jsonb_build_array(jsonb_build_object('medio', v_medio, 'monto', v_total)),
    v_pedido.canal, v_dni, v_sesion, p_usuario, v_venta_id, 0, null, false);

  update pedidos
    set estado = 'entregado', venta_id = v_venta_id, entregado_en = now(), entregado_por = p_usuario,
        cambio_por = p_usuario, cambio_en = now()
    where id = p_pedido;

  return jsonb_build_object('pedido_id', p_pedido, 'venta_id', v_venta_id, 'estado', 'entregado',
                            'total', v_total, 'medio', v_medio, 'sesion_caja', v_sesion);
end $function$;

-- Faltantes al entregar: lo que hay = el stock + lo que este pedido ya tiene reservado.
create or replace function public.faltantes_pedido(p_pedido uuid)
 returns table(producto_id uuid, sku text, nombre text, pide numeric, hay numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select i.producto_id, pr.sku, pr.nombre, sum(i.cantidad) as pide,
         greatest(coalesce(s.cantidad, 0) + sum(reservado_del_renglon(p.reserva_stock, i.cantidad, i.reservado)), 0) as hay
    from pedidos p
    join pedidos_items i on i.pedido_id = p.id
    join productos pr on pr.id = i.producto_id
    left join stock s on s.producto_id = i.producto_id and s.sucursal_id = p.sucursal_id
   where p.id = p_pedido
   group by i.producto_id, pr.sku, pr.nombre, s.cantidad
  having coalesce(s.cantidad, 0) + sum(reservado_del_renglon(p.reserva_stock, i.cantidad, i.reservado)) < sum(i.cantidad)
   order by pr.nombre;
$function$;

-- Al entregar falta stock: sale lo que no hay (y su reserva) y, si se elige, entra otro.
create or replace function public.resolver_faltante_pedido(p_pedido uuid, p_producto uuid, p_reemplazo uuid default null::uuid, p_cantidad numeric default null::numeric, p_usuario uuid default null::uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_nombre text; v_precio_viejo numeric; v_pide numeric; v_hay numeric; v_saca numeric;
  v_nuevo productos%rowtype; v_cant numeric; v_precio numeric; v_hay_nuevo numeric; v_ya numeric;
  v_segmento tipo_cliente; v_verificado boolean := false; v_medio text;
  v_total_antes numeric; v_total numeric; v_quedan int;
  v_res_viejo numeric; v_r numeric; v_queda_r numeric; v_ya_r numeric;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.estado in ('entregado', 'cancelado') or v_pedido.venta_id is not null then
    raise exception 'El pedido ya está %: no se le pueden cambiar los productos', v_pedido.estado;
  end if;
  select pr.nombre, i.cantidad, i.precio_unitario, i.reservado into v_nombre, v_pide, v_precio_viejo, v_res_viejo
    from pedidos_items i join productos pr on pr.id = i.producto_id
   where i.pedido_id = p_pedido and i.producto_id = p_producto;
  if not found then raise exception 'Ese producto ya no está en el pedido: actualizá la pantalla'; end if;
  v_r := reservado_del_renglon(v_pedido.reserva_stock, v_pide, v_res_viejo);
  select greatest(coalesce(s.cantidad, 0) + v_r, 0) into v_hay
    from (select 1) x left join stock s on s.producto_id = p_producto and s.sucursal_id = v_pedido.sucursal_id;
  if v_hay >= v_pide then
    raise exception 'Ya hay stock de % para este pedido: actualizá la pantalla y entregalo', v_nombre;
  end if;
  v_saca := v_pide - v_hay;
  if v_pedido.cliente_id is not null then
    select tipo, verificado into v_segmento, v_verificado from clientes where id = v_pedido.cliente_id;
  end if;
  v_medio := case when v_pedido.qr_retiro like 'PY-%' then 'pedidosya'
                  when v_pedido.pagado_en is not null then 'mercadopago' end;
  if v_precio_viejo is null then
    select pv.precio_final into v_precio_viejo
      from precio_vigente(p_producto, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv;
  end if;
  -- lo reservado que queda: hasta lo que sigue en el pedido; el resto se devuelve
  v_queda_r := case when v_hay > 0 then least(v_r, v_hay) else 0 end;
  if v_hay > 0 then
    update pedidos_items set cantidad = v_hay,
           reservado = case when v_res_viejo is null and not v_pedido.reserva_stock then null else v_queda_r end
     where pedido_id = p_pedido and producto_id = p_producto;
  else
    delete from pedidos_items where pedido_id = p_pedido and producto_id = p_producto;
  end if;
  if v_r - v_queda_r > 0 then
    perform registrar_movimiento(p_producto, v_pedido.sucursal_id, 'liberacion_reserva', v_r - v_queda_r,
      null, 'pedido', p_pedido::text, p_usuario);
  end if;
  v_total_antes := coalesce(v_pedido.total, 0);
  v_total := v_total_antes - round(v_saca * coalesce(v_precio_viejo, 0), 2);
  if p_reemplazo is not null then
    if p_reemplazo = p_producto then raise exception 'El reemplazo tiene que ser otro producto'; end if;
    select * into v_nuevo from productos where id = p_reemplazo;
    if not found or v_nuevo.activo is false then raise exception 'Ese producto no existe o está dado de baja'; end if;
    v_cant := coalesce(p_cantidad, v_saca);
    if v_cant <= 0 then raise exception 'La cantidad del reemplazo tiene que ser mayor que 0'; end if;
    select coalesce(i.cantidad, 0), coalesce(reservado_del_renglon(v_pedido.reserva_stock, i.cantidad, i.reservado), 0)
      into v_ya, v_ya_r from (select 1) x
      left join pedidos_items i on i.pedido_id = p_pedido and i.producto_id = p_reemplazo;
    -- al entregar tiene que estar todo: lo que ya pedía sin reservar más lo nuevo
    select greatest(coalesce(s.cantidad, 0), 0) into v_hay_nuevo
      from (select 1) x left join stock s on s.producto_id = p_reemplazo and s.sucursal_id = v_pedido.sucursal_id;
    if v_hay_nuevo < (v_ya - v_ya_r) + v_cant then
      raise exception 'Tampoco alcanza % en la sucursal: hay %', v_nuevo.nombre, greatest(v_hay_nuevo - (v_ya - v_ya_r), 0);
    end if;
    select pv.precio_final into v_precio
      from precio_vigente(p_reemplazo, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv;
    if v_precio is null then raise exception '% no tiene precio cargado: elegí otro', v_nuevo.nombre; end if;
    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario, reservado)
    values (p_pedido, p_reemplazo, v_cant, round(v_precio, 2), case when v_pedido.reserva_stock then v_cant end)
    on conflict (pedido_id, producto_id) do update set
      cantidad = pedidos_items.cantidad + excluded.cantidad,
      reservado = case when v_pedido.reserva_stock then v_ya_r + v_cant else pedidos_items.reservado end;
    if v_pedido.reserva_stock then
      perform registrar_movimiento(p_reemplazo, v_pedido.sucursal_id, 'reserva', -v_cant,
        null, 'pedido', p_pedido::text, p_usuario);
    end if;
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
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%');
end;
$function$;

-- Al armar falta stock (y «Tengo parecido» cuando el cliente dice que sí): sale
-- lo que no hay con su reserva; el parecido reserva lo que haya de él.
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
  v_res_viejo numeric; v_r numeric; v_queda_r numeric; v_ya_r numeric; v_disp numeric; v_rr numeric;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.estado in ('entregado', 'cancelado') or v_pedido.venta_id is not null then
    raise exception 'El pedido ya está %: no se le pueden cambiar los productos', v_pedido.estado;
  end if;

  select pr.nombre, i.cantidad, i.precio_unitario, i.reservado into v_nombre, v_pide, v_precio_viejo, v_res_viejo
    from pedidos_items i join productos pr on pr.id = i.producto_id
   where i.pedido_id = p_pedido and i.producto_id = p_producto;
  if not found then raise exception 'Ese producto ya no está en el pedido: actualizá la pantalla'; end if;
  v_r := reservado_del_renglon(v_pedido.reserva_stock, v_pide, v_res_viejo);

  v_hay := coalesce(p_hay, 0);
  if v_hay < 0 then raise exception 'Lo que hay no puede ser menos de 0'; end if;
  if v_hay >= v_pide then raise exception 'Si hay % o más, no falta nada de %', trim_scale(v_pide), v_nombre; end if;
  v_saca := v_pide - v_hay;
  -- lo que decía el sistema (para el historial: si no coincide, hay que revisar el stock)
  select coalesce(s.cantidad, 0) + v_r into v_sistema
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

  -- 1. lo que no hay sale del pedido (si hay algo, el renglón queda con eso) y su reserva vuelve
  v_queda_r := case when v_hay > 0 then least(v_r, v_hay) else 0 end;
  if v_hay > 0 then
    update pedidos_items set cantidad = v_hay,
           reservado = case when v_res_viejo is null and not v_pedido.reserva_stock then null else v_queda_r end
     where pedido_id = p_pedido and producto_id = p_producto;
  else
    delete from pedidos_items where pedido_id = p_pedido and producto_id = p_producto;
    delete from pedidos_carro where pedido_id = p_pedido and producto_id = p_producto;
  end if;
  if v_r - v_queda_r > 0 then
    perform registrar_movimiento(p_producto, v_pedido.sucursal_id, 'liberacion_reserva', v_r - v_queda_r,
      null, 'pedido', p_pedido::text, p_usuario);
  end if;
  v_total_antes := coalesce(v_pedido.total, 0);
  v_total := v_total_antes - round(v_saca * coalesce(v_precio_viejo, 0), 2);

  -- 2. el reemplazo, si se eligió: no se frena por el stock del sistema (lo tiene
  --    en la mano el que arma), pero se reserva solo lo que el sistema tiene
  if p_reemplazo is not null then
    if p_reemplazo = p_producto then raise exception 'El reemplazo tiene que ser otro producto'; end if;
    select * into v_nuevo from productos where id = p_reemplazo;
    if not found or v_nuevo.activo is false then raise exception 'Ese producto no existe o está dado de baja'; end if;
    v_cant := coalesce(p_cantidad, v_saca);
    if v_cant <= 0 then raise exception 'La cantidad del reemplazo tiene que ser mayor que 0'; end if;

    select pv.precio_final into v_precio
      from precio_vigente(p_reemplazo, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv;
    if v_precio is null then raise exception '% no tiene precio cargado: elegí otro', v_nuevo.nombre; end if;

    v_rr := 0;
    if v_pedido.reserva_stock then
      select greatest(coalesce(s.cantidad, 0), 0) into v_disp
        from (select 1) x left join stock s on s.producto_id = p_reemplazo and s.sucursal_id = v_pedido.sucursal_id;
      v_rr := least(v_cant, v_disp);
    end if;
    select coalesce(reservado_del_renglon(v_pedido.reserva_stock, i.cantidad, i.reservado), 0) into v_ya_r
      from (select 1) x left join pedidos_items i on i.pedido_id = p_pedido and i.producto_id = p_reemplazo;
    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario, reservado)
    values (p_pedido, p_reemplazo, v_cant, round(v_precio, 2), case when v_pedido.reserva_stock then v_rr end)
    on conflict (pedido_id, producto_id) do update set
      cantidad = pedidos_items.cantidad + excluded.cantidad,
      reservado = case when v_pedido.reserva_stock then v_ya_r + v_rr else pedidos_items.reservado end;
    if v_rr > 0 then
      perform registrar_movimiento(p_reemplazo, v_pedido.sucursal_id, 'reserva', -v_rr,
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
    'pagado', v_pedido.pagado_en is not null or v_pedido.qr_retiro like 'PY-%');
end;
$function$;

-- Fracciones: lo armado de una presentación incluye solo lo reservado de verdad.
create or replace function public.tg_productos_fraccion_valida()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  v_pozo productos%rowtype;
  v_armadas numeric;
begin
  if tg_op = 'UPDATE'
     and old.fraccion_de is not null
     and (new.fraccion_de is distinct from old.fraccion_de
          or new.unidades_por_fraccion is distinct from old.unidades_por_fraccion) then
    select coalesce((select sum(cantidad) from stock where producto_id = new.id and cantidad > 0), 0)
         + coalesce((select sum(reservado_del_renglon(p.reserva_stock, i.cantidad, i.reservado))
                       from pedidos_items i join pedidos p on p.id = i.pedido_id
                      where i.producto_id = new.id
                        and p.estado in ('recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino')), 0)
      into v_armadas;
    if v_armadas > 0 then
      raise exception 'Hay % armadas de % (en stock o reservadas en pedidos): pasalas al pozo antes de cambiar lo que lleva o sacarla del grupo',
        trim_scale(v_armadas), old.nombre;
    end if;
  end if;

  if new.fraccion_de is null then
    if new.unidades_por_fraccion is not null then
      raise exception 'Un producto sin pozo no puede llevar unidades por fracción';
    end if;
    return new;
  end if;

  if new.unidades_por_fraccion is null then
    raise exception 'La presentación % tiene que decir cuánto lleva del pozo', new.nombre;
  end if;
  if new.fraccion_de = new.id then
    raise exception 'Un producto no puede ser presentación de sí mismo';
  end if;

  select * into v_pozo from productos where id = new.fraccion_de;
  if v_pozo.fraccion_de is not null then
    raise exception '% ya es una presentación: no puede ser el pozo de %', v_pozo.nombre, new.nombre;
  end if;
  if exists (select 1 from productos where fraccion_de = new.id) then
    raise exception '% es el pozo de otras presentaciones: no puede ser presentación', new.nombre;
  end if;
  return new;
end $function$;

revoke all on function public.reservar_lo_que_hay(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reservar_lo_que_hay(uuid, uuid) to service_role;

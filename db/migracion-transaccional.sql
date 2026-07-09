-- ============================================================================
-- Migración de transaccionalidad — operaciones multi-paso a RPC atómicas
-- Aplicada en Supabase (proyecto ODB) el 2026-07-01.
--
-- Contexto (auditoría): varios flujos críticos se orquestaban desde NestJS con
-- múltiples .insert()/.update()/.rpc() sueltos. Un corte a mitad de camino
-- dejaba datos inconsistentes (pedidos sin items, stock reservado fantasma,
-- OP pagadas con facturas sin marcar, ventas anuladas sin nota de crédito).
-- Cada función de acá abajo encapsula un flujo completo en UNA transacción:
-- si algo falla, PostgreSQL revierte todo.
--
--   crear_pedido            pedido + items + reservas de stock
--   aprobar_oc_panel        OC aprobada + registro de auditoría
--   recibir_oc_con_precio   recepción de OC + regla de oro (costo→precio)
--   crear_orden_pago        OP + items + facturas en_pago (con lock)
--   aprobar_op_panel        OP aprobada + registro de auditoría
--   pagar_orden_pago        cheques + OP pagada + facturas pagadas
--   anular_venta            devolución de stock + anulada + NC en cola ARCA
-- ============================================================================

-- Pedido con reserva de stock, todo o nada. Si un renglón no tiene stock,
-- registrar_movimiento lanza excepción y NADA queda persistido.
create or replace function public.crear_pedido(
  p_canal canal_venta,
  p_sucursal uuid,
  p_items jsonb,                -- [{producto_id, cantidad}]
  p_cliente_id uuid default null,
  p_cliente_dni text default null,
  p_qr_retiro text default null,
  p_reservar boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido uuid;
  v_total numeric := 0;
  v_cliente uuid := p_cliente_id;
  v_item record;
  v_precio numeric;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;

  if v_cliente is null and coalesce(trim(p_cliente_dni), '') <> '' then
    select id into v_cliente from clientes where dni = trim(p_cliente_dni);
    if not found then
      insert into clientes (dni) values (trim(p_cliente_dni)) returning id into v_cliente;
    end if;
  end if;

  insert into pedidos (canal, sucursal_id, cliente_id, estado, total, qr_retiro)
  values (p_canal, p_sucursal, v_cliente, 'recibido', 0, p_qr_retiro)
  returning id into v_pedido;

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'Cantidad invalida en el pedido';
    end if;
    select coalesce(cp.precio_final, cp.precio_lista, 0) into v_precio
    from catalogo_precios(array[v_item.producto_id], false, null::tipo_cliente) cp;
    v_precio := coalesce(v_precio, 0);

    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario)
    values (v_pedido, v_item.producto_id, v_item.cantidad, v_precio);
    v_total := v_total + round(v_item.cantidad * v_precio, 2);

    if coalesce(p_reservar, true) then
      perform registrar_movimiento(
        v_item.producto_id, p_sucursal, 'reserva', -v_item.cantidad,
        null, 'pedido', v_pedido::text, null);
    end if;
  end loop;

  update pedidos set total = v_total where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'total', v_total);
end $function$;

-- Aprobación de OC desde el panel (sin PIN; el controller restringe el rol).
-- Update + auditoría en una transacción; la aprobación siempre queda registrada.
create or replace function public.aprobar_oc_panel(p_oc uuid, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_oc ordenes_compra%rowtype;
begin
  if p_usuario is null then raise exception 'Falta el usuario aprobador'; end if;
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado <> 'pendiente_aprobacion' then
    raise exception 'La orden esta "%", no se puede aprobar', v_oc.estado;
  end if;
  update ordenes_compra
  set estado = 'aprobada', aprobada_por = p_usuario, aprobada_en = now()
  where id = p_oc;
  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_compra', p_oc, p_usuario,
          md5(v_oc.id::text || v_oc.total::text || v_oc.proveedor_id::text), 'panel');
end $function$;

-- Recepción de OC + "regla de oro" (fijar costo real y precio de venta) en una
-- sola transacción: no puede quedar stock ingresado con precios viejos.
create or replace function public.recibir_oc_con_precio(
  p_oc uuid,
  p_items jsonb,          -- [{producto_id, cantidad}] recibidos
  p_items_precio jsonb,   -- [{sku, costo, precio}] para aplicar_lista_con_precio (puede ser [])
  p_usuario uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prov uuid;
  v_estado text;
  v_repreciados integer := 0;
begin
  select proveedor_id into v_prov from ordenes_compra where id = p_oc;
  if v_prov is null then raise exception 'No existe la orden de compra'; end if;
  select recibir_orden_compra(p_oc, p_items, p_usuario) into v_estado;
  if p_items_precio is not null and jsonb_array_length(p_items_precio) > 0 then
    select aplicar_lista_con_precio(v_prov, p_items_precio, p_usuario) into v_repreciados;
  end if;
  return jsonb_build_object('estado', v_estado, 'repreciados', coalesce(v_repreciados, 0));
end $function$;

-- OP nueva con lock de las facturas: dos OP simultáneas no pueden tomar la
-- misma factura, y items + estado en_pago quedan consistentes o no queda nada.
create or replace function public.crear_orden_pago(
  p_facturas uuid[],
  p_medio text default null,
  p_vencimiento date default null,
  p_programada date default null,
  p_observaciones text default null,
  p_usuario uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_provs uuid[];
  v_total numeric;
  v_venc date;
  v_cant integer;
  v_op uuid;
  v_num bigint;
begin
  if p_facturas is null or array_length(p_facturas, 1) is null then
    raise exception 'Elegi al menos una factura';
  end if;
  perform id from facturas_proveedor where id = any(p_facturas) for update;

  select array_agg(distinct proveedor_id), coalesce(sum(monto), 0), count(*), min(vencimiento)
    into v_provs, v_total, v_cant, v_venc
  from facturas_proveedor
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  if v_cant = 0 then raise exception 'Esas facturas ya estan pagadas o en una OP'; end if;
  if array_length(v_provs, 1) > 1 then
    raise exception 'Las facturas son de distintos proveedores: arma una OP por proveedor';
  end if;

  insert into ordenes_pago (proveedor_id, total, medio_pago, estado, vencimiento,
                            fecha_programada, observaciones, creada_por)
  values (v_provs[1], v_total, coalesce(p_medio, 'transferencia'), 'pendiente_aprobacion',
          coalesce(p_vencimiento, v_venc), p_programada, p_observaciones, p_usuario)
  returning id, numero into v_op, v_num;

  insert into ordenes_pago_items (orden_pago_id, factura_id, monto)
  select v_op, id, monto from facturas_proveedor
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  update facturas_proveedor set estado = 'en_pago'
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  return jsonb_build_object('orden_pago_id', v_op, 'numero', v_num,
                            'total', v_total, 'facturas', v_cant);
end $function$;

-- Aprobación de OP desde el panel: update + auditoría, atómico.
create or replace function public.aprobar_op_panel(p_op uuid, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_op ordenes_pago%rowtype;
begin
  if p_usuario is null then raise exception 'Falta el usuario aprobador'; end if;
  select * into v_op from ordenes_pago where id = p_op for update;
  if not found then raise exception 'No existe la orden de pago'; end if;
  if v_op.estado <> 'pendiente_aprobacion' then
    raise exception 'La OP esta "%"', v_op.estado;
  end if;
  update ordenes_pago
  set estado = 'aprobada', aprobada_por = p_usuario, aprobada_en = now()
  where id = p_op;
  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_pago', p_op, p_usuario,
          md5(v_op.id::text || v_op.total::text || v_op.proveedor_id::text), 'panel');
end $function$;

-- Pago de OP: cheques propios emitidos + terceros endosados + OP pagada +
-- facturas pagadas, todo o nada. Los cheques de terceros se lockean para que
-- el mismo cheque no se endose dos veces en pagos simultáneos.
create or replace function public.pagar_orden_pago(
  p_op uuid,
  p_cheques_propios jsonb default null,  -- [{numero, banco, titular, importe, fechaCobro}]
  p_cheques_terceros uuid[] default null,
  p_usuario uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_op ordenes_pago%rowtype;
  v_ch record;
  v_id uuid;
  v_estado text;
  v_tipo text;
begin
  select * into v_op from ordenes_pago where id = p_op for update;
  if not found then raise exception 'No existe la orden de pago'; end if;
  if v_op.estado <> 'aprobada' then
    raise exception 'La OP tiene que estar APROBADA por el dueno antes de pagarse';
  end if;

  for v_ch in
    select c->>'numero' as numero, c->>'banco' as banco, c->>'titular' as titular,
           (c->>'importe')::numeric as importe, (c->>'fechaCobro')::date as fecha_cobro
    from jsonb_array_elements(coalesce(p_cheques_propios, '[]'::jsonb)) c
  loop
    if coalesce(v_ch.numero, '') = '' or coalesce(v_ch.importe, 0) <= 0 then
      raise exception 'Cada cheque propio necesita numero e importe';
    end if;
    insert into cheques (tipo, numero, banco, titular, importe, fecha_cobro,
                         es_diferido, estado, proveedor_id, orden_pago_id, usuario_id)
    values ('propio', v_ch.numero, v_ch.banco, v_ch.titular, v_ch.importe, v_ch.fecha_cobro,
            v_ch.fecha_cobro is not null, 'emitido', v_op.proveedor_id, p_op, p_usuario);
  end loop;

  if p_cheques_terceros is not null then
    foreach v_id in array p_cheques_terceros loop
      select estado, tipo into v_estado, v_tipo from cheques where id = v_id for update;
      if not found or v_tipo <> 'terceros' then
        raise exception 'Cheque de terceros invalido';
      end if;
      if v_estado <> 'cartera' then
        raise exception 'El cheque de terceros no esta en cartera';
      end if;
      update cheques set estado = 'aplicado', proveedor_id = v_op.proveedor_id, orden_pago_id = p_op
      where id = v_id;
    end loop;
  end if;

  update ordenes_pago set estado = 'pagada', pagada_en = now() where id = p_op;
  update facturas_proveedor set estado = 'pagada'
  where id in (select factura_id from ordenes_pago_items where orden_pago_id = p_op);
end $function$;

-- Anulación de venta: devolución de stock + estado anulada + nota de crédito
-- en cola ARCA, atómico (no más ventas anuladas sin NC o con stock a medias).
create or replace function public.anular_venta(p_venta uuid, p_usuario uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_venta ventas%rowtype;
  v_item record;
  v_pv integer;
begin
  select * into v_venta from ventas where id = p_venta for update;
  if not found then raise exception 'No existe la venta'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'La venta ya esta %', v_venta.estado;
  end if;

  for v_item in select producto_id, cantidad from ventas_items where venta_id = p_venta loop
    perform registrar_movimiento(
      v_item.producto_id, v_venta.sucursal_id, 'devolucion', v_item.cantidad,
      null, 'venta_anulada', p_venta::text, p_usuario);
  end loop;

  update ventas set estado = 'anulada' where id = p_venta;
  select coalesce(punto_venta_arca, 1) into v_pv from sucursales where id = v_venta.sucursal_id;
  insert into comprobantes_arca (venta_id, tipo, punto_venta, estado)
  values (p_venta, 'NCB', v_pv, 'pendiente');

  return jsonb_build_object('anulada', true, 'total', v_venta.total);
end $function$;

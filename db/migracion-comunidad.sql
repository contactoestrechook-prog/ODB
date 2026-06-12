-- Migración: Comunidad ODB
-- Los clientes con identidad verificada (biometría Didit) acceden a
-- promociones exclusivas que el resto no ve.

alter table descuentos add column if not exists solo_comunidad boolean not null default false;

-- precio_vigente ahora considera si el comprador es de la Comunidad
drop function if exists catalogo_precios(uuid[]);
drop function if exists precio_vigente(uuid, timestamptz, tipo_cliente, text);

create or replace function precio_vigente(
  p_producto_id uuid,
  p_fecha timestamptz default now(),
  p_segmento tipo_cliente default null,
  p_medio_pago text default null,
  p_verificado boolean default false
) returns table (
  precio_lista numeric,
  precio_final numeric,
  descuento_id uuid,
  descuento_nombre text,
  descuento_comunidad boolean
)
language sql stable security invoker as $$
  with lista as (
    select pr.precio
    from precios pr
    join listas_precios lp on lp.id = pr.lista_id and lp.nombre = 'Minorista'
    where pr.producto_id = p_producto_id and pr.vigente_desde <= p_fecha
    order by pr.vigente_desde desc
    limit 1
  ),
  prod as (
    select categoria_id, marca_id from productos where id = p_producto_id
  ),
  aplicables as (
    select d.id, d.nombre, d.solo_comunidad,
      case d.tipo
        when 'porcentaje' then greatest(l.precio * (1 - d.valor / 100), 0)
        when 'monto_fijo' then greatest(l.precio - d.valor, 0)
        when 'precio_fijo' then d.valor
      end as precio_desc
    from descuentos d, lista l, prod p
    where d.activo
      and p_fecha between d.desde and d.hasta
      and (d.segmento is null or d.segmento = p_segmento)
      and (d.medio_pago is null or d.medio_pago = p_medio_pago)
      and (not d.solo_comunidad or p_verificado)
      and (
        d.alcance = 'global'
        or (d.alcance = 'categoria' and d.categoria_id = p.categoria_id)
        or (d.alcance = 'marca' and d.marca_id = p.marca_id)
        or (d.alcance = 'producto' and d.producto_id = p_producto_id)
      )
  )
  select l.precio,
         coalesce(a.precio_desc, l.precio),
         a.id,
         a.nombre,
         coalesce(a.solo_comunidad, false)
  from lista l
  left join lateral (
    select * from aplicables order by precio_desc asc limit 1
  ) a on true;
$$;

create or replace function catalogo_precios(p_ids uuid[], p_verificado boolean default false)
returns table (
  producto_id uuid,
  precio_lista numeric,
  precio_final numeric,
  descuento_nombre text,
  descuento_comunidad boolean
)
language sql stable security invoker as $$
  select p.id, (pv).precio_lista, (pv).precio_final, (pv).descuento_nombre, (pv).descuento_comunidad
  from unnest(p_ids) as ids(id)
  join productos p on p.id = ids.id
  cross join lateral (select precio_vigente(p.id, now(), null, null, p_verificado) as pv) x;
$$;

-- registrar_venta: el precio del cliente verificado incluye sus promos de Comunidad
create or replace function registrar_venta(
  p_sucursal uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_canal canal_venta default 'mostrador',
  p_cliente_dni text default null,
  p_sesion_caja uuid default null,
  p_usuario uuid default null,
  p_venta_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(p_venta_id, gen_random_uuid());
  v_cliente_id uuid;
  v_segmento tipo_cliente;
  v_verificado boolean := false;
  v_medio text;
  v_item record;
  v_pv record;
  v_pago record;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_suma_pagos numeric := 0;
  v_tipo_cliente tipo_cliente;
  v_pto_venta int;
begin
  if exists (select 1 from ventas where id = v_id) then
    return jsonb_build_object('venta_id', v_id, 'duplicada', true);
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene renglones';
  end if;

  if p_cliente_dni is not null and trim(p_cliente_dni) <> '' then
    select id, tipo, verificado into v_cliente_id, v_segmento, v_verificado
    from clientes where dni = trim(p_cliente_dni);
    if not found then
      insert into clientes (dni) values (trim(p_cliente_dni))
      returning id, tipo, verificado into v_cliente_id, v_segmento, v_verificado;
    end if;
  end if;

  select p->>'medio' into v_medio
  from jsonb_array_elements(p_pagos) p
  order by (p->>'monto')::numeric desc limit 1;

  insert into ventas (id, sucursal_id, sesion_caja_id, cliente_id, canal, subtotal, descuento, total)
  values (v_id, p_sucursal, p_sesion_caja, v_cliente_id, p_canal, 0, 0, 0);

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad <= 0 then raise exception 'Cantidad inválida'; end if;
    select * into v_pv from precio_vigente(v_item.producto_id, now(), v_segmento, v_medio, v_verificado);
    if v_pv.precio_lista is null then
      raise exception 'El producto % no tiene precio de lista', v_item.producto_id;
    end if;
    insert into ventas_items (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, promocion_id)
    select v_id, v_item.producto_id, v_item.cantidad, round(v_pv.precio_final, 2), p.costo, null
    from productos p where p.id = v_item.producto_id;
    v_subtotal := v_subtotal + round(v_item.cantidad * v_pv.precio_lista, 2);
    v_total := v_total + round(v_item.cantidad * v_pv.precio_final, 2);
    perform registrar_movimiento(
      v_item.producto_id, p_sucursal, 'venta', -v_item.cantidad,
      null, 'venta', v_id::text, p_usuario);
  end loop;

  for v_pago in
    select p->>'medio' medio, (p->>'monto')::numeric monto
    from jsonb_array_elements(p_pagos) p
  loop
    if v_pago.monto <= 0 then raise exception 'Monto de pago inválido'; end if;
    insert into pagos (venta_id, medio, monto) values (v_id, v_pago.medio, v_pago.monto);
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;
  if round(v_suma_pagos, 2) <> round(v_total, 2) then
    raise exception 'Los pagos ($%) no coinciden con el total ($%)', v_suma_pagos, v_total;
  end if;

  update ventas
  set subtotal = v_subtotal, descuento = v_subtotal - v_total, total = v_total
  where id = v_id;

  select coalesce(punto_venta_arca, 1) into v_pto_venta from sucursales where id = p_sucursal;
  insert into comprobantes_arca (venta_id, tipo, punto_venta, estado)
  values (v_id, 'FB', v_pto_venta, 'pendiente');

  if v_cliente_id is not null then
    v_tipo_cliente := clasificar_cliente(v_cliente_id);
  end if;

  return jsonb_build_object(
    'venta_id', v_id,
    'subtotal', v_subtotal,
    'descuento', v_subtotal - v_total,
    'total', v_total,
    'tipo_cliente', v_tipo_cliente
  );
end $$;

revoke execute on function registrar_venta(uuid,jsonb,jsonb,canal_venta,text,uuid,uuid,uuid) from public, anon, authenticated;

-- Primeras promos exclusivas de la Comunidad ODB
insert into descuentos (nombre, alcance, producto_id, tipo, valor, desde, hasta, solo_comunidad)
select 'Comunidad ODB: Catena Zapata 20 % off', 'producto', id, 'porcentaje', 20, now(), now() + interval '30 days', true
from productos where sku = 'VIN-0002';

insert into descuentos (nombre, alcance, categoria_id, tipo, valor, desde, hasta, solo_comunidad)
select 'Comunidad ODB: 15 % en toda la fiambrería', 'categoria', id, 'porcentaje', 15, now(), now() + interval '30 days', true
from categorias where nombre = 'Fiambres';
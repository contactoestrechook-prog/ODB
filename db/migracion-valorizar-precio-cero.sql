-- ============================================================
-- FACTURAS QUE PONEN PRECIO A LO QUE ENTRÓ A $0 (10/10/2026, pedido de Leandro)
--
-- «Cuando cargamos facturas de La Serenísima, en la parte de quesos figuran los
-- que ingresaron a precio 0, y a la semana llega otra factura con los precios
-- de esos quesos; tenemos que poder identificarlas para no duplicar stock.»
--
-- La primera factura (o la pistola) entra los quesos con costo 0. La segunda,
-- cargada como compra normal, los volvía a sumar al stock.
--
-- Aditiva: una tabla nueva y una función nueva. recibir_compra_directa NO se
-- toca: la API la sigue llamando igual cuando no hay nada para valorizar.
--
--   valorizaciones_precio_cero   una fila por entrada a $0 que recibió precio:
--                                qué orden y producto, cuánto entró, cuánto dice
--                                la factura nueva (la diferencia queda anotada,
--                                el stock no se toca), el costo y la factura.
--                                Única por (orden, producto): no se valoriza dos veces.
--   recibir_compra_valorizando   en UNA transacción:
--                                · los renglones normales entran como siempre
--                                  (recibir_compra_directa, con su stock);
--                                · los tildados «solo precio» le ponen el costo
--                                  al renglón que entró a $0 (mismo proveedor y
--                                  producto, todavía en cero), recalculan el total
--                                  de esa orden y NO mueven stock;
--                                · todos remarcan como una compra
--                                  (aplicar_lista_con_precio, regla de oro).
--                                Si TODA la factura es de valorizar, no se crea
--                                orden nueva: la factura queda atada a la orden
--                                (y el remito) de la primera entrada a $0.
-- ============================================================

create table if not exists public.valorizaciones_precio_cero (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id),
  oc_id uuid not null,
  producto_id uuid not null references public.productos(id),
  cantidad_entrada numeric not null,   -- lo que entró a $0
  cantidad_factura numeric not null,   -- lo que dice la factura que puso el precio
  diferencia numeric not null,         -- factura − entrada (quesos por peso); no mueve stock
  costo_unitario numeric not null check (costo_unitario > 0),
  numero_factura text,
  factura_id uuid references public.facturas_proveedor(id) on delete set null,
  oc_factura uuid references public.ordenes_compra(id) on delete set null, -- la orden de los renglones normales de esa factura, si hubo
  usuario_id uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  constraint valorizaciones_precio_cero_entrada unique (oc_id, producto_id),
  constraint valorizaciones_precio_cero_item foreign key (oc_id, producto_id)
    references public.ordenes_compra_items(oc_id, producto_id) on delete cascade
);
create index if not exists valorizaciones_precio_cero_proveedor on public.valorizaciones_precio_cero (proveedor_id, creado_en desc);
alter table public.valorizaciones_precio_cero enable row level security;
revoke all on public.valorizaciones_precio_cero from anon, authenticated;

create or replace function public.recibir_compra_valorizando(
  p_proveedor uuid,
  p_sucursal uuid,
  p_items jsonb,                       -- renglones normales (como recibir_compra_directa); puede ser []
  p_numero_remito text default null,
  p_usuario uuid default null,
  p_items_precio jsonb default null,   -- [{sku, costo, precio}] de TODOS (normales y valorizados)
  p_valorizar jsonb default null       -- [{oc_id, producto_id, cantidad, costo_unitario}]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
  v_v record;
  v_item ordenes_compra_items%rowtype;
  v_prov_oc uuid;
  v_oc_nueva uuid;
  v_primera uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_detalle jsonb := '[]'::jsonb;
  v_nombre text;
begin
  if coalesce(jsonb_array_length(p_valorizar), 0) = 0 then
    -- nada para valorizar: es la entrada de siempre
    return recibir_compra_directa(p_proveedor, p_sucursal, p_items, p_numero_remito, p_usuario, p_items_precio);
  end if;

  -- 1) los renglones normales entran como siempre (stock, lotes, orden, remito);
  --    la regla de oro de recibir_compra_directa ya remarca a todos los de p_items_precio
  if coalesce(jsonb_array_length(p_items), 0) > 0 then
    v_res := recibir_compra_directa(p_proveedor, p_sucursal, p_items, p_numero_remito, p_usuario, p_items_precio);
    v_oc_nueva := (v_res->>'oc_id')::uuid;
  else
    v_res := jsonb_build_object('oc_id', null, 'remito_id', null, 'total', 0, 'repreciados',
      case when coalesce(jsonb_array_length(p_items_precio), 0) > 0
           then aplicar_lista_con_precio(p_proveedor, p_items_precio, p_usuario) else 0 end);
  end if;

  -- 2) los «solo precio»: costo a la entrada a $0, sin movimiento de stock
  for v_v in
    select (v->>'oc_id')::uuid oc_id, (v->>'producto_id')::uuid producto_id,
           (v->>'cantidad')::numeric cantidad, (v->>'costo_unitario')::numeric costo
    from jsonb_array_elements(p_valorizar) v
  loop
    select nombre into v_nombre from productos where id = v_v.producto_id;
    if v_v.costo is null or v_v.costo <= 0 then
      raise exception 'Para ponerle precio a % (entró a $0) hace falta un costo mayor a cero', coalesce(v_nombre, 'el producto');
    end if;
    if v_v.cantidad is null or v_v.cantidad <= 0 then
      raise exception 'Renglón inválido (cantidad) en %', coalesce(v_nombre, 'el producto');
    end if;
    select proveedor_id into v_prov_oc from ordenes_compra where id = v_v.oc_id;
    if v_prov_oc is distinct from p_proveedor then
      raise exception 'La entrada a $0 de % no es de este proveedor', coalesce(v_nombre, 'el producto');
    end if;
    select * into v_item from ordenes_compra_items where oc_id = v_v.oc_id and producto_id = v_v.producto_id for update;
    if not found then
      raise exception '% no está en esa entrada a $0', coalesce(v_nombre, 'El producto');
    end if;
    if v_item.costo_unitario <> 0
       or exists (select 1 from valorizaciones_precio_cero where oc_id = v_v.oc_id and producto_id = v_v.producto_id) then
      raise exception 'La entrada a $0 de % ya tiene precio: volvé a abrir la factura', coalesce(v_nombre, 'el producto');
    end if;

    update ordenes_compra_items set costo_unitario = v_v.costo
      where oc_id = v_v.oc_id and producto_id = v_v.producto_id;
    update ordenes_compra
      set total = (select coalesce(sum(cantidad * costo_unitario), 0) from ordenes_compra_items where oc_id = v_v.oc_id)
      where id = v_v.oc_id;

    insert into valorizaciones_precio_cero (proveedor_id, oc_id, producto_id, cantidad_entrada, cantidad_factura, diferencia,
      costo_unitario, numero_factura, oc_factura, usuario_id)
    values (p_proveedor, v_v.oc_id, v_v.producto_id, v_item.cantidad_recibida, v_v.cantidad, v_v.cantidad - v_item.cantidad_recibida,
      v_v.costo, p_numero_remito, v_oc_nueva, p_usuario)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_primera := coalesce(v_primera, v_v.oc_id);

    insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
    values (p_usuario, 'valorizar_precio_cero', 'orden_compra', v_v.oc_id::text,
      jsonb_build_object('producto_id', v_v.producto_id, 'costo', 0, 'cantidad', v_item.cantidad_recibida),
      jsonb_build_object('producto_id', v_v.producto_id, 'costo', v_v.costo, 'cantidad_factura', v_v.cantidad,
        'diferencia', v_v.cantidad - v_item.cantidad_recibida, 'factura', p_numero_remito, 'stock', 0));

    v_detalle := v_detalle || jsonb_build_object('oc_id', v_v.oc_id, 'producto_id', v_v.producto_id, 'producto', v_nombre,
      'cantidad_entrada', v_item.cantidad_recibida, 'cantidad_factura', v_v.cantidad, 'diferencia', v_v.cantidad - v_item.cantidad_recibida,
      'costo', v_v.costo);
  end loop;

  -- 3) toda la factura era de valorizar: queda atada a la primera entrada a $0
  if v_oc_nueva is null then
    v_res := v_res || jsonb_build_object('oc_id', v_primera,
      'remito_id', (select id from remitos where oc_id = v_primera order by creado_en desc limit 1));
  end if;

  return v_res || jsonb_build_object('valorizados', jsonb_array_length(v_detalle), 'valorizacion_ids', to_jsonb(v_ids), 'valorizaciones', v_detalle);
end $function$;

revoke all on function public.recibir_compra_valorizando(uuid, uuid, jsonb, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.recibir_compra_valorizando(uuid, uuid, jsonb, text, uuid, jsonb, jsonb) to service_role;

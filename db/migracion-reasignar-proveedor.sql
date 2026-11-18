-- CAMBIAR EL PROVEEDOR DE UN PRODUCTO DESDE CUALQUIER PANTALLA (18/11/2026)
--
-- Leandro: «tenemos que poder cambiar un producto de proveedor desde cualquier
-- lado, tiene que ser muy fácil reasignarlo».
--
-- Hasta hoy el proveedor de un producto solo se decidía a mano en la base
-- (proveedor_decidido, lo de Jaquie con Marquisse el 10/11) y «Qué comprar» ni
-- siquiera lo miraba: tomaba como habitual al último que le vendió o al último
-- vínculo tocado. Ahora:
--
-- 1. proveedor_actual(ids): el proveedor de cada producto, con la misma regla
--    que usa «Qué comprar»: el decidido manda; si no hay, el último que se lo
--    vendió o el último vínculo. Lo usan todas las pantallas para decir
--    «Proveedor: X».
-- 2. reasignar_proveedor(producto, proveedor, usuario, pantalla): todo junto, en
--    una transacción:
--      · el nuevo queda como decidido (proveedor_decidido, origen 'reasignar');
--      · se asegura el vínculo nuevo en proveedor_productos (con el costo del
--        catálogo, como lo arma la carga del Crack);
--      · los vínculos viejos SIN compra real y sin código ni alias del
--        proveedor se sacan: es la misma regla que el espejo del Crack
--        (scripts/sistema-viejo/espejo-proveedores.py) y que lo de Jaquie (se
--        sacaron 21 vínculos viejos, ninguno con compra). Si quedaran, la
--        próxima carga del Crack los sacaría igual;
--      · los vínculos con compra real (historial, factura u orden no
--        cancelada) o con código o alias del proveedor NO se tocan: son
--        historia;
--      · queda en auditoría (accion 'reasignar_proveedor'): quién, cuándo, de
--        cuál a cuál, desde qué pantalla y cada vínculo sacado entero (para
--        poder volverlo).
-- 3. abastecimiento(): el proveedor habitual pasa a ser el decidido cuando hay
--    uno (y está activo). Se cambia solo ese orden sobre la versión viva, como
--    el parche de migracion-abastecimiento-rapido.sql; si el bloque no está
--    donde se espera, falla. Para volver atrás: el mismo reemplazo al revés.
--
-- La API lo llama desde apps/api/src/proveedores/proveedor-de-producto.service.ts
-- y después invalida la lectura del motor (invalidarAbastecimiento): Qué
-- comprar y los pedidos lo toman enseguida.

create or replace function public.proveedor_actual(p_ids uuid[])
returns table (producto_id uuid, proveedor_id uuid, razon_social text, decidido boolean)
language sql stable security definer set search_path = public as $$
  with cand as (
    select pd.producto_id, pd.proveedor_id, 'infinity'::timestamptz fecha, true dec
    from proveedor_decidido pd where pd.producto_id = any(p_ids)
    union all
    select oci.producto_id, oc.proveedor_id, oc.creado_en, false
    from ordenes_compra_items oci join ordenes_compra oc on oc.id = oci.oc_id
    where oc.estado <> 'cancelada' and oci.producto_id = any(p_ids)
    union all
    select pp.producto_id, pp.proveedor_id, coalesce(pp.actualizado_en, '2000-01-01'::timestamptz), false
    from proveedor_productos pp where pp.producto_id = any(p_ids)
  )
  select distinct on (c.producto_id) c.producto_id, c.proveedor_id, pr.razon_social, c.dec
  from cand c join proveedores pr on pr.id = c.proveedor_id and pr.activo
  order by c.producto_id, c.fecha desc;
$$;
revoke all on function public.proveedor_actual(uuid[]) from public, anon, authenticated;

create or replace function public.reasignar_proveedor(p_producto uuid, p_proveedor uuid, p_usuario uuid, p_pantalla text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prod record;
  v_prov record;
  v_decidido_antes jsonb;
  v_antes jsonb;
  v_tenia_vinculo boolean;
  v_sacados jsonb;
  v_quedan jsonb;
  v_ya_estaba boolean;
begin
  select id, sku, nombre, costo into v_prod from productos where id = p_producto for update;
  if not found then raise exception 'No existe el producto'; end if;
  select id, razon_social, activo into v_prov from proveedores where id = p_proveedor;
  if not found then raise exception 'No existe el proveedor'; end if;
  if not v_prov.activo then raise exception '% está dado de baja: no se le puede asignar un producto', v_prov.razon_social; end if;

  select to_jsonb(pd) into v_decidido_antes from proveedor_decidido pd where pd.producto_id = p_producto;
  select jsonb_build_object('id', a.proveedor_id, 'razonSocial', a.razon_social, 'decidido', a.decidido) into v_antes
  from proveedor_actual(array[p_producto]) a;
  v_tenia_vinculo := exists (select 1 from proveedor_productos where producto_id = p_producto and proveedor_id = p_proveedor);

  -- 1. el decidido
  insert into proveedor_decidido (producto_id, proveedor_id, decidido_por, decidido_en, origen, detalle)
  values (p_producto, p_proveedor, p_usuario, now(), 'reasignar', nullif(btrim(coalesce(p_pantalla, '')), ''))
  on conflict (producto_id) do update set proveedor_id = excluded.proveedor_id, decidido_por = excluded.decidido_por,
    decidido_en = excluded.decidido_en, origen = excluded.origen, detalle = excluded.detalle;

  -- 2. el vínculo nuevo
  if not v_tenia_vinculo then
    insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
    values (p_proveedor, p_producto, nullif(v_prod.costo, 0), now());
  end if;

  -- 3. los vínculos viejos: con compra real, código o alias quedan; el resto sale
  with viejos as (
    select pp.*,
      exists (select 1 from compras_historial h where h.producto_id = pp.producto_id and h.proveedor_id = pp.proveedor_id) as en_historial,
      exists (select 1 from facturas_proveedor_items i join facturas_proveedor f on f.id = i.factura_id
              where i.producto_id = pp.producto_id and f.proveedor_id = pp.proveedor_id) as en_factura,
      exists (select 1 from ordenes_compra_items oci join ordenes_compra oc on oc.id = oci.oc_id
              where oci.producto_id = pp.producto_id and oc.proveedor_id = pp.proveedor_id and oc.estado <> 'cancelada') as en_orden
    from proveedor_productos pp
    where pp.producto_id = p_producto and pp.proveedor_id <> p_proveedor
  ),
  borrados as (
    delete from proveedor_productos pp using viejos v
    where pp.producto_id = v.producto_id and pp.proveedor_id = v.proveedor_id
      and not (v.en_historial or v.en_factura or v.en_orden)
      and nullif(btrim(coalesce(v.codigo_proveedor, '')), '') is null
      and nullif(btrim(coalesce(v.alias_descripcion, '')), '') is null
    returning pp.*
  )
  select
    coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('razon_social', pr.razon_social) order by pr.razon_social)
              from borrados b left join proveedores pr on pr.id = b.proveedor_id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', v.proveedor_id, 'razonSocial', pr.razon_social,
                'motivo', case when v.en_historial or v.en_factura then 'compras'
                               when v.en_orden then 'pedidos'
                               when nullif(btrim(coalesce(v.codigo_proveedor, '')), '') is not null then 'codigo'
                               else 'alias' end) order by pr.razon_social)
              from viejos v left join proveedores pr on pr.id = v.proveedor_id
              where (v.en_historial or v.en_factura or v.en_orden)
                 or nullif(btrim(coalesce(v.codigo_proveedor, '')), '') is not null
                 or nullif(btrim(coalesce(v.alias_descripcion, '')), '') is not null), '[]'::jsonb)
  into v_sacados, v_quedan;

  v_ya_estaba := coalesce(v_decidido_antes->>'proveedor_id', '') = p_proveedor::text and v_tenia_vinculo and jsonb_array_length(v_sacados) = 0;

  -- 4. auditoría (si de verdad cambió algo)
  if not v_ya_estaba then
    insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
    values (p_usuario, 'reasignar_proveedor', 'productos', p_producto::text,
      jsonb_build_object('proveedor', v_antes, 'decidido', v_decidido_antes, 'vinculos_sacados', v_sacados),
      jsonb_build_object('proveedor', jsonb_build_object('id', v_prov.id, 'razonSocial', v_prov.razon_social),
        'producto', jsonb_build_object('sku', v_prod.sku, 'nombre', v_prod.nombre),
        'vinculo_nuevo', not v_tenia_vinculo, 'quedan', v_quedan, 'pantalla', p_pantalla));
  end if;

  return jsonb_build_object(
    'producto', jsonb_build_object('id', v_prod.id, 'sku', v_prod.sku, 'nombre', v_prod.nombre),
    'antes', v_antes,
    'ahora', jsonb_build_object('id', v_prov.id, 'razonSocial', v_prov.razon_social),
    'yaEstaba', v_ya_estaba,
    'vinculoNuevo', not v_tenia_vinculo,
    'sacados', coalesce((select jsonb_agg(jsonb_build_object('id', s->>'proveedor_id', 'razonSocial', s->>'razon_social')) from jsonb_array_elements(v_sacados) s), '[]'::jsonb),
    'quedan', v_quedan);
end;
$$;
revoke all on function public.reasignar_proveedor(uuid, uuid, uuid, text) from public, anon, authenticated;

-- 3. «Qué comprar»: el decidido manda sobre el último que se lo vendió
do $parche$
declare
  d text := pg_get_functiondef('public.abastecimiento'::regproc);
  viejo text := E'  from prov_cand pc join proveedores pr on pr.id = pc.proveedor_id and pr.activo\n  order by pc.producto_id, pc.fecha desc\n';
  nuevo text := E'  from prov_cand pc join proveedores pr on pr.id = pc.proveedor_id and pr.activo\n'
    || E'  left join proveedor_decidido pd on pd.producto_id = pc.producto_id\n'
    || E'  order by pc.producto_id, (pc.proveedor_id = pd.proveedor_id) desc nulls last, pc.fecha desc\n';
begin
  if position('left join proveedor_decidido pd on pd.producto_id = pc.producto_id' in d) > 0 then
    raise notice 'abastecimiento ya respeta el proveedor decidido: no se toca';
    return;
  end if;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then
    raise exception 'abastecimiento cambió: revisar a mano el bloque prov';
  end if;
  execute replace(d, viejo, nuevo);
end;
$parche$;

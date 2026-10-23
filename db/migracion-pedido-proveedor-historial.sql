-- PEDIDO A PROVEEDOR: el sugerido usa también las ventas del sistema viejo, y la
-- lista va de menor a mayor stock (Leandro, 23/10/2026: «que los ordene de menor
-- a mayor; los que menos stock tienen vayan arriba y más en rojo»).
--
-- Antes la venta por día salía solo de las ventas de ODB, que casi no tiene: todo
-- sugerido daba 0 (Branca: Macallan Triple Cask en 0 de stock, sugerido 0). Ahora
-- se suma el historial del sistema viejo (ventas_historicas, por período),
-- prorrateado por los días del período que caen en la ventana. El historial llega
-- hasta el corte de la exportación; desde ahí cuentan las ventas de ODB, así que
-- no se cuenta dos veces.
-- Misma firma y mismas columnas: la API no cambia.

create or replace function catalogo_proveedor(p_proveedor uuid, p_sucursal uuid, p_q text default null,
  p_dias_venta integer default 30, p_dias_cobertura integer default 14, p_dias_urgente integer default 5,
  p_solo_faltantes boolean default false, p_limite integer default 300)
returns table(sku text, nombre text, unidades_pack integer, codigo_proveedor text, costo numeric, stock numeric,
  minimo numeric, reposicion numeric, por_dia numeric, dias_de_stock integer, sugerido numeric, urgente boolean, total bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with bus as (select producto_id from public.buscar_productos(p_q, true) where btrim(coalesce(p_q, '')) <> ''),
  base as (
    select p.sku, p.nombre, coalesce(p.unidades_pack,1) as unidades_pack,
           pp.codigo_proveedor, pp.ultimo_costo as costo,
           coalesce(st.cantidad,0) as stock,
           coalesce(st.stock_minimo,0) as minimo,
           coalesce(st.punto_reposicion,0) as reposicion,
           (coalesce((select sum(vi.cantidad)
                       from ventas_items vi join ventas v on v.id=vi.venta_id
                      where vi.producto_id=p.id and v.estado <> 'anulada'
                        and v.vendida_en >= now() - (p_dias_venta||' days')::interval
                        and (p_sucursal is null or v.sucursal_id=p_sucursal)),0)
            + coalesce((select sum(vh.unidades
                          * greatest(0, least(vh.hasta, current_date) - greatest(vh.desde, current_date - p_dias_venta) + 1)::numeric
                          / greatest(1, vh.hasta - vh.desde + 1))
                       from ventas_historicas vh
                      where vh.producto_id = p.id and vh.hasta >= current_date - p_dias_venta
                        and (p_sucursal is null or vh.sucursal_id = p_sucursal)),0)
           ) / greatest(p_dias_venta,1) as por_dia
    from proveedor_productos pp
    join productos p on p.id = pp.producto_id and p.activo
    left join stock st on st.producto_id = p.id and st.sucursal_id = p_sucursal
    where pp.proveedor_id = p_proveedor
      and (btrim(coalesce(p_q, '')) = ''
           or p.id in (select producto_id from bus)
           or public.coincide_busqueda(public.quitar_tildes(coalesce(pp.codigo_proveedor, '')), public.terminos_busqueda(p_q)))
  ),
  calc as (
    select b.*,
           case when por_dia > 0 then floor(stock/por_dia)::int else null end as dias_de_stock,
           greatest(0, ceil(greatest(por_dia*p_dias_cobertura,
                     case when reposicion > 0 then reposicion else minimo*2 end) - stock)) as sugerido,
           (minimo > 0 and stock <= minimo)
             or (por_dia > 0 and floor(stock/por_dia) <= p_dias_urgente) as urgente
    from base b
  ),
  filtrada as (
    select * from calc
    where not p_solo_faltantes or urgente or sugerido > 0
  )
  select sku, nombre, unidades_pack, codigo_proveedor, costo, stock, minimo, reposicion,
         round(por_dia,2), dias_de_stock, sugerido, urgente, count(*) over () as total
  from filtrada
  order by stock asc, por_dia desc, nombre
  limit greatest(p_limite, 1);
$function$;

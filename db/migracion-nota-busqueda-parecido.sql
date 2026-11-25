-- EL BUSCADOR DE LA NOTA DE PEDIDO ORDENA POR PARECIDO (25/11/2026). Desde Santa
-- Inés, en la nota N.º 14 («pepsico»): «el producto 3D… si aparece en la búsqueda
-- de arriba, pero no tengo manera de poder encontrarlo allá».
--
-- «3D» se busca como «3» (la letra suelta no cuenta): 4.748 productos. La nota los
-- ordenaba con los sin stock arriba y cortaba en 40; el 3D x 85g tiene 3 en Santa
-- Inés y quedaba afuera (salían la Figacita, la Coca Cola lata 354cc, el Mister
-- Pops…). El buscador de arriba ordena por parecido y lo muestra primero.
-- Ahora, buscando, la nota ordena igual: nivel, si está en el nombre y parecido;
-- después, lo de siempre. Sin buscar (lo que falta en la sucursal) no cambia.
--
-- Misma firma y mismas columnas: la API no cambia. APLICADA por MCP en
-- utemmsmuwocerhmuxrbs (nota_busqueda_por_parecido).
create or replace function public.faltantes_sucursal(
  p_sucursal uuid, p_q text default null, p_dias_venta integer default 30, p_dias_cobertura integer default 14,
  p_dias_urgente integer default 5, p_solo_faltantes boolean default true, p_limite integer default 300)
returns table(sku text, nombre text, unidades_pack integer, costo numeric, stock numeric, minimo numeric, reposicion numeric,
  por_dia numeric, dias_de_stock integer, sugerido numeric, urgente boolean, proveedores text, total bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with bus as (
    -- con la relevancia del buscador de arriba (nivel, en el nombre, parecido)
    select producto_id, min(nivel) as nivel, bool_or(en_nombre) as en_nombre, max(parecido) as parecido
    from public.buscar_productos(p_q, true) where btrim(coalesce(p_q, '')) <> ''
    group by producto_id
  ),
  vend as (
    select vi.producto_id, sum(vi.cantidad) as u
    from ventas_items vi join ventas v on v.id = vi.venta_id
    where v.estado <> 'anulada' and v.vendida_en >= now() - (p_dias_venta || ' days')::interval
      and (p_sucursal is null or v.sucursal_id = p_sucursal)
    group by vi.producto_id
  ),
  hist as (
    select vh.producto_id, sum(vh.unidades * greatest(0, least(vh.hasta, current_date) - greatest(vh.desde, current_date - p_dias_venta) + 1)::numeric
                                 / greatest(1, vh.hasta - vh.desde + 1)) as u
    from ventas_historicas vh
    where vh.hasta >= current_date - p_dias_venta and (p_sucursal is null or vh.sucursal_id = p_sucursal)
    group by vh.producto_id
  ),
  base as (
    select p.id, p.sku, p.nombre, coalesce(p.unidades_pack, 1) as unidades_pack, p.costo,
           coalesce(st.cantidad, 0) as stock, coalesce(st.stock_minimo, 0) as minimo, coalesce(st.punto_reposicion, 0) as reposicion,
           (coalesce(vend.u, 0) + coalesce(hist.u, 0)) / greatest(p_dias_venta, 1) as por_dia,
           bus.nivel as rel_nivel, bus.en_nombre as rel_en_nombre, bus.parecido as rel_parecido
    from productos p
    left join bus on bus.producto_id = p.id
    left join stock st on st.producto_id = p.id and st.sucursal_id = p_sucursal
    left join vend on vend.producto_id = p.id
    left join hist on hist.producto_id = p.id
    where p.activo and (btrim(coalesce(p_q, '')) = '' or bus.producto_id is not null)
  ),
  calc as (
    select b.*,
           case when por_dia > 0 then floor(stock / por_dia)::int else null end as dias_de_stock,
           greatest(0, ceil(greatest(por_dia * p_dias_cobertura, case when reposicion > 0 then reposicion else minimo * 2 end) - stock)) as sugerido,
           (minimo > 0 and stock <= minimo) or (por_dia > 0 and floor(stock / por_dia) <= p_dias_urgente) as urgente
    from base b
  ),
  filtrada as (
    select * from calc
    where not p_solo_faltantes or ((por_dia > 0 or minimo > 0) and (urgente or sugerido > 0))
  )
  select f.sku, f.nombre, f.unidades_pack, f.costo, f.stock, f.minimo, f.reposicion, round(f.por_dia, 2), f.dias_de_stock, f.sugerido, f.urgente,
         (select string_agg(pr.razon_social, ' · ' order by pp.actualizado_en desc nulls last)
            from proveedor_productos pp join proveedores pr on pr.id = pp.proveedor_id where pp.producto_id = f.id) as proveedores,
         count(*) over () as total
  from filtrada f
  -- buscando: primero lo que más se parece a lo escrito; sin buscar (y entre iguales), lo de siempre
  order by f.rel_nivel nulls last, f.rel_en_nombre desc nulls last, f.rel_parecido desc nulls last,
           (f.stock <= 0) desc, f.urgente desc, f.por_dia desc, f.nombre
  limit greatest(p_limite, 1);
$function$;
revoke all on function public.faltantes_sucursal(uuid, text, integer, integer, integer, boolean, integer) from public, anon, authenticated;

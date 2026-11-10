-- STOCK NAVEGABLE (Leandro, 10/11/2026): «Hay que hacer mejor el módulo de
-- stock. Tiene que tener muchos más filtros, se tiene que poder hacer por
-- rubro, por un montón de variables. Tiene que ser mucho más navegable que
-- ahora. Está muy estático».
--
-- Una sola función: filtra, ordena y recorta en la base (PostgREST corta en
-- 1.000 filas y el catálogo tiene 10.800 activos), y de paso cuenta cuántos
-- hay en cada estado, rubro, marca y proveedor con los demás filtros puestos,
-- para que esos conteos se puedan tocar y filtrar.
--
-- Una fila por producto: con sucursal, lo de esa sucursal; sin sucursal, la
-- suma de todas. La venta por día es la misma cuenta que faltantes_sucursal
-- (ventas del sistema + ventas_historicas del Crack prorrateadas).
--
-- Estados (uno por producto, en este orden):
--   negativo        stock < 0
--   sin_stock       stock = 0
--   bajo_minimo     stock ≤ mínimo o ≤ punto de reposición
--   se_termina      se vende y alcanza para ≤ p_dias_alerta días
--   sin_movimiento  hay stock y no se vendió nada en los días de venta
--   sobra           alcanza para más de p_dias_sobra días
--   normal          el resto
--
-- p_filtros (todas las claves opcionales):
--   q, sucursal, rubros[], marcas[], proveedor, estados[],
--   peso ('si'|'no'), activo ('si'|'no'|'todos', por defecto 'si'),
--   barras ('si'|'no'), cant_min, cant_max, valor_min, valor_max,
--   venta_min, venta_max (unidades vendidas en los días de venta)
create or replace function public.stock_explorar(
  p_filtros jsonb default '{}'::jsonb, p_orden text default 'nombre', p_desc boolean default false,
  p_limite integer default 50, p_desde integer default 0,
  p_dias_venta integer default 30, p_dias_alerta integer default 7, p_dias_sobra integer default 90)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with f as (
    select nullif(btrim(p_filtros->>'q'), '') as q,
           nullif(p_filtros->>'sucursal', '')::uuid as sucursal,
           nullif(p_filtros->>'proveedor', '')::uuid as proveedor,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_filtros->'rubros') x where x <> '' and x <> 'sin'), '{}') as rubros,
           coalesce(p_filtros->'rubros' ? 'sin', false) as rubro_sin,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_filtros->'marcas') x where x <> '' and x <> 'sin'), '{}') as marcas,
           coalesce(p_filtros->'marcas' ? 'sin', false) as marca_sin,
           coalesce((select array_agg(x) from jsonb_array_elements_text(p_filtros->'estados') x), '{}') as estados,
           p_filtros->>'peso' as peso,
           coalesce(nullif(p_filtros->>'activo', ''), 'si') as activo,
           p_filtros->>'barras' as barras,
           nullif(p_filtros->>'cant_min', '')::numeric as cant_min, nullif(p_filtros->>'cant_max', '')::numeric as cant_max,
           nullif(p_filtros->>'valor_min', '')::numeric as valor_min, nullif(p_filtros->>'valor_max', '')::numeric as valor_max,
           nullif(p_filtros->>'venta_min', '')::numeric as venta_min, nullif(p_filtros->>'venta_max', '')::numeric as venta_max
  ),
  bus as (select b.producto_id from f, public.buscar_productos(f.q, false) b where f.q is not null),
  vend as (
    select vi.producto_id, sum(vi.cantidad) as u
    from f, ventas_items vi join ventas v on v.id = vi.venta_id
    where v.estado <> 'anulada' and v.vendida_en >= now() - (p_dias_venta || ' days')::interval
      and (f.sucursal is null or v.sucursal_id = f.sucursal)
    group by vi.producto_id
  ),
  hist as (
    select vh.producto_id, sum(vh.unidades * greatest(0, least(vh.hasta, current_date) - greatest(vh.desde, current_date - p_dias_venta) + 1)::numeric
                                 / greatest(1, vh.hasta - vh.desde + 1)) as u
    from f, ventas_historicas vh
    where vh.hasta >= current_date - p_dias_venta and (f.sucursal is null or vh.sucursal_id = f.sucursal)
    group by vh.producto_id
  ),
  st as (
    select s.producto_id, sum(s.cantidad) as cantidad, sum(coalesce(s.stock_minimo, 0)) as minimo,
           sum(coalesce(s.punto_reposicion, 0)) as reposicion
    from f, stock s
    where f.sucursal is null or s.sucursal_id = f.sucursal
    group by s.producto_id
  ),
  base as (
    select p.id, p.sku, p.nombre, p.activo, coalesce(p.vendido_por_peso, false) as por_peso, coalesce(p.costo, 0) as costo,
           p.categoria_id, c.nombre as rubro, p.marca_id, m.nombre as marca,
           exists (select 1 from codigos_barras cb where cb.producto_id = p.id) as con_barras,
           coalesce(st.cantidad, 0) as stock, coalesce(st.minimo, 0) as minimo, coalesce(st.reposicion, 0) as reposicion,
           coalesce(vend.u, 0) + coalesce(hist.u, 0) as venta
    from f, productos p
    left join categorias c on c.id = p.categoria_id
    left join marcas m on m.id = p.marca_id
    left join st on st.producto_id = p.id
    left join vend on vend.producto_id = p.id
    left join hist on hist.producto_id = p.id
    where (f.activo = 'todos' or p.activo = (f.activo = 'si'))
      and (f.q is null or p.id in (select producto_id from bus))
  ),
  calc as (
    select b.*,
           round(b.venta / greatest(p_dias_venta, 1), 2) as por_dia,
           case when b.venta > 0 then floor(b.stock / (b.venta / greatest(p_dias_venta, 1)))::int end as dias,
           round(greatest(b.stock, 0) * b.costo, 2) as valor
    from base b
  ),
  est as (
    select c.*,
           case when stock < 0 then 'negativo'
                when stock = 0 then 'sin_stock'
                when (minimo > 0 and stock <= minimo) or (reposicion > 0 and stock <= reposicion) then 'bajo_minimo'
                when dias is not null and dias <= p_dias_alerta then 'se_termina'
                when venta = 0 then 'sin_movimiento'
                when dias > p_dias_sobra then 'sobra'
                else 'normal' end as estado
    from calc c
  ),
  -- cada dimensión por separado, así los conteos de una se hacen con las demás puestas
  marcado as (
    select e.*,
           (cardinality(f.rubros) = 0 and not f.rubro_sin) or e.categoria_id = any(f.rubros) or (f.rubro_sin and e.categoria_id is null) as ok_rubro,
           (cardinality(f.marcas) = 0 and not f.marca_sin) or e.marca_id = any(f.marcas) or (f.marca_sin and e.marca_id is null) as ok_marca,
           f.proveedor is null or exists (select 1 from proveedor_productos pp where pp.producto_id = e.id and pp.proveedor_id = f.proveedor) as ok_proveedor,
           cardinality(f.estados) = 0 or e.estado = any(f.estados) as ok_estado,
           (f.peso is null or f.peso = '' or e.por_peso = (f.peso = 'si'))
             and (f.barras is null or f.barras = '' or e.con_barras = (f.barras = 'si'))
             and (f.cant_min is null or e.stock >= f.cant_min) and (f.cant_max is null or e.stock <= f.cant_max)
             and (f.valor_min is null or e.valor >= f.valor_min) and (f.valor_max is null or e.valor <= f.valor_max)
             and (f.venta_min is null or e.venta >= f.venta_min) and (f.venta_max is null or e.venta <= f.venta_max) as ok_resto
    from est e, f
  ),
  filtrada as (
    select * from marcado where ok_rubro and ok_marca and ok_proveedor and ok_estado and ok_resto
  ),
  -- el orden va en la ventana: así la página sale en ese orden y con desempate único (sku)
  ordenada as (
    select fi.*, row_number() over (order by
      case when not p_desc then case p_orden when 'sku' then sku when 'rubro' then rubro when 'marca' then marca when 'estado' then estado end end asc nulls last,
      case when p_desc then case p_orden when 'sku' then sku when 'rubro' then rubro when 'marca' then marca when 'estado' then estado end end desc nulls last,
      case when not p_desc then case p_orden when 'stock' then stock when 'valor' then valor when 'costo' then costo when 'venta' then venta
                                              when 'dias' then dias when 'minimo' then minimo end end asc nulls last,
      case when p_desc then case p_orden when 'stock' then stock when 'valor' then valor when 'costo' then costo when 'venta' then venta
                                          when 'dias' then dias when 'minimo' then minimo end end desc nulls last,
      case when p_desc and p_orden = 'nombre' then nombre end desc,
      nombre, sku) as rn
    from filtrada fi
  ),
  pagina as (
    select * from ordenada where rn > greatest(p_desde, 0) order by rn limit least(greatest(p_limite, 1), 20000)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'totales', (select jsonb_build_object('unidades', coalesce(sum(greatest(stock, 0)), 0), 'valor', coalesce(sum(valor), 0),
                                          'venta', coalesce(sum(venta), 0)) from filtrada),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'sku', pg.sku, 'nombre', pg.nombre, 'activo', pg.activo, 'por_peso', pg.por_peso, 'con_barras', pg.con_barras,
        'rubro', pg.rubro, 'marca', pg.marca, 'costo', pg.costo, 'stock', pg.stock, 'minimo', pg.minimo,
        'reposicion', pg.reposicion, 'venta', round(pg.venta, 2), 'por_dia', pg.por_dia, 'dias', pg.dias,
        'valor', pg.valor, 'estado', pg.estado,
        'proveedores', (select string_agg(pr.razon_social, ' · ' order by pp.actualizado_en desc nulls last)
                          from proveedor_productos pp join proveedores pr on pr.id = pp.proveedor_id where pp.producto_id = pg.id))
        order by pg.rn) from pagina pg), '[]'::jsonb),
    'estados', coalesce((select jsonb_object_agg(estado, n) from (
        select estado, count(*) as n from marcado where ok_rubro and ok_marca and ok_proveedor and ok_resto group by estado) x), '{}'::jsonb),
    'rubros', coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(id::text, 'sin'), 'nombre', coalesce(nombre, 'Sin rubro'), 'n', n, 'valor', valor) order by n desc, nombre) from (
        select categoria_id as id, rubro as nombre, count(*) as n, sum(valor) as valor from marcado
        where ok_estado and ok_marca and ok_proveedor and ok_resto group by 1, 2) x), '[]'::jsonb),
    'marcas', coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(id::text, 'sin'), 'nombre', coalesce(nombre, 'Sin marca'), 'n', n) order by n desc, nombre) from (
        select marca_id as id, marca as nombre, count(*) as n from marcado
        where ok_estado and ok_rubro and ok_proveedor and ok_resto group by 1, 2) x), '[]'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'n', n) order by n desc, nombre) from (
        select pr.id, pr.razon_social as nombre, count(distinct mk.id) as n
        from marcado mk join proveedor_productos pp on pp.producto_id = mk.id join proveedores pr on pr.id = pp.proveedor_id
        where mk.ok_estado and mk.ok_rubro and mk.ok_marca and mk.ok_resto group by 1, 2) x), '[]'::jsonb)
  );
$function$;
revoke all on function public.stock_explorar(jsonb, text, boolean, integer, integer, integer, integer, integer) from public, anon, authenticated;

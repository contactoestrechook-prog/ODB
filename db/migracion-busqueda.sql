-- Búsqueda de texto única para todo el sistema (2/10/2026).
--
-- "café cabrales" no encontraba nada en el agente de compras: los productos se
-- llaman "Cafe Cabrales ..." y la búsqueda comparaba la frase entera, con
-- tildes. El mismo error estaba en la caja (pos_buscar), el stock del bot
-- (stock_consulta) y el catálogo del proveedor. Ahora todas usan
-- buscar_productos(), con una sola regla:
--   1. todas las palabras, en cualquier orden, sin importar tildes ni
--      mayúsculas ("Café" = "cafe"), plurales a su raíz ("cafés" → "caf"),
--      números sin unidad ("x250grs" → "250") y sin palabras vacías ("de", "x");
--   2. si así no aparece nada: errores de tipeo ("cabrlaes", "coca zreo");
--   3. si tampoco: con una palabra de menos (si se buscaron 2 o más).
-- terminos_busqueda() está copiada en TypeScript (apps/api/src/comun/busqueda.ts
-- y apps/admin/app/lib/busqueda.ts): si se toca una, se tocan las tres.

create extension if not exists fuzzystrmatch with schema public;

-- Las palabras de una búsqueda, normalizadas: "cruda" (como se escribió, sin
-- tildes) y "raiz" (sin plural; los números sin unidad).
create or replace function public.palabras_de_busqueda(q text)
returns table(cruda text, raiz text)
language sql immutable parallel safe
set search_path = public
as $$
  select w,
         case
           when w ~ '[0-9]' then substring(w from '[0-9]+')
           when length(w) > 4 and w like '%es' then left(w, -2)
           when length(w) > 3 and w like '%s' then left(w, -1)
           else w end
  from regexp_split_to_table(public.quitar_tildes(coalesce(q, '')), '[^a-z0-9]+') w
  where w <> '' and (w ~ '[0-9]' or length(w) >= 2)
    and w not in ('de','del','la','las','el','los','lo','y','e','o','u','con','para','en','por','al',
                  'un','una','unos','unas','x','g','gr','grs','gramo','gramos','kg','kgs','kilo','kilos',
                  'ml','cc','l','lt','lts','litro','litros','cm','mm','unid','unidad','unidades','ud','uds')
$$;

-- Las raíces, sin repetir. Si todo eran palabras vacías ("de", "x"), se busca
-- tal cual.
create or replace function public.terminos_busqueda(q text)
returns text[]
language sql immutable parallel safe
set search_path = public
as $$
  select coalesce(
    (select array_agg(distinct raiz order by raiz) from public.palabras_de_busqueda(q) where raiz <> ''),
    case when btrim(public.quitar_tildes(coalesce(q, ''))) <> ''
         then array[btrim(public.quitar_tildes(q))] else '{}'::text[] end)
$$;

-- ¿El texto (ya normalizado) tiene TODAS las palabras?
create or replace function public.coincide_busqueda(texto text, terminos text[])
returns boolean
language sql immutable parallel safe
as $$
  select coalesce(texto, '') like all (select '%' || t || '%' from unnest(terminos) t)
$$;

create or replace function public.letras_ordenadas(w text)
returns text
language sql immutable parallel safe
as $$
  select string_agg(c, '' order by c) from regexp_split_to_table(coalesce(w, ''), '') c
$$;

-- ¿La palabra w del producto se parece a la palabra buscada r (cruda)? Vale
-- la palabra entera o su comienzo (si todavía se está escribiendo): una letra
-- de diferencia hasta 6 letras, dos desde 7, y dos letras dadas vuelta en
-- cualquier largo ("zreo" → "zero", "brnaca" → "branca").
-- Sin SET search_path a propósito: así Postgres la mete dentro de la consulta.
create or replace function public.palabra_parecida(r text, w text)
returns boolean
language sql immutable parallel safe
as $$
  select case
    when length(w) < length(r) - 2 then false
    when public.levenshtein_less_equal(r, w, 2) <= case when length(r) >= 7 then 2 else 1 end then true
    when public.levenshtein_less_equal(r, left(w, length(r)), 2) <= case when length(r) >= 7 then 2 else 1 end then true
    when public.levenshtein_less_equal(r, left(w, length(r)), 2) = 2
      then public.letras_ordenadas(r) = public.letras_ordenadas(left(w, length(r)))
    else false end
$$;

-- El texto donde se busca, normalizado una sola vez al guardar.
alter table public.productos add column if not exists texto_busqueda text
  generated always as (public.quitar_tildes(coalesce(nombre, '') || ' ' || coalesce(alias_busqueda, '') || ' ' || coalesce(sku, ''))) stored;
alter table public.productos add column if not exists palabras_busqueda text[]
  generated always as (regexp_split_to_array(public.quitar_tildes(coalesce(nombre, '') || ' ' || coalesce(alias_busqueda, '') || ' ' || coalesce(sku, '')), '[^a-z0-9]+')) stored;
create index if not exists productos_texto_busqueda_trgm on public.productos using gin (texto_busqueda gin_trgm_ops);
create index if not exists productos_palabras_busqueda_gin on public.productos using gin (palabras_busqueda);

alter table public.clientes add column if not exists texto_busqueda text
  generated always as (public.quitar_tildes(coalesce(nombre, '') || ' ' || coalesce(razon_social, '') || ' ' || coalesce(dni, '') || ' ' || coalesce(cuit, ''))) stored;
create index if not exists clientes_texto_busqueda_trgm on public.clientes using gin (texto_busqueda gin_trgm_ops);

alter table public.proveedores add column if not exists texto_busqueda text
  generated always as (public.quitar_tildes(coalesce(razon_social, '') || ' ' || coalesce(cuit, ''))) stored;

-- Los productos que coinciden con una búsqueda. nivel: 1 = todas las palabras,
-- 2 = con errores de tipeo, 3 = con una palabra de menos. Solo se pasa al
-- nivel siguiente si el anterior no trajo nada. en_nombre: las palabras están
-- en el nombre (no solo en el alias), para ordenar. parecido: para ordenar los
-- niveles 2 y 3.
create or replace function public.buscar_productos(p_q text, p_solo_activos boolean default true)
returns table(producto_id uuid, nivel smallint, en_nombre boolean, parecido real)
language plpgsql stable
set search_path = public
as $$
declare
  ter text[] := public.terminos_busqueda(p_q);
  larga text;
begin
  if coalesce(array_length(ter, 1), 0) = 0 then return; end if;
  select t into larga from unnest(ter) t order by length(t) desc, t limit 1;

  -- 1. Todas las palabras. Dinámica para que use el índice de trigramas con la
  --    palabra más larga (como consulta fija tardaba 90 ms; así, 2 ms).
  return query execute $q$
    select p.id, 1::smallint, public.coincide_busqueda(p.nombre_normalizado, $1),
           similarity(public.quitar_tildes($3), p.nombre_normalizado)
    from productos p
    where (not $4 or p.activo)
      and p.texto_busqueda like '%' || $2 || '%'
      and public.coincide_busqueda(p.texto_busqueda, $1)
  $q$ using ter, larga, p_q, p_solo_activos;
  if found then return; end if;

  -- 2. Errores de tipeo: cada palabra está o hay una parecida en el vocabulario
  --    (se compara la palabra como se escribió, no la raíz: "cabrlaes" se
  --    parece a "cabrales"; su raíz "cabrla", a "cabra").
  --    Solo si hay alguna palabra de 4 letras o más (un código de barras que no
  --    existe no tiene que recorrer el vocabulario: la caja lo nota).
  if exists (select 1 from public.palabras_de_busqueda(p_q) where cruda !~ '[0-9]' and length(cruda) >= 4) then
    return query execute $q$
      with pal as (select distinct cruda, raiz from public.palabras_de_busqueda($2) where raiz !~ '^[0-9]+$'),
      voc as (select distinct unnest(palabras_busqueda) w from productos where activo),
      var as (
        select pal.raiz, coalesce(array_agg(voc.w) filter (where voc.w is not null), '{}') ws
        from pal left join voc on length(pal.cruda) >= 4 and public.palabra_parecida(pal.cruda, voc.w)
        group by pal.raiz
      )
      select p.id, 2::smallint, false, similarity(public.quitar_tildes($2), p.nombre_normalizado)
      from productos p
      where (not $3 or p.activo)
        and exists (select 1 from var)
        and not exists (select 1 from var
                        where not (p.texto_busqueda like '%' || var.raiz || '%' or p.palabras_busqueda && var.ws))
    $q$ using ter, p_q, p_solo_activos;
    if found then return; end if;
  end if;

  -- 3. Con una palabra de menos ("leche ls sachet": la factura abrevia y el
  --    catálogo dice "La Serenisima"; "leche lz": se ve la leche). Ordenado
  --    por parecido, así lo más cercano queda arriba.
  if array_length(ter, 1) >= 2 then
    return query execute $q$
      select p.id, 3::smallint, false, similarity(public.quitar_tildes($2), p.nombre_normalizado)
      from productos p
      where (not $3 or p.activo)
        and (select count(*) from unnest($1) t where position(t in p.texto_busqueda) = 0) = 1
    $q$ using ter, p_q, p_solo_activos;
  end if;
end $$;

-- Caja: primero lo que coincide por código; después lo que tiene las palabras
-- en el NOMBRE, después en el alias, y al final los aproximados.
create or replace function public.pos_buscar(p_q text, p_limit integer default 8, p_sucursal uuid default null::uuid)
returns table(sku text, nombre text, precio numeric, precio_mayorista numeric, es_alcohol boolean, codigos text[], codigo text, stock numeric, activo boolean, ultimo_egreso timestamp with time zone, por_peso boolean, plu text)
language sql stable security definer
set search_path to 'public'
as $function$
  with lm as (select id from listas_precios where nombre = 'Minorista' limit 1),
  lma as (select id from listas_precios where nombre = 'Mayorista' limit 1),
  cod as (select cb.producto_id from codigos_barras cb where cb.codigo = trim(p_q)),
  bus as (select * from public.buscar_productos(p_q, true)),
  base as (
    select p.id, p.sku, p.nombre, p.es_alcohol, p.codigo_legacy, p.activo, p.vendido_por_peso, p.plu
    from productos p
    left join bus on bus.producto_id = p.id
    where (
      p.id in (select producto_id from cod)
      or p.codigo_legacy = trim(p_q)
      or (trim(p_q) ~ '^\d+$' and ltrim(coalesce(p.plu, p.codigo_legacy), '0') = ltrim(trim(p_q), '0'))
      or bus.producto_id is not null
      or (p.activo and p.sku ilike trim(p_q) || '%')
    )
    order by (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q) or (trim(p_q) ~ '^\d+$' and ltrim(coalesce(p.plu, p.codigo_legacy), '0') = ltrim(trim(p_q), '0'))) desc,
             p.activo desc,
             coalesce(bus.nivel, 1),
             coalesce(bus.en_nombre, true) desc,
             case when bus.nivel > 1 then bus.parecido end desc nulls last,
             p.nombre
    limit p_limit
  )
  select b.sku, b.nombre,
    (select pr.precio from precios pr, lm where pr.producto_id = b.id and pr.lista_id = lm.id order by pr.vigente_desde desc limit 1),
    (select pr.precio from precios pr, lma where pr.producto_id = b.id and pr.lista_id = lma.id order by pr.vigente_desde desc limit 1),
    b.es_alcohol,
    coalesce((select array_agg(cb.codigo) from codigos_barras cb where cb.producto_id = b.id), '{}'),
    b.codigo_legacy,
    coalesce((select sum(s.cantidad) from stock s where s.producto_id = b.id and (p_sucursal is null or s.sucursal_id = p_sucursal)), 0),
    b.activo,
    (select max(m.creado_en) from movimientos_stock m where m.producto_id = b.id and (p_sucursal is null or m.sucursal_id = p_sucursal) and m.cantidad < 0),
    b.vendido_por_peso,
    coalesce(b.plu, b.codigo_legacy)
  from base b;
$function$;

-- Stock (lo usa el bot de WhatsApp y la consulta de stock del panel).
create or replace function public.stock_consulta(p_q text, p_limit integer default 10)
returns table(sku text, nombre text, codigo text, sucursales jsonb, total numeric)
language sql stable security definer
set search_path to 'public'
as $function$
  with cod as (select cb.producto_id from codigos_barras cb where cb.codigo = trim(p_q)),
  bus as (select * from public.buscar_productos(p_q, true)),
  base as (
    select p.id, p.sku, p.nombre, p.codigo_legacy,
      (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q)) as exacto
    from productos p
    left join bus on bus.producto_id = p.id
    where p.activo and (
      p.id in (select producto_id from cod)
      or p.codigo_legacy = trim(p_q)
      or bus.producto_id is not null
      or p.sku ilike trim(p_q) || '%'
    )
    order by (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q)) desc,
             coalesce(bus.nivel, 1),
             coalesce(bus.en_nombre, true) desc,
             case when bus.nivel > 1 then bus.parecido end desc nulls last,
             p.nombre
    limit p_limit
  )
  select b.sku, b.nombre, b.codigo_legacy,
    -- todas las sucursales activas, con su stock (0 si no hay fila)
    (select jsonb_agg(jsonb_build_object('sucursal', su.nombre, 'cantidad', coalesce(s.cantidad, 0)) order by su.nombre)
       from sucursales su
       left join stock s on s.producto_id = b.id and s.sucursal_id = su.id
       where su.activa) as sucursales,
    coalesce((select sum(s.cantidad) from stock s where s.producto_id = b.id), 0) as total
  from base b;
$function$;

-- Catálogo de un proveedor (pantalla de Compras): también por código del proveedor.
create or replace function public.catalogo_proveedor(p_proveedor uuid, p_sucursal uuid, p_q text default null::text, p_dias_venta integer default 30, p_dias_cobertura integer default 14, p_dias_urgente integer default 5, p_solo_faltantes boolean default false, p_limite integer default 300)
returns table(sku text, nombre text, unidades_pack integer, codigo_proveedor text, costo numeric, stock numeric, minimo numeric, reposicion numeric, por_dia numeric, dias_de_stock integer, sugerido numeric, urgente boolean, total bigint)
language sql stable security definer
set search_path to 'public'
as $function$
  with bus as (select producto_id from public.buscar_productos(p_q, true) where btrim(coalesce(p_q, '')) <> ''),
  base as (
    select p.sku, p.nombre, coalesce(p.unidades_pack,1) as unidades_pack,
           pp.codigo_proveedor, pp.ultimo_costo as costo,
           coalesce(st.cantidad,0) as stock,
           coalesce(st.stock_minimo,0) as minimo,
           coalesce(st.punto_reposicion,0) as reposicion,
           coalesce((select sum(vi.cantidad)/greatest(p_dias_venta,1)
                     from ventas_items vi join ventas v on v.id=vi.venta_id
                     where vi.producto_id=p.id and v.estado <> 'anulada'
                       and v.vendida_en >= now() - (p_dias_venta||' days')::interval
                       and (p_sucursal is null or v.sucursal_id=p_sucursal)),0) as por_dia
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
  order by urgente desc, por_dia desc, nombre
  limit greatest(p_limite, 1);
$function$;

-- Abastecimiento (agente de compras y pantalla de Qué comprar). La función es
-- una consulta dinámica larga (ver migracion-abastecimiento.sql); se cambia
-- solo el filtro de texto sobre la versión viva, y si el texto esperado no
-- está, la migración falla en vez de dejarla a medias.
do $parche$
declare
  d text := pg_get_functiondef('public.abastecimiento'::regproc);
  viejo_filtro text := $v$and ($4 is null or p.nombre ilike '%' || $4 || '%' or p.sku ilike $4 or coalesce(p.alias_busqueda, '') ilike '%' || $4 || '%')$v$;
  viejo_inicio text := E'with\nsuc as (';
  nuevo_inicio text := $n$with
-- productos que coinciden con la búsqueda (sin tildes, plurales ni orden; con
-- errores de tipeo si no hay nada): ver migracion-busqueda.sql
q_ids as (select producto_id id from public.buscar_productos($4, true) where $4 is not null),
suc as ($n$;
begin
  if position(viejo_filtro in d) = 0 or position(viejo_inicio in d) = 0 then
    raise exception 'abastecimiento cambió: revisar el parche de búsqueda a mano';
  end if;
  d := replace(d, viejo_filtro, 'and ($4 is null or b.producto_id in (select id from q_ids))');
  d := replace(d, viejo_inicio, nuevo_inicio);
  execute d;
end
$parche$;

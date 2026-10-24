-- ARQUEO DE STOCK (Leandro, 24/10/2026): «crear un arqueo de stock, cuando los
-- empleados vayan con la app haciendo el stock; hacémelo de la forma más pro».
--
-- Se apoya en el conteo cíclico que ya existía (conteos / conteos_items, nunca
-- usado) y lo lleva a un arqueo de verdad:
--   · ALCANCE: todo el local, rubros, un proveedor o una lista de productos.
--   · CONTEO CIEGO: el que cuenta nunca ve cuánto dice el sistema.
--   · CADA LECTURA QUEDA REGISTRADA (conteos_registros): quién, dónde
--     (góndola, depósito, heladera) y cuándo. El mismo producto en dos lugares
--     se suma. Una lectura equivocada se anula, no se borra.
--   · RECONTEO: lo que da una diferencia grande (unidades o pesos) se manda a
--     contar de nuevo; manda el reconteo.
--   · LO QUE NO SE CONTÓ: el sistema dice que hay y nadie lo contó; quien aplica
--     elige dejarlo como está o ponerlo en cero.
--   · APLICAR: un solo paso, con PIN de supervisor, por registrar_movimiento.
--     La diferencia se calcula contra el stock del sistema EN EL MOMENTO en que
--     se contó (stock actual menos lo que se movió después), así una venta
--     mientras se cuenta no ensucia el resultado.
-- Aditiva: la pantalla vieja de conteo sigue funcionando con las columnas viejas.

alter table conteos
  add column if not exists nombre text,
  add column if not exists alcance jsonb not null default '{"tipo":"todo"}'::jsonb,
  add column if not exists ciego boolean not null default true,
  add column if not exists umbral_unidades numeric not null default 2,
  add column if not exists umbral_pesos numeric not null default 10000,
  add column if not exists en_revision_en timestamptz,
  add column if not exists aplicado_en timestamptz,
  add column if not exists aplicado_por uuid references usuarios(id),
  add column if not exists autorizado_por uuid references usuarios(id),
  add column if not exists resumen jsonb;

create table if not exists conteos_registros (
  id uuid primary key,                       -- lo genera el celular: reintentar no duplica
  conteo_id uuid not null references conteos(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad numeric not null check (cantidad >= 0),
  ubicacion text,
  codigo_leido text,
  es_reconteo boolean not null default false,
  usuario_id uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  anulado_en timestamptz,
  anulado_por uuid references usuarios(id)
);
create index if not exists conteos_registros_conteo_idx on conteos_registros (conteo_id, producto_id) where anulado_en is null;
alter table conteos_registros enable row level security;

create table if not exists conteos_no_encontrados (
  id uuid primary key default gen_random_uuid(),
  conteo_id uuid not null references conteos(id) on delete cascade,
  codigo text not null,
  descripcion text,
  cantidad numeric,
  ubicacion text,
  usuario_id uuid references usuarios(id),
  creado_en timestamptz not null default now()
);
alter table conteos_no_encontrados enable row level security;

create table if not exists conteos_reconteos (
  conteo_id uuid not null references conteos(id) on delete cascade,
  producto_id uuid not null references productos(id),
  motivo text,
  pedido_en timestamptz not null default now(),
  primary key (conteo_id, producto_id)
);
alter table conteos_reconteos enable row level security;

-- Lo que entra en el arqueo: productos activos del alcance a los que el sistema
-- les da stock en la sucursal (lo que hay que encontrar en la góndola).
create or replace function arqueo_esperados(p_conteo uuid)
returns table(producto_id uuid, stock numeric)
language sql stable security definer set search_path to 'public'
as $$
  with c as (select * from conteos where id = p_conteo),
  cats as (
    with recursive arbol(id) as (
      select (x)::uuid from c, jsonb_array_elements_text(coalesce(c.alcance->'ids', '[]'::jsonb)) x
      where c.alcance->>'tipo' = 'categorias'
      union select k.id from categorias k join arbol a on k.padre_id = a.id
    ) select id from arbol
  )
  select s.producto_id, s.cantidad
  from c join stock s on s.sucursal_id = c.sucursal_id and s.cantidad <> 0
  join productos p on p.id = s.producto_id and p.activo
  where case c.alcance->>'tipo'
    when 'categorias' then p.categoria_id in (select id from cats)
    when 'proveedor' then exists (select 1 from proveedor_productos pp where pp.producto_id = p.id and pp.proveedor_id = (c.alcance->>'id')::uuid)
    when 'productos' then p.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(c.alcance->'ids', '[]'::jsonb)) x)
    else true end;
$$;

-- Una lectura del que cuenta. Idempotente por id. Devuelve lo que lleva contado
-- ESE producto (por esta persona y en total), nunca el stock del sistema.
create or replace function arqueo_registrar(p_conteo uuid, p_id uuid, p_producto uuid, p_cantidad numeric,
  p_ubicacion text default null, p_codigo text default null, p_reconteo boolean default false, p_usuario uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_c conteos%rowtype; v_mio numeric; v_total numeric;
begin
  select * into v_c from conteos where id = p_conteo;
  if not found then raise exception 'No existe el arqueo'; end if;
  if v_c.estado = 'en_revision' and not p_reconteo then
    raise exception 'El arqueo está en revisión: solo se cargan reconteos';
  end if;
  if v_c.estado not in ('abierto', 'en_revision') then raise exception 'El arqueo está %', v_c.estado; end if;
  if p_cantidad is null or p_cantidad < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  if p_cantidad > 100000 then raise exception 'Cantidad fuera de rango: revisala'; end if;

  insert into conteos_registros (id, conteo_id, producto_id, cantidad, ubicacion, codigo_leido, es_reconteo, usuario_id)
  values (p_id, p_conteo, p_producto, p_cantidad, nullif(btrim(p_ubicacion), ''), nullif(btrim(p_codigo), ''), coalesce(p_reconteo, false), p_usuario)
  on conflict (id) do nothing;

  select coalesce(sum(cantidad) filter (where usuario_id is not distinct from p_usuario), 0), coalesce(sum(cantidad), 0)
    into v_mio, v_total
  from conteos_registros where conteo_id = p_conteo and producto_id = p_producto and anulado_en is null
    and es_reconteo = coalesce(p_reconteo, false);
  return jsonb_build_object('mio', v_mio, 'total', v_total);
end $$;

-- El estado de cada producto contado: cuánto se contó (si hay reconteo, manda
-- el reconteo), cuánto decía el sistema en el momento de contar y la diferencia
-- valorizada a costo.
create or replace function arqueo_items(p_conteo uuid)
returns table(producto_id uuid, sku text, nombre text, categoria text, contado numeric, registros integer,
  contadores integer, ubicaciones text, recontado boolean, contado_en timestamptz, stock_actual numeric,
  sistema numeric, diferencia numeric, costo numeric, valor_diferencia numeric, en_alcance boolean,
  reconteo_pedido boolean)
language sql stable security definer set search_path to 'public'
as $$
  with c as (select * from conteos where id = p_conteo),
  r as (select * from conteos_registros where conteo_id = p_conteo and anulado_en is null),
  hay_rec as (select distinct producto_id from r where es_reconteo),
  vale as (select r.* from r where r.es_reconteo = (r.producto_id in (select producto_id from hay_rec))),
  agg as (
    select v.producto_id, sum(v.cantidad) contado, count(*)::int registros, count(distinct v.usuario_id)::int contadores,
      string_agg(distinct coalesce(v.ubicacion, 'sin lugar'), ', ') ubicaciones, max(v.creado_en) contado_en,
      bool_or(v.es_reconteo) recontado
    from vale v group by v.producto_id
  ),
  esp as (select producto_id from arqueo_esperados(p_conteo))
  select a.producto_id, p.sku, p.nombre, k.nombre, a.contado, a.registros, a.contadores, a.ubicaciones, a.recontado,
    a.contado_en, coalesce(s.cantidad, 0),
    coalesce(s.cantidad, 0) - coalesce((select sum(m.cantidad) from movimientos_stock m
      where m.producto_id = a.producto_id and m.sucursal_id = c.sucursal_id and m.creado_en > a.contado_en), 0),
    null::numeric, null::numeric, null::numeric,
    a.producto_id in (select producto_id from esp),
    exists (select 1 from conteos_reconteos q where q.conteo_id = p_conteo and q.producto_id = a.producto_id)
  from agg a cross join c
  join productos p on p.id = a.producto_id
  left join categorias k on k.id = p.categoria_id
  left join stock s on s.producto_id = a.producto_id and s.sucursal_id = c.sucursal_id;
$$;

-- Lo mismo con la diferencia y su valor ya calculados (la función de arriba
-- deja los huecos para no repetir el cálculo del sistema en cada columna).
create or replace function arqueo_diferencias(p_conteo uuid)
returns table(producto_id uuid, sku text, nombre text, categoria text, contado numeric, registros integer,
  contadores integer, ubicaciones text, recontado boolean, contado_en timestamptz, stock_actual numeric,
  sistema numeric, diferencia numeric, costo numeric, valor_diferencia numeric, en_alcance boolean,
  reconteo_pedido boolean)
language sql stable security definer set search_path to 'public'
as $$
  select i.producto_id, i.sku, i.nombre, i.categoria, i.contado, i.registros, i.contadores, i.ubicaciones, i.recontado,
    i.contado_en, i.stock_actual, i.sistema, i.contado - i.sistema,
    co.costo, round((i.contado - i.sistema) * coalesce(co.costo, 0), 2), i.en_alcance, i.reconteo_pedido
  from arqueo_items(p_conteo) i
  left join lateral (
    select coalesce(nullif(p.costo, 0), (select min(pp.ultimo_costo) from proveedor_productos pp where pp.producto_id = i.producto_id and pp.ultimo_costo > 0)) costo
    from productos p where p.id = i.producto_id
  ) co on true;
$$;

-- Pasa el arqueo a revisión y pide reconteo de lo que supera el umbral.
create or replace function arqueo_a_revision(p_conteo uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_c conteos%rowtype; v_n int;
begin
  select * into v_c from conteos where id = p_conteo for update;
  if not found then raise exception 'No existe el arqueo'; end if;
  if v_c.estado not in ('abierto', 'en_revision') then raise exception 'El arqueo está %', v_c.estado; end if;
  update conteos set estado = 'en_revision', en_revision_en = coalesce(en_revision_en, now()) where id = p_conteo;
  insert into conteos_reconteos (conteo_id, producto_id, motivo)
  select p_conteo, d.producto_id,
    'Diferencia de ' || d.diferencia || ' u.' || case when d.valor_diferencia is not null and d.valor_diferencia <> 0 then ' ($' || to_char(abs(d.valor_diferencia), 'FM999G999G999') || ')' else '' end
  from arqueo_diferencias(p_conteo) d
  where not d.recontado and (abs(d.diferencia) >= v_c.umbral_unidades or abs(coalesce(d.valor_diferencia, 0)) >= v_c.umbral_pesos)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('reconteos_pedidos', v_n);
end $$;

-- Aplica el arqueo: ajusta cada diferencia en una sola transacción.
-- p_sin_contar: 'dejar' (lo que no se contó queda como está) o 'cero'.
create or replace function arqueo_aplicar(p_conteo uuid, p_usuario uuid, p_autorizado_por uuid, p_sin_contar text default 'dejar')
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_c conteos%rowtype; d record; v_dif numeric; v_actual numeric;
  v_items int := 0; v_ajustados int := 0; v_ok int := 0;
  v_mas numeric := 0; v_menos numeric := 0; v_val_mas numeric := 0; v_val_menos numeric := 0;
  v_cero int := 0; v_val_cero numeric := 0; v_pend int; v_resumen jsonb; v_motivo text;
begin
  select * into v_c from conteos where id = p_conteo for update;
  if not found then raise exception 'No existe el arqueo'; end if;
  if v_c.estado not in ('abierto', 'en_revision') then raise exception 'El arqueo ya está %', v_c.estado; end if;
  if p_autorizado_por is null then raise exception 'Aplicar un arqueo requiere autorización de un supervisor'; end if;
  if p_sin_contar not in ('dejar', 'cero') then raise exception 'Opción inválida para lo no contado'; end if;

  select count(*) into v_pend from conteos_reconteos q
  where q.conteo_id = p_conteo and not exists (
    select 1 from conteos_registros r where r.conteo_id = p_conteo and r.producto_id = q.producto_id and r.es_reconteo and r.anulado_en is null);
  if v_pend > 0 then raise exception 'Faltan % reconteos: recontalos o sacalos de la lista antes de aplicar', v_pend; end if;

  v_motivo := 'Arqueo «' || coalesce(v_c.nombre, left(p_conteo::text, 8)) || '»';
  for d in select * from arqueo_diferencias(p_conteo) loop
    v_items := v_items + 1;
    v_dif := d.diferencia;
    if v_dif = 0 then v_ok := v_ok + 1; continue; end if;
    -- nunca por debajo de cero (una venta después de contar ya lo bajó)
    select coalesce(cantidad, 0) into v_actual from stock where producto_id = d.producto_id and sucursal_id = v_c.sucursal_id;
    if coalesce(v_actual, 0) + v_dif < 0 then v_dif := -coalesce(v_actual, 0); end if;
    if v_dif = 0 then continue; end if;
    perform registrar_movimiento(d.producto_id, v_c.sucursal_id, 'ajuste', v_dif,
      v_motivo || ': sistema ' || d.sistema || ' → contado ' || d.contado, 'conteo', p_conteo::text, p_usuario);
    insert into conteos_items (conteo_id, producto_id, cantidad_contada, cantidad_sistema)
    values (p_conteo, d.producto_id, d.contado, d.sistema)
    on conflict (conteo_id, producto_id) do update set cantidad_contada = excluded.cantidad_contada, cantidad_sistema = excluded.cantidad_sistema;
    v_ajustados := v_ajustados + 1;
    if v_dif > 0 then v_mas := v_mas + v_dif; v_val_mas := v_val_mas + coalesce(v_dif * d.costo, 0);
    else v_menos := v_menos - v_dif; v_val_menos := v_val_menos - coalesce(v_dif * d.costo, 0); end if;
  end loop;

  if p_sin_contar = 'cero' then
    for d in
      select e.producto_id, s.cantidad, coalesce(nullif(p.costo, 0), 0) costo
      from arqueo_esperados(p_conteo) e
      join stock s on s.producto_id = e.producto_id and s.sucursal_id = v_c.sucursal_id and s.cantidad > 0
      join productos p on p.id = e.producto_id
      where not exists (select 1 from conteos_registros r where r.conteo_id = p_conteo and r.producto_id = e.producto_id and r.anulado_en is null)
    loop
      perform registrar_movimiento(d.producto_id, v_c.sucursal_id, 'ajuste', -d.cantidad,
        v_motivo || ': no se encontró al contar (sistema ' || d.cantidad || ' → 0)', 'conteo', p_conteo::text, p_usuario);
      v_cero := v_cero + 1; v_menos := v_menos + d.cantidad; v_val_cero := v_val_cero + d.cantidad * d.costo;
    end loop;
    v_val_menos := v_val_menos + v_val_cero;
  end if;

  v_resumen := jsonb_build_object(
    'productos_contados', v_items, 'sin_diferencia', v_ok, 'ajustados', v_ajustados,
    'exactitud_pct', case when v_items > 0 then round(100.0 * v_ok / v_items, 1) else null end,
    'unidades_sobrantes', v_mas, 'unidades_faltantes', v_menos,
    'valor_sobrante', round(v_val_mas, 2), 'valor_faltante', round(v_val_menos, 2),
    'no_contados_en_cero', v_cero, 'sin_contar', p_sin_contar);
  update conteos set estado = 'aplicado', aplicado_en = now(), aplicado_por = p_usuario, autorizado_por = p_autorizado_por, resumen = v_resumen
  where id = p_conteo;
  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_autorizado_por, 'arqueo_aplicado', 'conteo', p_conteo::text, v_resumen || jsonb_build_object('operador', p_usuario));
  return v_resumen;
end $$;

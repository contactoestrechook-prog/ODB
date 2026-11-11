-- PONER AL DÍA EL STOCK Y LAS VENTAS DE UN LOCAL (Leandro, 11/11/2026: «Sí, seguí»
-- con «ventas y stock del Crack al día», primera pieza de la propuesta de
-- abastecimiento).
--
-- Los locales todavía venden con su sistema. Hasta hoy, cada carga era una sesión
-- con los nueve CSV del Crack (scripts/sistema-viejo). Esto deja la parte de todos
-- los días (stock y ventas) hecha desde Mesa de compras › Qué comprar › «Poner al
-- día»: el navegador lee los dos archivos, la API arma el plan con la misma regla
-- del 10/11 (apps/api/src/abastecimiento/puesta-al-dia.ts) y esta función lo
-- aplica, todo o nada.
--
-- Son dos cambios:
--   1. el RITMO DE VENTA del motor pasa de «los dos últimos períodos cargados» a
--      dos ventanas fijas de 28 días;
--   2. la función aplicar_puesta_al_dia.

-- ============================================================
-- 1. EL RITMO, POR VENTANAS DE 28 DÍAS
-- ============================================================
-- abastecimiento() tomaba el último período cargado (70 %) y el anterior (30 %),
-- midieran lo que midieran. El 11/11 eso era: 70 % las ventas del 24/10 al 9/11
-- (17 días) y 30 % las del 21 al 23/10 (TRES días). Lo que no se había vendido
-- en esos 20 días quedaba con ritmo cero, aunque el motivo fuera que estaba sin
-- stock (Alfajor Guaymallen: 1 por día hasta octubre, cero después). Y con una
-- carga por día, el «último período» pasaría a ser un solo día.
--
-- Ahora: 70 % los últimos 28 días con datos de ese local y 30 % los 28 anteriores,
-- prorrateando cada período por los días que caen en la ventana (como ya hacen
-- catalogo_proveedor, stock_explorar y las estadísticas). El resultado no depende
-- de cómo se corten las cargas. Cuentan los períodos de hasta 31 días (los
-- cargados con detalle); uno más largo solo se usa si el local no tiene otra cosa.
--
-- Medido el 11/11, antes y después de aplicar (Sant Thomas; Santa Inés no cambia
-- porque tiene un solo período, el de julio):
--   productos con ritmo   3.324 → 4.519  (los que se vendieron en septiembre y
--                                         octubre pero no en los últimos 20 días)
--   suma de ritmos        1.716 → 1.730 unidades por día
--   sin stock             1.116 → 1.213  (97 que vendían y no tienen ni renglón de stock)
--   no llega                344 →   334
--   menos de 12           2.225 → 2.231
--   sugerido total       41.468 → 42.015 unidades
--
-- La función es una consulta dinámica larga (migracion-abastecimiento.sql, con el
-- parche de migracion-busqueda.sql): se cambian solo los tres bloques del ritmo
-- (periodos, per_suc, hist) sobre la versión viva y, si no están donde se esperan,
-- la migración falla en vez de dejarla a medias. Para volver atrás: los tres
-- bloques originales están en migracion-abastecimiento.sql.
-- (En producción se aplicó en dos pasos el 11/11: abastecimiento_ritmo_por_ventanas
-- y abastecimiento_ritmo_solo_periodos_cortos; este bloque deja el mismo resultado.)
do $parche$
declare
  d text := pg_get_functiondef('public.abastecimiento'::regproc);
  -- los bloques van seguidos, desde «periodos» (o «fin_suc», si ya se aplicó una
  -- versión anterior de este parche) hasta el que sigue («vivas_dias»)
  i int := coalesce(nullif(position(E'\nfin_suc as (' in d), 0), position(E'\nperiodos as (' in d));
  j int := position(E'\nvivas_dias as (' in d);
  nuevas text := $n$fin_suc as (
  select vh.sucursal_id,
         bool_or(vh.hasta - vh.desde < 31) hay_cortos,
         coalesce(max(vh.hasta) filter (where vh.hasta - vh.desde < 31), max(vh.hasta)) fin
  from ventas_historicas vh group by vh.sucursal_id
),
-- los períodos que cuentan: los cargados con detalle (hasta 31 días). Uno más
-- largo, prorrateado, le daría ritmo a lo que no se vende hace meses: solo se usa
-- si el local no tiene otra cosa.
periodos as (
  select distinct vh.sucursal_id, vh.desde, vh.hasta
  from ventas_historicas vh join fin_suc f on f.sucursal_id = vh.sucursal_id
  where not f.hay_cortos or vh.hasta - vh.desde < 31
),
-- d1 y d2: cuántos días de cada ventana tienen ventas cargadas (un feriado o un
-- hueco de carga no baja el ritmo)
per_suc as (
  select f.sucursal_id, f.fin hasta1,
         nullif((select count(*) from generate_series(f.fin - 27, f.fin, interval '1 day') g
                  where exists (select 1 from periodos pe where pe.sucursal_id = f.sucursal_id and g::date between pe.desde and pe.hasta)), 0)::numeric d1,
         nullif((select count(*) from generate_series(f.fin - 55, f.fin - 28, interval '1 day') g
                  where exists (select 1 from periodos pe where pe.sucursal_id = f.sucursal_id and g::date between pe.desde and pe.hasta)), 0)::numeric d2
  from fin_suc f
),
-- u1: unidades de los últimos 28 días con datos; u2: de los 28 anteriores. De cada
-- período cuenta solo la parte que cae en la ventana, prorrateada por días.
hist as (
  select vh.producto_id, vh.sucursal_id,
         sum(vh.unidades * greatest(0, least(vh.hasta, f.fin) - greatest(vh.desde, f.fin - 27) + 1)::numeric / (vh.hasta - vh.desde + 1)) u1,
         sum(vh.unidades * greatest(0, least(vh.hasta, f.fin - 28) - greatest(vh.desde, f.fin - 55) + 1)::numeric / (vh.hasta - vh.desde + 1)) u2
  from ventas_historicas vh
  join fin_suc f on f.sucursal_id = vh.sucursal_id
  where vh.producto_id is not null and vh.hasta > f.fin - 56
    and (not f.hay_cortos or vh.hasta - vh.desde < 31)
  group by vh.producto_id, vh.sucursal_id
),$n$;
begin
  if position('hay_cortos' in d) > 0 then
    raise notice 'abastecimiento ya calcula el ritmo por ventanas: no se toca';
    return;
  end if;
  if i = 0 or j = 0 or j < i or position('hist as (' in substr(d, i, j - i)) = 0 then
    raise exception 'abastecimiento cambió: revisar el parche del ritmo a mano';
  end if;
  execute substr(d, 1, i) || nuevas || substr(d, j);
end
$parche$;

-- ============================================================
-- 2. APLICAR UNA PUESTA AL DÍA
-- ============================================================
-- p_plan (lo arma la API, puesta-al-dia.ts):
--   { sucursal_id, referencia, corte,
--     stock:  [{ producto_id, objetivo, antes }],
--     ventas: [{ producto_id, sku, codigo, nombre, fecha, unidades }] }
--
-- Stock: se aplica la DIFERENCIA del plan (objetivo − antes) sobre lo que haya en
-- ese momento, igual que aplicar-csv.sql: lo que se movió entre simular y aplicar
-- se conserva. Nunca queda negativo. Cada cambio es un movimiento 'ajuste' con
-- referencia 'importacion' (el libro de stock sigue cuadrando).
-- Ventas: una fila por producto y por día, solo de días completos que faltaban.
-- Todo en una transacción; queda en auditoria con el plan, que sirve para deshacer.
create or replace function public.aplicar_puesta_al_dia(p_plan jsonb, p_usuario uuid default null)
returns jsonb
language plpgsql
set search_path = public
set statement_timeout to '120s'
as $fn$
declare
  v_suc uuid := (p_plan->>'sucursal_id')::uuid;
  v_ref text := p_plan->>'referencia';
  v_corte timestamptz := (p_plan->>'corte')::timestamptz;
  e jsonb; v_prod uuid; v_act numeric; v_nuevo numeric; v_delta numeric;
  n_stock int := 0; u_sube numeric := 0; u_baja numeric := 0; n_vh int := 0;
  v_ultima timestamptz; v_hasta date;
begin
  if v_suc is null or coalesce(v_ref, '') = '' or v_corte is null then
    raise exception 'Plan incompleto: falta el local, la referencia o el corte';
  end if;
  if not exists (select 1 from sucursales where id = v_suc and activa) then
    raise exception 'No existe ese local';
  end if;
  -- una sola carga a la vez por local
  perform pg_advisory_xact_lock(hashtext('puesta_al_dia:' || v_suc::text));
  if exists (select 1 from auditoria where accion = 'puesta_al_dia_aplicada' and entidad_id = v_ref
              and datos_despues->>'sucursal_id' = v_suc::text) then
    raise exception 'La carga % ya se aplicó', v_ref;
  end if;
  select greatest(
    (select max(creado_en) from movimientos_stock where sucursal_id = v_suc and referencia_tipo = 'importacion'),
    (select max(creado_en) from auditoria where accion = 'puesta_al_dia_aplicada' and datos_despues->>'sucursal_id' = v_suc::text)
  ) into v_ultima;
  if v_ultima is not null and v_corte <= v_ultima then
    raise exception 'El archivo es anterior a la última carga de este local';
  end if;
  if v_corte > now() + interval '10 minutes' then
    raise exception 'El corte del archivo es de una fecha futura';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_plan->'stock', '[]'::jsonb)) loop
    v_prod := (e->>'producto_id')::uuid;
    select coalesce((select cantidad from stock where producto_id = v_prod and sucursal_id = v_suc), 0) into v_act;
    v_nuevo := greatest(0, v_act + ((e->>'objetivo')::numeric - (e->>'antes')::numeric));
    v_delta := round(v_nuevo - v_act, 3);
    if abs(v_delta) >= 0.001 then
      perform registrar_movimiento(v_prod, v_suc, 'ajuste', v_delta,
        'Sincronización con el sistema del local (' || v_ref || ')', 'importacion', v_ref, p_usuario);
      n_stock := n_stock + 1;
      if v_delta > 0 then u_sube := u_sube + v_delta; else u_baja := u_baja - v_delta; end if;
    end if;
  end loop;

  select max(hasta) into v_hasta from ventas_historicas where sucursal_id = v_suc;
  insert into ventas_historicas (producto_id, sku, codigo_legacy, nombre, sucursal_id, unidades, desde, hasta, origen)
  select (f->>'producto_id')::uuid, f->>'sku', f->>'codigo', f->>'nombre', v_suc, (f->>'unidades')::numeric,
         (f->>'fecha')::date, (f->>'fecha')::date, v_ref
  from jsonb_array_elements(coalesce(p_plan->'ventas', '[]'::jsonb)) f
  where (f->>'fecha')::date > coalesce(v_hasta, date '1900-01-01')
    and (f->>'fecha')::date < (v_corte at time zone 'America/Argentina/Buenos_Aires')::date;
  get diagnostics n_vh = row_count;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'puesta_al_dia_aplicada', 'sucursal', v_ref, jsonb_build_object(
    'sucursal_id', v_suc, 'corte', v_corte, 'stock_ajustes', n_stock, 'stock_sube', u_sube, 'stock_baja', u_baja,
    'ventas_renglones', n_vh, 'plan_stock', coalesce(p_plan->'stock', '[]'::jsonb)));

  return jsonb_build_object('referencia', v_ref, 'stock_ajustes', n_stock, 'stock_sube', u_sube, 'stock_baja', u_baja,
                            'ventas_renglones', n_vh);
end $fn$;

revoke all on function public.aplicar_puesta_al_dia(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.aplicar_puesta_al_dia(jsonb, uuid) to service_role;

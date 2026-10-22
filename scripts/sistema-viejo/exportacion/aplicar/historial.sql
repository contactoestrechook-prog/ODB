-- Exportación del sistema viejo · HISTORIAL DE VENTAS (después de artículos).
-- Lee la carga de auditoria (entidad 'sistema_viejo:historial'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- Va a ventas_historicas (unidades por producto, sucursal y período), la tabla
-- APARTE que leen abastecimiento (sugerido de compra), estadísticas y el orden de
-- la tienda (recalcular_unidades_vendidas). NUNCA a ventas / ventas_items / pagos:
-- registrar_venta mueve stock, genera comprobantes y la cola de ARCA, puntos y referidos.
--   datos.periodos: [[desde, hasta], ...] — sin pisar los que ya hay (si un período
--                   se cruza con uno de otro origen en la misma sucursal, se frena).
--   filas:  [codigo, periodo, unidades, importe, renglones]
--   medios: [periodo, medio, comprobantes, importe]
-- importe/renglones y los medios de pago se guardan SOLO si se aplicó
-- db/migracion-ventas-historicas.sql (opcional); si no, se cargan las unidades.
-- Idempotente: una fila por (origen, sucursal, código, desde, hasta).
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; p jsonb; v_ref text; v_suc uuid; v_origen text; v_con_importe boolean; v_con_medios boolean;
  v_pasada int; v_res text := ''; v_msg text;
  n_filas int; n_ya int; n_sin_prod int; n_medios int; n_recalc int; s_unid numeric;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:historial';
  if a is null then raise exception 'no encuentro la carga % del historial de ventas', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia'; v_suc := (a->'datos'->>'sucursal_id')::uuid; v_origen := a->'datos'->>'origen';
  if not exists (select 1 from sucursales where id = v_suc) then raise exception 'no existe la sucursal %', v_suc; end if;
  for p in select * from jsonb_array_elements(a->'datos'->'periodos') loop
    if exists (select 1 from ventas_historicas vh where vh.sucursal_id = v_suc and vh.origen <> v_origen
                and vh.desde <= (p->>1)::date and vh.hasta >= (p->>0)::date) then
      raise exception 'ya hay ventas_historicas de otro origen que se cruzan con el período % a %: se contaría dos veces', p->>0, p->>1;
    end if;
  end loop;
  v_con_importe := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas_historicas' and column_name = 'importe');
  v_con_medios := to_regclass('public.ventas_historicas_medios') is not null;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_medios := 0;
    select count(*) filter (where vh.id is not null), count(*) filter (where vh.id is null and pr.id is null)
      into n_ya, n_sin_prod
      from jsonb_array_elements(coalesce(a->'secciones'->'filas', '[]')) e
      left join ventas_historicas vh on vh.origen = v_origen and vh.sucursal_id = v_suc and vh.codigo_legacy = e->>0
           and vh.desde = (a->'datos'->'periodos'->((e->>1)::int)->>0)::date and vh.hasta = (a->'datos'->'periodos'->((e->>1)::int)->>1)::date
      left join productos pr on pr.codigo_legacy = e->>0;

    -- unidades (y, con la migración, importe y renglones)
    execute format($q$
      with f as (
        select e->>0 codigo, (e->>2)::numeric unidades, (e->>3)::numeric importe, (e->>4)::int renglones,
               ($1->'datos'->'periodos'->((e->>1)::int)->>0)::date desde, ($1->'datos'->'periodos'->((e->>1)::int)->>1)::date hasta
          from jsonb_array_elements(coalesce($1->'secciones'->'filas', '[]')) e
      ), ins as (
        insert into ventas_historicas (producto_id, sku, codigo_legacy, nombre, sucursal_id, unidades, desde, hasta, origen %s)
        select pr.id, pr.sku, f.codigo, coalesce(pr.nombre, $1->'datos'->'nombres'->>f.codigo, 'Código ' || f.codigo || ' del sistema anterior'),
               $2, f.unidades, f.desde, f.hasta, $3 %s
          from f left join productos pr on pr.codigo_legacy = f.codigo
         where f.unidades > 0 and not exists (select 1 from ventas_historicas vh where vh.origen = $3 and vh.sucursal_id = $2
                 and vh.codigo_legacy = f.codigo and vh.desde = f.desde and vh.hasta = f.hasta)
        returning unidades
      ) select count(*), coalesce(sum(unidades), 0) from ins$q$,
      case when v_con_importe then ', importe, renglones' else '' end,
      case when v_con_importe then ', f.importe, f.renglones' else '' end)
    into n_filas, s_unid using a, v_suc, v_origen;

    if v_con_medios then
      execute $q$
        insert into ventas_historicas_medios (sucursal_id, desde, hasta, medio_pago, comprobantes, importe, origen)
        select $2, ($1->'datos'->'periodos'->((e->>0)::int)->>0)::date, ($1->'datos'->'periodos'->((e->>0)::int)->>1)::date,
               e->>1, (e->>2)::int, (e->>3)::numeric, $3
          from jsonb_array_elements(coalesce($1->'secciones'->'medios', '[]')) e
        on conflict do nothing$q$ using a, v_suc, v_origen;
      get diagnostics n_medios = row_count;
    end if;

    n_recalc := recalcular_unidades_vendidas();
    v_res := v_res || format(' | pasada %s: filas_nuevas=%s unidades=%s ya_estaban=%s sin_producto_en_odb=%s medios=%s (importes: %s) productos_reordenados=%s',
      v_pasada, n_filas, s_unid, n_ya, n_sin_prod, n_medios, case when v_con_importe then 'sí' else 'no, falta la migración' end, n_recalc);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK historial %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'filas', n_filas, 'unidades', s_unid,
      'ya_estaban', n_ya, 'sin_producto_en_odb', n_sin_prod, 'medios', n_medios, 'con_importes', v_con_importe, 'productos_reordenados', n_recalc))
   where id = v_id;
end $$;

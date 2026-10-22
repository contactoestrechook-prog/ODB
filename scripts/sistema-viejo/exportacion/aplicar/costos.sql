-- Exportación del sistema viejo · COSTOS (después de proveedores y artículos).
-- Lee la carga de auditoria (entidad 'sistema_viejo:costos'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- Igual que aplicar_lista_proveedor (NO aplicar_lista_con_precio, que recalcula el
-- precio de venta): productos.costo + proveedor_productos (último costo y fecha:
-- abastecimiento elige el proveedor por la fecha más nueva) + costos_historial
-- (con proveedor, que es obligatorio). La fecha es la "fecha costo" del viejo.
--   costos:        [codigo, costo, fecha, proveedor_id, proveedor_cuit, proveedor_razon, antes]
--   costos_viejos: igual, con fecha de hace más de un año: solo con --incluir costos_viejos.
-- El proveedor se busca por id (ya estaba en ODB) o por CUIT / razón social (lo
-- creó proveedores.sql). Sin proveedor solo se carga productos.costo.
-- No se pisa un costo que ODB tenga MÁS NUEVO (de una lista de proveedor).
-- productos.costo no guarda historial: el costo anterior de cada producto queda
-- en auditoria (datos_antes.aplicado.costos_anteriores).
-- Idempotente: solo cambia lo distinto y no repite la fila del historial.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; v_ref text; v_items jsonb; v_previos jsonb;
  v_pasada int; v_res text := ''; v_msg text;
  n_items int; n_sin int; n_odb int; n_costo int; n_pp int; n_hist int; n_sin_prov int;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:costos';
  if a is null then raise exception 'no encuentro la carga % de costos', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia';

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    -- se resuelve todo una vez (producto, proveedor, si ODB tiene uno más nuevo)
    select coalesce(jsonb_agg(to_jsonb(r)), '[]') into v_items from (
      select it.codigo, it.costo, it.fecha, p.id prod, p.costo costo_act,
             coalesce(pv.id, pc.id, pn.id) prov,
             exists (select 1 from costos_historial ch where ch.producto_id = p.id and ch.creado_en > it.fecha
                      and coalesce(ch.origen, '') <> v_ref) odb_mas_nuevo
        from (select e->>0 codigo, (e->>1)::numeric costo, coalesce(((e->>2) || ' 12:00:00-03')::timestamptz, (a->>'corte')::timestamptz) fecha,
                     nullif(e->>3, '')::uuid prov_id, e->>4 prov_cuit, e->>5 prov_razon
                from jsonb_array_elements(coalesce(a->'secciones'->'costos', '[]') || coalesce(a->'secciones'->'costos_viejos', '[]')) e) it
        left join productos p on p.codigo_legacy = it.codigo
        left join proveedores pv on pv.id = it.prov_id
        left join proveedores pc on pv.id is null and it.prov_cuit is not null and pc.cuit = it.prov_cuit
        left join lateral (select x.id from proveedores x where pv.id is null and pc.id is null and it.prov_razon is not null
                             and lower(trim(x.razon_social)) = lower(trim(it.prov_razon)) order by x.id limit 1) pn on true
    ) r;
    select count(*), count(*) filter (where prod is null), count(*) filter (where prod is not null and odb_mas_nuevo),
           count(*) filter (where prod is not null and not odb_mas_nuevo and prov is null)
      into n_items, n_sin, n_odb, n_sin_prov
      from jsonb_to_recordset(v_items) as it(codigo text, prod uuid, prov uuid, odb_mas_nuevo boolean);

    with it as (select * from jsonb_to_recordset(v_items) as x(codigo text, costo numeric, prod uuid, costo_act numeric, odb_mas_nuevo boolean)),
    upd as (
      update productos p set costo = it.costo from it
       where p.id = it.prod and not it.odb_mas_nuevo and (p.costo is null or abs(p.costo - it.costo) >= 0.01)
      returning it.codigo, it.costo_act
    )
    select count(*), coalesce(jsonb_object_agg(codigo, costo_act), '{}') into n_costo, v_previos from upd;

    with it as (select * from jsonb_to_recordset(v_items) as x(costo numeric, fecha timestamptz, prod uuid, prov uuid, odb_mas_nuevo boolean)),
    ins as (
      insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
      select it.prov, it.prod, it.costo, it.fecha from it where it.prov is not null and it.prod is not null and not it.odb_mas_nuevo
      on conflict (proveedor_id, producto_id) do update set ultimo_costo = excluded.ultimo_costo, actualizado_en = excluded.actualizado_en
       where (proveedor_productos.actualizado_en is null or proveedor_productos.actualizado_en <= excluded.actualizado_en)
         and (proveedor_productos.ultimo_costo is distinct from excluded.ultimo_costo or proveedor_productos.actualizado_en is distinct from excluded.actualizado_en)
      returning 1
    )
    select count(*) into n_pp from ins;

    insert into costos_historial (proveedor_id, producto_id, costo, origen, creado_en)
    select it.prov, it.prod, it.costo, v_ref, it.fecha
      from jsonb_to_recordset(v_items) as it(costo numeric, fecha timestamptz, prod uuid, prov uuid, odb_mas_nuevo boolean)
     where it.prov is not null and it.prod is not null and not it.odb_mas_nuevo
       and not exists (select 1 from costos_historial ch where ch.proveedor_id = it.prov and ch.producto_id = it.prod
                        and ch.origen = v_ref and ch.costo = it.costo);
    get diagnostics n_hist = row_count;

    v_res := v_res || format(' | pasada %s: items=%s costos_cambiados=%s proveedor_productos=%s historial=%s sin_producto=%s odb_mas_nuevo=%s sin_proveedor=%s',
      v_pasada, n_items, n_costo, n_pp, n_hist, n_sin, n_odb, n_sin_prov);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK costos %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'costos_cambiados', n_costo,
      'proveedor_productos', n_pp, 'historial', n_hist, 'sin_producto', n_sin, 'odb_mas_nuevo', n_odb, 'sin_proveedor', n_sin_prov,
      'costos_anteriores', v_previos))
   where id = v_id;
end $$;

-- Exportación del sistema viejo · PRECIOS (después de artículos: las altas ya
-- traen su precio). Lee la carga de auditoria (entidad 'sistema_viejo:precios').
-- __AUDITORIA_ID__ y __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- Regla de siempre: vigencia NUEVA, nunca UPDATE ni DELETE de precios (el 11/8 se
-- perdió el historial), y solo si el vigente sigue siendo distinto: correrlo dos
-- veces no duplica.
--   minorista: [codigo, precio, antes] → lista Minorista (Precio 1 = "Lista Unitaria").
--   mayorista: [codigo, precio, antes] → lista Mayorista (la lista sin nombre del
--              viejo); solo viene si preparar.mjs se corrió con --incluir mayorista.
-- La vigencia nueva arranca AL APLICAR (now()), no cuando se preparó la carga. Y
-- si el precio vigente ya no es el `antes` que vio la simulación (alguien lo
-- cambió en ODB en el medio), NO se pisa: se cuenta como «cambiado en ODB después
-- de simular» y se lista en el resultado. Antes se insertaba con la fecha de
-- preparar, quedaba detrás del precio nuevo de ODB y se contaba como aplicada.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; v_t timestamptz; v_usr uuid; v_ref text; v_lista uuid; v_sec text;
  v_pasada int; v_res text := ''; v_msg text; v_aplicado jsonb := '{}';
  n_nuevos int; n_iguales int; n_sin int; n_cambiados int; v_cambiados jsonb;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:precios';
  if a is null then raise exception 'no encuentro la carga % de precios', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_t := now(); v_usr := (a->>'usuario_id')::uuid; v_ref := a->>'referencia';
  if not exists (select 1 from listas_precios where id = (a->'datos'->>'lista_minorista')::uuid and nombre = 'Minorista')
     or not exists (select 1 from listas_precios where id = (a->'datos'->>'lista_mayorista')::uuid and nombre = 'Mayorista') then
    raise exception 'las listas de la carga no son Minorista y Mayorista';
  end if;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    foreach v_sec in array array['minorista', 'mayorista'] loop
      continue when not (a->'secciones' ? v_sec);
      v_lista := (a->'datos'->>('lista_' || v_sec))::uuid;
      with it as (
        select e->>0 codigo, (e->>1)::numeric precio, nullif(e->>2, '')::numeric antes from jsonb_array_elements(a->'secciones'->v_sec) e
      ), r0 as (
        select it.codigo, it.precio, it.antes, p.id prod,
               (select pr.precio from precios pr where pr.producto_id = p.id and pr.lista_id = v_lista
                 order by pr.vigente_desde desc, pr.id desc limit 1) prev
          from it left join productos p on p.codigo_legacy = it.codigo
      ), r as (
        -- cambiado: el vigente no es ni el que vio la simulación ni el nuevo
        select r0.*, coalesce(r0.prod is not null
                     and (r0.prev is null or abs(r0.prev - r0.precio) >= 0.01)
                     and not ((r0.prev is null and r0.antes is null) or coalesce(abs(r0.prev - r0.antes) < 0.01, false)), false) cambiado
          from r0
      ), ins as (
        insert into precios (lista_id, producto_id, precio, vigente_desde, creado_por)
        select v_lista, r.prod, r.precio, v_t, v_usr from r
         where r.prod is not null and r.precio >= 1 and not r.cambiado and (r.prev is null or abs(r.prev - r.precio) >= 0.01)
        returning 1
      )
      select (select count(*) from ins),
             (select count(*) from r where r.prod is not null and r.prev is not null and abs(r.prev - r.precio) < 0.01),
             (select count(*) from r where r.prod is null),
             (select count(*) from r where r.cambiado),
             (select coalesce(jsonb_agg(jsonb_build_array(r.codigo, r.antes, r.prev, r.precio)), '[]') from r where r.cambiado)
        into n_nuevos, n_iguales, n_sin, n_cambiados, v_cambiados;
      v_res := v_res || format(' | pasada %s %s: vigencias_nuevas=%s ya_iguales=%s sin_producto=%s cambiados_en_odb_despues_de_simular=%s',
        v_pasada, v_sec, n_nuevos, n_iguales, n_sin, n_cambiados);
      if v_pasada = 1 then v_aplicado := v_aplicado || jsonb_build_object(v_sec, jsonb_build_object('vigencias_nuevas', n_nuevos, 'ya_iguales', n_iguales,
        'sin_producto', n_sin, 'cambiados_en_odb_despues_de_simular', v_cambiados)); end if;
    end loop;
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK precios %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', v_aplicado || jsonb_build_object('en', now())) where id = v_id;
end $$;

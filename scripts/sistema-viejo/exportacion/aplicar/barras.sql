-- Exportación del sistema viejo · CÓDIGOS DE BARRAS (después de artículos: las
-- altas ya existen). Lee la carga de auditoria (entidad 'sistema_viejo:barras').
-- __AUDITORIA_ID__ y __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- codigos_barras es (codigo → producto) sin cantidad: solo se cargan los códigos
-- de UNIDAD seguros (simular.mjs deja a revisión cajas, repetidos, códigos que ODB
-- ya tiene en otro producto y dígitos verificadores inválidos).
--   agregar:      [ean, codigo] → si el código de barras ya existe, no se toca.
--   quitar_cajas: [ean, codigo, unidades] → solo con --incluir quitar_cajas: saca
--                 los códigos de CAJA que hoy cobran 1 unidad (quedan listados en
--                 esta carga de auditoria para volver a ponerlos).
-- Idempotente: insert ... on conflict do nothing; quitar solo borra si sigue ahí.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; v_ref text;
  v_pasada int; v_res text := ''; v_msg text;
  n_agr int; n_ya int; n_otro int; n_sin int; n_quit int;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:barras';
  if a is null then raise exception 'no encuentro la carga % de códigos de barras', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia';

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    with it as (
      select distinct on (e->>0) e->>0 ean, e->>1 codigo, p.id prod, cb.producto_id dueno
        from jsonb_array_elements(coalesce(a->'secciones'->'agregar', '[]')) e
        left join productos p on p.codigo_legacy = e->>1
        left join codigos_barras cb on cb.codigo = e->>0
       order by e->>0, e->>1
    ), ins as (
      insert into codigos_barras (codigo, producto_id)
      select it.ean, it.prod from it where it.prod is not null and it.dueno is null
      on conflict (codigo) do nothing
      returning 1
    )
    select (select count(*) from ins),
           (select count(*) from it where it.prod is not null and it.dueno = it.prod),
           (select count(*) from it where it.prod is not null and it.dueno is not null and it.dueno <> it.prod),
           (select count(*) from it where it.prod is null)
      into n_agr, n_ya, n_otro, n_sin;

    delete from codigos_barras cb
     using jsonb_array_elements(coalesce(a->'secciones'->'quitar_cajas', '[]')) e, productos p
     where p.codigo_legacy = e->>1 and cb.codigo = e->>0 and cb.producto_id = p.id;
    get diagnostics n_quit = row_count;

    v_res := v_res || format(' | pasada %s: agregados=%s ya_estaban=%s en_otro_producto=%s sin_producto=%s cajas_quitadas=%s',
      v_pasada, n_agr, n_ya, n_otro, n_sin, n_quit);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK códigos de barras %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'agregados', n_agr, 'ya_estaban', n_ya,
      'en_otro_producto', n_otro, 'sin_producto', n_sin, 'cajas_quitadas', n_quit))
   where id = v_id;
end $$;

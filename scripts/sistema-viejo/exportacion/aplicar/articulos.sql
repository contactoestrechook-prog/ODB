-- Exportación del sistema viejo · ARTÍCULOS (después de proveedores).
-- Lee la carga de auditoria (entidad 'sistema_viejo:articulos'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, todo o nada, ensayo con RAISE.
-- No toca nombres, categorías, IVA ni unidades por pack de los productos que ya
-- existen (la categoría se reclasificó el 1/10; el "pack" del viejo es la caja del
-- proveedor y en ODB unidades_pack es lo que se VENDE).
--   vincular:  [producto_id, codigo, nombre_odb] → producto de ODB sin código viejo
--              que es el mismo artículo: se le pone codigo_legacy (el sku queda).
--   altas:     [codigo, nombre, categoria_id, es_alcohol, precio, por_peso] →
--              producto nuevo (sku 'L' + código) con su precio Minorista. El costo,
--              los códigos de barras y el stock los ponen costos, barras y stock.
--   peso:      [codigo] → vendido_por_peso: la etiqueta de la balanza trae GRAMOS
--              (sin la marca, '2 003931 00290 5' entra como 290 unidades).
--   reactivar: [codigo] → solo los que el dueño aprobó en la hoja Revisar.
-- Idempotente: el alta se saltea si el código ya existe; el resto solo cambia lo distinto.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_t timestamptz; v_usr uuid; v_ref text; v_lista uuid; v_prod uuid;
  v_pasada int; v_res text := ''; v_msg text;
  n_vinc int; n_vinc_no int; n_altas int; n_ya int; n_sku int; n_peso int; n_react int;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:articulos';
  if a is null then raise exception 'no encuentro la carga % de artículos', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_t := (a->>'t')::timestamptz; v_usr := (a->>'usuario_id')::uuid; v_ref := a->>'referencia';
  v_lista := (a->'datos'->>'lista_id')::uuid;
  if not exists (select 1 from listas_precios where id = v_lista and nombre = 'Minorista') then raise exception 'la lista % no es la Minorista', v_lista; end if;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_vinc := 0; n_vinc_no := 0; n_altas := 0; n_ya := 0; n_sku := 0; n_peso := 0; n_react := 0;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'vincular', '[]')) loop
      update productos set codigo_legacy = e->>1
       where id = (e->>0)::uuid and codigo_legacy is null
         and not exists (select 1 from productos o where o.codigo_legacy = e->>1);
      if found then n_vinc := n_vinc + 1; else n_vinc_no := n_vinc_no + 1; end if;
    end loop;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'altas', '[]')) loop
      if exists (select 1 from productos where codigo_legacy = e->>0) then n_ya := n_ya + 1; continue; end if;
      if exists (select 1 from productos where sku = 'L' || (e->>0)) then n_sku := n_sku + 1; continue; end if;
      insert into productos (sku, nombre, categoria_id, es_alcohol, codigo_legacy, activo, vendido_por_peso)
      values ('L' || (e->>0), trim(e->>1), (select c.id from categorias c where c.id = nullif(e->>2, '')::uuid),
              coalesce((e->>3)::boolean, false), e->>0, true, coalesce((e->>5)::boolean, false))
      returning id into v_prod;
      insert into precios (lista_id, producto_id, precio, vigente_desde, creado_por)
      values (v_lista, v_prod, (e->>4)::numeric, v_t, v_usr);
      n_altas := n_altas + 1;
    end loop;

    update productos p set vendido_por_peso = true
      from jsonb_array_elements(coalesce(a->'secciones'->'peso', '[]')) x
     where p.codigo_legacy = x->>0 and not p.vendido_por_peso;
    get diagnostics n_peso = row_count;

    update productos p set activo = true
      from jsonb_array_elements(coalesce(a->'secciones'->'reactivar', '[]')) x
     where p.codigo_legacy = x->>0 and not p.activo;
    get diagnostics n_react = row_count;

    v_res := v_res || format(' | pasada %s: vinculados=%s (sin cambio %s) altas=%s ya_existian=%s sku_ocupado=%s por_peso=%s reactivados=%s',
      v_pasada, n_vinc, n_vinc_no, n_altas, n_ya, n_sku, n_peso, n_react);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK artículos %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'vinculados', n_vinc,
      'altas', n_altas, 'ya_existian', n_ya, 'sku_ocupado', n_sku, 'por_peso', n_peso, 'reactivados', n_react))
   where id = v_id;
end $$;

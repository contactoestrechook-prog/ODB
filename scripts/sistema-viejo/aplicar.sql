-- Paso 3 de la actualización desde el sistema viejo: aplica la carga guardada en
-- la fila de auditoria que dejó preparar.mjs. TODO en una sola transacción (es un
-- solo bloque DO): si algo falla, no queda nada a medias.
--
-- Reemplazar __AUDITORIA_ID__ por el id que imprimió preparar.mjs.
-- ENSAYO: con __ENSAYO__ = true el bloque termina con un error a propósito que
-- trae los números; la base vuelve atrás sola (regla: nunca probar escribiendo de
-- verdad en producción). Con false, aplica.
--
--   1. vincular: productos de ODB sin código del sistema viejo que son el mismo
--      artículo → se les pone codigo_legacy (el sku queda como está).
--   2. altas: producto nuevo (sku 'L' + código), su precio y su stock inicial.
--   3. precios: vigencia NUEVA en la lista Minorista, solo si el vigente sigue
--      siendo distinto (se puede volver a correr sin duplicar). Nunca UPDATE.
--   4. stock: se lleva cada producto al valor de la planilla con UN ajuste por la
--      diferencia calculada en el momento (registrar_movimiento: el libro cuadra).
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  a jsonb; e jsonb;
  v_t timestamptz; v_lista uuid; v_suc uuid; v_usr uuid; v_ref text;
  v_prod uuid; v_prev numeric; v_act numeric; v_delta numeric;
  n_vinc int := 0; n_altas int := 0; n_precios int := 0; n_iguales int := 0; n_stock int := 0;
  s_sube numeric := 0; s_baja numeric := 0;
begin
  select datos_despues into a from auditoria where id = __AUDITORIA_ID__ and accion = 'importacion_sistema_viejo';
  if a is null then raise exception 'no encuentro la carga %', __AUDITORIA_ID__; end if;
  if (select datos_antes ? 'aplicado' from auditoria where id = __AUDITORIA_ID__) then
    raise exception 'la carga % ya se aplicó', __AUDITORIA_ID__;
  end if;
  v_t := (a->>'t')::timestamptz; v_lista := (a->>'lista_id')::uuid; v_suc := (a->>'sucursal_id')::uuid;
  v_usr := (a->>'usuario_id')::uuid; v_ref := 'stock-' || replace(a->>'referencia', 'st-', '');

  for e in select * from jsonb_array_elements(a->'vincular') loop
    update productos set codigo_legacy = e->>'codigo'
     where id = (e->>'producto_id')::uuid and codigo_legacy is null;
    if found then n_vinc := n_vinc + 1; end if;
  end loop;

  for e in select * from jsonb_array_elements(a->'altas') loop
    insert into productos (sku, nombre, categoria_id, es_alcohol, codigo_legacy, activo)
    values ('L' || (e->>'codigo'), e->>'nombre', nullif(e->>'categoria_id', '')::uuid,
            coalesce((e->>'es_alcohol')::boolean, false), e->>'codigo', true)
    returning id into v_prod;
    insert into precios (lista_id, producto_id, precio, vigente_desde, creado_por)
    values (v_lista, v_prod, (e->>'precio')::numeric, v_t, v_usr);
    if (e->>'stock')::numeric > 0 then
      perform registrar_movimiento(v_prod, v_suc, 'ajuste'::tipo_movimiento, (e->>'stock')::numeric,
        'Alta desde el sistema anterior (' || (a->>'referencia') || ')', 'importacion', v_ref, v_usr);
    end if;
    n_altas := n_altas + 1;
  end loop;

  for e in select * from jsonb_array_elements(a->'precios') loop
    v_prod := (e->>'producto_id')::uuid;
    select precio into v_prev from precios
     where producto_id = v_prod and lista_id = v_lista order by vigente_desde desc, id desc limit 1;
    if v_prev is null or abs(v_prev - (e->>'precio')::numeric) >= 0.01 then
      insert into precios (lista_id, producto_id, precio, vigente_desde, creado_por)
      values (v_lista, v_prod, (e->>'precio')::numeric, v_t, v_usr);
      n_precios := n_precios + 1;
    else
      n_iguales := n_iguales + 1;
    end if;
  end loop;

  for e in select * from jsonb_array_elements(a->'stock') loop
    v_prod := (e->>'producto_id')::uuid;
    select cantidad into v_act from stock where producto_id = v_prod and sucursal_id = v_suc;
    v_delta := round((e->>'objetivo')::numeric - coalesce(v_act, 0), 3);
    if abs(v_delta) >= 0.0005 then
      perform registrar_movimiento(v_prod, v_suc, 'ajuste'::tipo_movimiento, v_delta,
        'Sincronización con sistema anterior (' || (a->>'referencia') || ')', 'importacion', v_ref, v_usr);
      n_stock := n_stock + 1;
      if v_delta > 0 then s_sube := s_sube + v_delta; else s_baja := s_baja + v_delta; end if;
    end if;
  end loop;

  if v_ensayo then
    raise exception 'ENSAYO OK (nada quedó escrito): vinculados=% altas=% precios=% precios_ya_iguales=% ajustes_stock=% sube=% baja=%',
      n_vinc, n_altas, n_precios, n_iguales, n_stock, s_sube, s_baja;
  end if;

  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object(
      'en', now(), 'vinculados', n_vinc, 'altas', n_altas, 'precios', n_precios, 'precios_ya_iguales', n_iguales,
      'ajustes_stock', n_stock, 'unidades_suben', s_sube, 'unidades_bajan', s_baja))
   where id = __AUDITORIA_ID__;
end $$;

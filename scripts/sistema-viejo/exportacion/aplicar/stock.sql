-- Exportación del sistema viejo · STOCK DE SANT THOMAS (lo ÚLTIMO, el día del
-- cambio: con el sistema viejo congelado y una exportación sacada en ese momento;
-- la del 21/10 12:08 es de pleno día de venta y queda vieja enseguida).
-- Lee la carga de auditoria (entidad 'sistema_viejo:stock'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- Igual que aplicar.sql de las planillas: cada producto se lleva al número del
-- viejo con UN ajuste por la diferencia calculada en el momento
-- (registrar_movimiento, motivo «Sincronización con sistema anterior»): el libro
-- de movimientos sigue cuadrando con el stock. Los negativos ya vienen en 0.
--   ajustes: [codigo, objetivo, antes] (las altas se buscan por código: aplicar
--            artículos antes).
-- Santa Inés no se toca (la exportación no la trae).
-- Idempotente: si el stock ya es el objetivo, no hay ajuste.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_ref text; v_suc uuid; v_usr uuid; v_prod uuid; v_act numeric; v_delta numeric;
  v_pasada int; v_res text := ''; v_msg text;
  n_aj int; n_ig int; n_sin int; s_sube numeric; s_baja numeric;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:stock';
  if a is null then raise exception 'no encuentro la carga % de stock', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia'; v_usr := (a->>'usuario_id')::uuid; v_suc := (a->'datos'->>'sucursal_id')::uuid;
  if not exists (select 1 from sucursales where id = v_suc) then raise exception 'no existe la sucursal %', v_suc; end if;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_aj := 0; n_ig := 0; n_sin := 0; s_sube := 0; s_baja := 0;
    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'ajustes', '[]')) loop
      select id into v_prod from productos where codigo_legacy = e->>0;
      if v_prod is null then n_sin := n_sin + 1; continue; end if;
      select cantidad into v_act from stock where producto_id = v_prod and sucursal_id = v_suc;
      v_delta := round(greatest((e->>1)::numeric, 0) - coalesce(v_act, 0), 3);
      if abs(v_delta) < 0.0005 then n_ig := n_ig + 1; continue; end if;
      perform registrar_movimiento(v_prod, v_suc, 'ajuste'::tipo_movimiento, v_delta,
        'Sincronización con sistema anterior (' || v_ref || ')', 'importacion', v_ref, v_usr);
      n_aj := n_aj + 1;
      if v_delta > 0 then s_sube := s_sube + v_delta; else s_baja := s_baja + v_delta; end if;
    end loop;
    v_res := v_res || format(' | pasada %s: ajustes=%s ya_iguales=%s sin_producto=%s suben=%s bajan=%s', v_pasada, n_aj, n_ig, n_sin, s_sube, s_baja);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK stock %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'ajustes', n_aj, 'ya_iguales', n_ig,
      'sin_producto', n_sin, 'unidades_suben', s_sube, 'unidades_bajan', s_baja))
   where id = v_id;
end $$;

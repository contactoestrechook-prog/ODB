-- APLICAR la carga del Crack del 10/11/2026 (auditoría 1062). Todo o nada.
-- __ENSAYO__ = true termina con un error que trae los números y vuelve todo atrás.
do $$
declare
  ensayo boolean := __ENSAYO__;
  a jsonb := (select datos_despues from auditoria where id = 1062);
  v_suc uuid := (a->>'sucursal_id')::uuid; v_lista uuid := (a->>'lista_id')::uuid;
  v_ref text := 'export-1011';
  v_concepto text := 'Ajuste de saldo del sistema anterior (corte 10/11/2026 11:20)';
  e jsonb; v_prod uuid; v_cli uuid; v_act numeric; v_delta numeric; v_nuevo numeric;
  n_altas int := 0; n_vinc int := 0; n_comp int := 0; n_prec int := 0; n_stock int := 0; n_bar int := 0; n_barq int := 0;
  n_cli int := 0; n_clic int := 0; n_cc int := 0; n_vh int := 0; n_pp int := 0; u_stock numeric := 0;
begin
  if a is null then raise exception 'No está la fila 1062'; end if;
  if exists (select 1 from auditoria where accion = 'importacion_sistema_viejo_aplicada' and entidad_id = v_ref) then
    raise exception 'La carga % ya se aplicó', v_ref;
  end if;

  -- 1. altas de productos (o vincular si el SKU ya existe sin código viejo)
  for e in select * from jsonb_array_elements(a->'altas') loop
    select id into v_prod from productos where sku = 'L' || (e->>'codigo');
    if v_prod is not null then
      update productos set codigo_legacy = e->>'codigo' where id = v_prod and codigo_legacy is null;
      n_vinc := n_vinc + 1; continue;
    end if;
    insert into productos (sku, nombre, categoria_id, es_alcohol, codigo_legacy, activo, costo, alicuota_iva, plu)
    values ('L' || (e->>'codigo'), e->>'nombre', nullif(e->>'categoria_id', '')::uuid, coalesce((e->>'es_alcohol')::boolean, false),
            e->>'codigo', true, nullif((e->>'costo')::numeric, 0), coalesce((e->>'alicuota_iva')::numeric, 21),
            case when e->>'plu' is not null and not exists (select 1 from productos where plu = e->>'plu') then e->>'plu' end)
    returning id into v_prod;
    insert into precios (lista_id, producto_id, precio, vigente_desde) values (v_lista, v_prod, (e->>'precio')::numeric, now());
    if coalesce((e->>'stock')::numeric, 0) > 0 then
      perform registrar_movimiento(v_prod, v_suc, 'ajuste', (e->>'stock')::numeric, 'Alta desde el sistema anterior (' || v_ref || ')', 'importacion', 'stock-1011', null);
    end if;
    n_altas := n_altas + 1;
  end loop;

  -- 2. completar el costo que faltaba (solo si sigue vacío)
  for e in select * from jsonb_array_elements(a->'completar') loop
    if e ? 'costo' then
      update productos set costo = (e->>'costo')::numeric where id = (e->>'producto_id')::uuid and coalesce(costo, 0) = 0;
      if found then n_comp := n_comp + 1; end if;
    end if;
  end loop;

  -- 3. precios: vigencia nueva en la Minorista (si NÚCLEO no lo cambió después de simular)
  for e in select * from jsonb_array_elements(a->'precios') loop
    v_prod := (e->>'producto_id')::uuid;
    if exists (select 1 from precios where producto_id = v_prod and lista_id = v_lista and vigente_desde > (a->>'t')::timestamptz) then continue; end if;
    insert into precios (lista_id, producto_id, precio, vigente_desde) values (v_lista, v_prod, (e->>'precio')::numeric, now());
    n_prec := n_prec + 1;
  end loop;

  -- 4. stock de Sant Thomas: la diferencia de la simulación sobre lo que haya HOY
  --    (si algo se movió después de simular, se conserva)
  for e in select * from jsonb_array_elements(a->'stock') loop
    v_prod := (e->>'producto_id')::uuid;
    select coalesce((select cantidad from stock where producto_id = v_prod and sucursal_id = v_suc), 0) into v_act;
    v_nuevo := greatest(0, v_act + ((e->>'objetivo')::numeric - (e->>'antes')::numeric));
    v_delta := round(v_nuevo - v_act, 3);
    if abs(v_delta) >= 0.001 then
      perform registrar_movimiento(v_prod, v_suc, 'ajuste', v_delta, 'Sincronización con sistema anterior (' || v_ref || ')', 'importacion', 'stock-1011', null);
      n_stock := n_stock + 1; u_stock := u_stock + abs(v_delta);
    end if;
  end loop;

  -- 5. códigos de barras
  for e in select * from jsonb_array_elements(a->'barras_agregar') loop
    insert into codigos_barras (codigo, producto_id) values (e->>'ean', (e->>'producto_id')::uuid) on conflict do nothing;
    if found then n_bar := n_bar + 1; end if;
  end loop;
  for e in select * from jsonb_array_elements(a->'barras_quitar_caja') loop
    delete from codigos_barras where codigo = e->>'ean' and producto_id = (e->>'producto_id')::uuid;
    if found then n_barq := n_barq + 1; end if;
  end loop;

  -- 6. clientes: altas (con su saldo) y datos que faltaban
  for e in select * from jsonb_array_elements(a->'clientes_altas') loop
    if exists (select 1 from clientes where codigo_legacy = e->>'codigo_legacy') then continue; end if;
    insert into clientes (codigo_legacy, nombre, cuit, telefono, email, barrio, condicion_iva, domicilio, sucursal, cta_cte_habilitada, saldo_cta_cte)
    values (e->>'codigo_legacy', e->>'nombre', e->>'cuit', e->>'telefono', e->>'email', e->>'barrio', coalesce(e->>'condicion_iva', 'consumidor_final'),
            e->>'domicilio', 'st', coalesce((e->>'saldo')::numeric, 0) <> 0, coalesce((e->>'saldo')::numeric, 0))
    returning id into v_cli;
    if coalesce((e->>'saldo')::numeric, 0) <> 0 then
      insert into cuenta_corriente (cliente_id, concepto, debe, haber)
      values (v_cli, 'Saldo inicial del sistema anterior (corte 10/11/2026 11:20)', greatest((e->>'saldo')::numeric, 0), greatest(-(e->>'saldo')::numeric, 0));
    end if;
    n_cli := n_cli + 1;
  end loop;
  for e in select * from jsonb_array_elements(a->'clientes_completar') loop
    update clientes set cuit = coalesce(cuit, e->>'cuit'), telefono = coalesce(telefono, e->>'telefono'), email = coalesce(email, e->>'email'),
      barrio = coalesce(barrio, e->>'barrio') where id = (e->>'cliente_id')::uuid;
    n_clic := n_clic + 1;
  end loop;

  -- 7. cuenta corriente: el saldo del Crack manda (el movimiento y el saldo que ve la gente)
  for e in select * from jsonb_array_elements(a->'ctacte_ajustes') loop
    v_cli := (e->>'cliente_id')::uuid;
    select saldo_cta_cte into v_act from clientes where id = v_cli;
    v_delta := round((e->>'saldo_crack')::numeric - coalesce(v_act, 0), 2);
    if abs(v_delta) < 1 then continue; end if;
    insert into cuenta_corriente (cliente_id, concepto, debe, haber) values (v_cli, v_concepto, greatest(v_delta, 0), greatest(-v_delta, 0));
    update clientes set saldo_cta_cte = (e->>'saldo_crack')::numeric,
      cta_cte_habilitada = cta_cte_habilitada or (e->>'saldo_crack')::numeric <> 0 where id = v_cli;
    n_cc := n_cc + 1;
  end loop;

  -- 8. ventas por producto del 24/10 al 9/11 (estadísticas y Analista)
  insert into ventas_historicas (producto_id, sku, codigo_legacy, nombre, sucursal_id, unidades, desde, hasta, origen)
  select (f->>'producto_id')::uuid, f->>'sku', f->>'codigo', f->>'nombre', v_suc, (f->>'unidades')::numeric,
         (a->'ventas_historicas'->>'desde')::date, (a->'ventas_historicas'->>'hasta')::date, v_ref
  from jsonb_array_elements(a->'ventas_historicas'->'filas') f;
  get diagnostics n_vh = row_count;

  -- 9. quién vende cada producto (sin pisar lo que ya está)
  insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
  select (f->>'proveedor_id')::uuid, (f->>'producto_id')::uuid, nullif((f->>'ultimo_costo')::numeric, 0), now()
  from jsonb_array_elements(a->'proveedor_productos') f
  on conflict (proveedor_id, producto_id) do nothing;
  get diagnostics n_pp = row_count;

  insert into auditoria (accion, entidad, entidad_id, datos_despues)
  values ('importacion_sistema_viejo_aplicada', 'carga', v_ref, jsonb_build_object(
    'fila_plan', 1062, 'altas', n_altas, 'vinculados', n_vinc, 'costos_completados', n_comp, 'precios', n_prec,
    'stock_ajustes', n_stock, 'stock_unidades', u_stock, 'barras_nuevas', n_bar, 'barras_caja_quitadas', n_barq,
    'clientes_altas', n_cli, 'clientes_completados', n_clic, 'ctacte_ajustes', n_cc, 'ventas_historicas', n_vh, 'proveedor_productos', n_pp));

  if ensayo then
    raise exception 'ENSAYO OK (se vuelve todo atrás): altas % (vinculados %), costos %, precios %, stock % ajustes (% u.), barras +% / -%, clientes +% (completados %), cta cte %, ventas %, proveedor↔producto %',
      n_altas, n_vinc, n_comp, n_prec, n_stock, round(u_stock), n_bar, n_barq, n_cli, n_clic, n_cc, n_vh, n_pp;
  end if;
end $$;

-- CORREGIR UN INGRESO YA RECIBIDO (7/10/2026). Pedido de Leandro con la OC #58
-- de Beau Lieu: el Primera Revancha Merlot entró como 2 × $114.000 cuando eran
-- 12 botellas a $19.000 (2 cajas de 6). Mismo total, pero el stock quedó 10
-- botellas corto y el costo del catálogo seis veces más caro. No había forma de
-- arreglarlo desde el panel.
--
-- Una sola transacción por corrección:
--   · stock: un movimiento 'ajuste' por la diferencia, con el motivo, en la
--     sucursal de la orden (registrar_movimiento no deja el stock en negativo);
--   · la orden: cantidad recibida, costo y total;
--   · costo y precio: solo si el costo vigente del producto es el de este
--     ingreso (si después entró otra compra, no se pisa). Mismo efecto que
--     aplicar_lista_con_precio, con origen 'correccion_ingreso';
--   · la factura NO se toca: si el total cambia y la orden tiene una factura
--     cargada, no se corrige (los errores típicos, caja contada como unidad,
--     dejan el mismo total);
--   · auditoría con antes/después por renglón, quién y el motivo.
create or replace function public.corregir_ingreso_oc(p_oc uuid, p_renglones jsonb, p_motivo text, p_usuario uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_oc ordenes_compra%rowtype;
  v_r record; v_item record;
  v_delta numeric; v_total numeric; v_lista uuid;
  v_antes jsonb := '[]'::jsonb; v_despues jsonb := '[]'::jsonb;
  v_costo_vigente numeric; v_cambios int := 0; v_costos int := 0;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Falta el motivo de la corrección'; end if;
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_oc.estado not in ('recibida', 'recibida_parcial') then raise exception 'Solo se corrige una orden ya recibida'; end if;
  select id into v_lista from listas_precios where nombre = 'Minorista' limit 1;

  for v_r in
    select (r->>'producto_id')::uuid producto_id, (r->>'cantidad')::numeric cantidad, (r->>'costo')::numeric costo,
           nullif(r->>'precio', '')::numeric precio
    from jsonb_array_elements(p_renglones) r
  loop
    if v_r.cantidad is null or v_r.cantidad < 0 or v_r.costo is null or v_r.costo < 0 then
      raise exception 'Renglón inválido (cantidad o costo)';
    end if;
    select * into v_item from ordenes_compra_items where oc_id = p_oc and producto_id = v_r.producto_id for update;
    if not found then raise exception 'El producto no está en esta orden'; end if;
    if v_item.cantidad_recibida = v_r.cantidad and v_item.costo_unitario = v_r.costo then continue; end if;

    v_delta := v_r.cantidad - coalesce(v_item.cantidad_recibida, 0);
    if v_delta <> 0 then
      perform registrar_movimiento(v_r.producto_id, v_oc.sucursal_id, 'ajuste', v_delta,
        'Corrección de ingreso OC #' || v_oc.numero || ': ' || p_motivo, 'correccion_compra', p_oc::text, p_usuario);
    end if;

    -- el costo vigente era el de este ingreso → se corrige (y el precio)
    if v_item.costo_unitario <> v_r.costo then
      select costo into v_costo_vigente from productos where id = v_r.producto_id;
      if v_costo_vigente is not distinct from v_item.costo_unitario then
        update productos set costo = v_r.costo where id = v_r.producto_id;
        insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
          values (v_oc.proveedor_id, v_r.producto_id, v_r.costo, now())
          on conflict (proveedor_id, producto_id) do update set ultimo_costo = excluded.ultimo_costo, actualizado_en = now();
        insert into costos_historial (proveedor_id, producto_id, costo, origen)
          values (v_oc.proveedor_id, v_r.producto_id, v_r.costo, 'correccion_ingreso');
        if v_lista is not null and v_r.precio is not null and v_r.precio > 0 then
          insert into precios (lista_id, producto_id, precio, creado_por) values (v_lista, v_r.producto_id, v_r.precio, p_usuario);
        end if;
        v_costos := v_costos + 1;
      end if;
    end if;

    v_antes := v_antes || jsonb_build_object('producto_id', v_r.producto_id, 'cantidad', v_item.cantidad_recibida, 'costo', v_item.costo_unitario);
    v_despues := v_despues || jsonb_build_object('producto_id', v_r.producto_id, 'cantidad', v_r.cantidad, 'costo', v_r.costo, 'stock', v_delta, 'precio', v_r.precio);
    update ordenes_compra_items
      set cantidad_recibida = v_r.cantidad,
          cantidad = case when cantidad = v_item.cantidad_recibida then v_r.cantidad else cantidad end,
          costo_unitario = v_r.costo
      where oc_id = p_oc and producto_id = v_r.producto_id;
    v_cambios := v_cambios + 1;
  end loop;

  if v_cambios = 0 then raise exception 'No hay nada para corregir'; end if;

  select coalesce(sum(cantidad * costo_unitario), 0) into v_total from ordenes_compra_items where oc_id = p_oc;
  if abs(v_total - coalesce(v_oc.total, 0)) >= 1
     and exists (select 1 from facturas_proveedor where oc_id = p_oc and coalesce(estado, '') <> 'anulada') then
    raise exception 'El total pasaría de $% a $% y la orden ya tiene factura cargada: corregí primero la factura', round(v_oc.total), round(v_total);
  end if;
  update ordenes_compra set total = v_total where id = p_oc;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
  values (p_usuario, 'correccion_ingreso', 'orden_compra', p_oc::text,
          jsonb_build_object('renglones', v_antes, 'total', v_oc.total),
          jsonb_build_object('renglones', v_despues, 'total', v_total, 'motivo', p_motivo));

  return jsonb_build_object('renglones', v_cambios, 'costos', v_costos, 'total', v_total);
end $function$;

revoke all on function public.corregir_ingreso_oc(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.corregir_ingreso_oc(uuid, jsonb, text, uuid) to service_role;

-- ============================================================================
-- Fusión de productos duplicados por el bug del bridge.
-- NO se aplica automáticamente. Revisar el dry-run (README.md) antes de correr.
--
-- fusionar_producto(surv, abs): mueve todo lo del producto `abs` (inactivo, con
-- stock e historial) al producto `surv` (activo, con precio), sumando el stock
-- por sucursal, y archiva `abs`. Idempotente por par. Todo en una transacción.
-- ============================================================================

create or replace function public.fusionar_producto(p_surv uuid, p_abs uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_surv productos%rowtype;
  v_abs productos%rowtype;
  v_stock_mov numeric := 0;
begin
  if p_surv = p_abs then raise exception 'surv y abs no pueden ser el mismo'; end if;
  select * into v_surv from productos where id = p_surv;
  if not found then raise exception 'No existe el superviviente %', p_surv; end if;
  select * into v_abs from productos where id = p_abs for update;
  if not found then raise exception 'No existe el absorbido %', p_abs; end if;
  if v_abs.descripcion is not null and v_abs.descripcion like '[fusionado%' then
    return jsonb_build_object('ya_fusionado', true, 'abs', p_abs);
  end if;

  -- STOCK: sumar por sucursal. Donde el superviviente ya tiene fila, se suma;
  -- si no, se crea. Después se borran las filas del absorbido.
  insert into stock (producto_id, sucursal_id, cantidad, stock_minimo)
  select p_surv, s.sucursal_id, s.cantidad, s.stock_minimo
  from stock s where s.producto_id = p_abs
  on conflict (producto_id, sucursal_id)
  do update set cantidad = stock.cantidad + excluded.cantidad,
                stock_minimo = greatest(stock.stock_minimo, excluded.stock_minimo);
  select coalesce(sum(cantidad),0) into v_stock_mov from stock where producto_id = p_abs;
  delete from stock where producto_id = p_abs;

  -- Reasignar el historial y las referencias del absorbido al superviviente.
  update ventas_items         set producto_id = p_surv where producto_id = p_abs;
  update movimientos_stock     set producto_id = p_surv where producto_id = p_abs;
  update costos_historial      set producto_id = p_surv where producto_id = p_abs;
  update pedidos_items         set producto_id = p_surv where producto_id = p_abs;
  update ordenes_compra_items  set producto_id = p_surv where producto_id = p_abs;
  update remitos_items         set producto_id = p_surv where producto_id = p_abs;
  update lotes                 set producto_id = p_surv where producto_id = p_abs;
  update eventos_items         set producto_id = p_surv where producto_id = p_abs;
  update transferencias_items  set producto_id = p_surv where producto_id = p_abs;

  -- proveedor_productos: mover solo los vínculos que el superviviente no tenga
  update proveedor_productos pp set producto_id = p_surv
  where pp.producto_id = p_abs
    and not exists (select 1 from proveedor_productos x where x.producto_id = p_surv and x.proveedor_id = pp.proveedor_id);
  delete from proveedor_productos where producto_id = p_abs;

  -- códigos de barra: mover los que no colisionen (codigo es unique)
  update codigos_barras cb set producto_id = p_surv
  where cb.producto_id = p_abs
    and not exists (select 1 from codigos_barras x where x.codigo = cb.codigo and x.producto_id <> p_abs);
  delete from codigos_barras where producto_id = p_abs;

  -- referencias "blandas" (se mueven si el superviviente no las tiene ya)
  update favoritos f set producto_id = p_surv where f.producto_id = p_abs
    and not exists (select 1 from favoritos x where x.producto_id = p_surv and x.cliente_id = f.cliente_id);
  delete from favoritos where producto_id = p_abs;
  update avisos_reposicion a set producto_id = p_surv where a.producto_id = p_abs
    and not exists (select 1 from avisos_reposicion x where x.producto_id = p_surv and x.cliente_id = a.cliente_id);
  delete from avisos_reposicion where producto_id = p_abs;
  update descuentos            set producto_id = p_surv where producto_id = p_abs;
  update etiquetas_pendientes  set producto_id = p_surv where producto_id = p_abs;
  update notas_cata n set producto_id = p_surv where n.producto_id = p_abs
    and not exists (select 1 from notas_cata x where x.producto_id = p_surv);
  delete from notas_cata where producto_id = p_abs;
  update listas_proveedor_items set producto_id = p_surv where producto_id = p_abs;
  -- conteos_items: raro que exista para el absorbido; se deja (conteo viejo cerrado)

  -- archivar el absorbido (queda para trazabilidad, no se borra)
  update productos set activo = false,
    descripcion = '[fusionado en ' || p_surv || '] ' || coalesce(descripcion, '')
  where id = p_abs;

  insert into auditoria (accion, entidad, entidad_id, datos_despues)
  values ('fusion_producto', 'producto', p_abs::text,
          jsonb_build_object('superviviente', p_surv, 'stock_movido', v_stock_mov, 'sku_abs', v_abs.sku, 'sku_surv', v_surv.sku));

  return jsonb_build_object('ok', true, 'surv', p_surv, 'abs', p_abs, 'stock_movido', v_stock_mov);
end $function$;

-- ----------------------------------------------------------------------------
-- LOTE (correr sólo tras revisar y probar con 1-2 pares):
--
--   do $$
--   declare r record; n int := 0;
--   begin
--     for r in
--       select p1.id as surv_id, p2.id as abs_id
--       from productos p1 join productos p2 on p2.sku = substring(p1.sku from 2)
--       where p1.sku like 'L%' and p1.activo and not p2.activo
--     loop
--       perform fusionar_producto(r.surv_id, r.abs_id);
--       n := n + 1;
--     end loop;
--     raise notice 'fusionados: %', n;
--   end $$;
-- ----------------------------------------------------------------------------

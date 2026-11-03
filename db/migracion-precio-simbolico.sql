-- PRECIO SIMBÓLICO (Leandro, 3/11/2026): «son productos que vienen por peso,
-- ingresan en stock pero no hay precio hasta la próxima factura, que no debería
-- ingresar en stock». Algunos proveedores los facturan a $0,10 en vez de $0
-- (La Serenísima, 10/10: tres quesos a $0,13 con impuestos). Un costo de menos
-- de $1 por unidad es «sin precio todavía»: la factura siguiente le pone el
-- costo a esa entrada sin sumar stock, igual que a las de $0.
--
-- Se cambia SOLO la condición de recibir_compra_valorizando que exigía costo 0
-- exacto (y la auditoría guarda el costo que tenía, no un 0 fijo). Se edita la
-- definición viva, no una copia: así no se pisa nada que haya cambiado después.
do $migracion$
declare
  d text := pg_get_functiondef('public.recibir_compra_valorizando(uuid,uuid,jsonb,text,uuid,jsonb,jsonb)'::regprocedure);
begin
  if position('v_item.costo_unitario <> 0' in d) = 0 then
    raise exception 'recibir_compra_valorizando no tiene la condición de costo 0: revisar a mano';
  end if;
  d := replace(d, 'v_item.costo_unitario <> 0', 'v_item.costo_unitario >= 1');
  d := replace(d,
    $q$jsonb_build_object('producto_id', v_v.producto_id, 'costo', 0, 'cantidad', v_item.cantidad_recibida)$q$,
    $q$jsonb_build_object('producto_id', v_v.producto_id, 'costo', v_item.costo_unitario, 'cantidad', v_item.cantidad_recibida)$q$);
  execute d;
end
$migracion$;

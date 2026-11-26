-- EL PAGO DEL SALDO NO REBOTA POR CENTAVOS (26/11/2026). Melina, factura A 0015-00023369 de
-- Noria Express ($ 288.723,40): el primer pago entró como $ 288,723 (el campo leía «288.723» con
-- punto decimal) y el saldo quedó en $ 288.434,677. La pantalla mostraba $ 288.435; pagar eso
-- rebotaba tres veces con «El pago supera el saldo pendiente ($288435)»: no se podía cerrar.
--  · el pago se redondea a centavos;
--  · si se pasa del saldo por menos de $ 1 (el redondeo de la pantalla), se paga justo el saldo;
--  · el mensaje dice el saldo con sus centavos, como se escribe en Argentina.
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (pago_factura_centavos).
create or replace function public.registrar_pago_factura(p_factura uuid, p_monto numeric, p_medio text DEFAULT 'transferencia'::text, p_nota text DEFAULT NULL::text, p_usuario uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  f record;
  v_saldo numeric;
  v_monto numeric;
  v_pagado numeric;
  v_estado text;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El pago debe ser mayor a cero';
  end if;

  select id, monto, monto_pagado, estado into f
  from facturas_proveedor where id = p_factura for update;
  if not found then raise exception 'Factura inexistente'; end if;
  if f.estado = 'anulada' then raise exception 'La factura está anulada'; end if;
  if f.estado = 'en_pago' then raise exception 'La factura está dentro de una orden de pago: registrá el pago por ese circuito'; end if;

  v_saldo := round(f.monto - coalesce(f.monto_pagado, 0), 2);
  v_monto := round(p_monto, 2);
  -- lo que se pasa por el redondeo de la pantalla (menos de $ 1) es pagar el saldo justo
  if v_monto > v_saldo and v_monto - v_saldo < 1 then v_monto := v_saldo; end if;
  if v_monto <= 0 then raise exception 'Esta factura no tiene saldo para pagar'; end if;
  if v_monto > v_saldo then
    raise exception 'El pago supera el saldo pendiente ($ %)',
      translate(to_char(v_saldo, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  insert into facturas_proveedor_pagos (factura_id, monto, medio, nota, usuario_id)
  values (p_factura, v_monto, coalesce(nullif(trim(p_medio), ''), 'transferencia'), p_nota, p_usuario);

  v_pagado := coalesce(f.monto_pagado, 0) + v_monto;
  v_estado := case when v_pagado >= f.monto - 0.01 then 'pagada' else 'parcial' end;
  update facturas_proveedor set monto_pagado = v_pagado, estado = v_estado where id = p_factura;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'pago_factura_proveedor', 'facturas_proveedor', p_factura::text,
          jsonb_build_object('monto', v_monto, 'medio', coalesce(nullif(trim(p_medio), ''), 'transferencia'), 'estado', v_estado));

  return jsonb_build_object('ok', true, 'estado', v_estado, 'pagado', v_pagado, 'monto', v_monto);
end $function$;

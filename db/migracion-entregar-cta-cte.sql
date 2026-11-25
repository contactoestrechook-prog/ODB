-- ENTREGAR UN PEDIDO A CUENTA CORRIENTE (25/11/2026). Juan Pablo, por Leandro, con la ventana
-- «Entregar DOM-577DE6293359 · ¿Cómo pagó?»: «agregar que fue cuenta corriente para que lo
-- facture pero lo deje en cuenta del cliente».
--
-- Hasta hoy entregar_pedido rechazaba 'cta_cte' («exige validar límite y generar la deuda, y
-- eso vive en el circuito de ventas»). Ahora lo acepta: la API valida ANTES la cuenta del
-- cliente (habilitada y dentro del tope), deja el pedido a su nombre y, después de la entrega,
-- emite el comprobante con condición cuenta corriente (FacturacionService.emitir), que es lo
-- que asienta la deuda, como en la caja. Sin efectivo: no pide caja abierta.
--
-- Solo cambia la lista de medios válidos. APLICADA por MCP en utemmsmuwocerhmuxrbs
-- (entregar_pedido_cta_cte).
CREATE OR REPLACE FUNCTION public.entregar_pedido(p_pedido uuid, p_usuario uuid DEFAULT NULL::uuid, p_medio text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido pedidos%rowtype;
  v_item record;
  v_medio text;
  v_segmento tipo_cliente;
  v_verificado boolean := false;
  v_dni text;
  v_precio numeric;
  v_total numeric := 0;
  v_sesion uuid;
  v_venta_id uuid;
  v_venta jsonb;
  v_r numeric;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;

  if v_pedido.estado = 'entregado' and v_pedido.venta_id is not null then
    return jsonb_build_object('pedido_id', p_pedido, 'venta_id', v_pedido.venta_id, 'estado', 'entregado', 'duplicada', true);
  end if;
  if v_pedido.estado not in ('listo', 'en_camino') then
    raise exception 'Transicion invalida: % -> entregado', v_pedido.estado;
  end if;

  if v_pedido.cliente_id is not null then
    select tipo, verificado, dni into v_segmento, v_verificado, v_dni
    from clientes where id = v_pedido.cliente_id;
  end if;

  v_medio := case
    when v_pedido.qr_retiro like 'PY-%' then 'pedidosya'
    when v_pedido.pagado_en is not null then 'mercadopago'
    else coalesce(nullif(trim(p_medio), ''), 'efectivo')
  end;
  -- cuenta corriente (25/11/2026): la valida la API antes (cuenta habilitada y tope) y la
  -- deuda la asienta el comprobante que emite después de la entrega
  if v_medio not in ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'pedidosya', 'cta_cte') then
    raise exception 'Medio de pago % no válido para entregar un pedido', v_medio;
  end if;

  -- la plata del mostrador tiene que caer en una caja abierta
  select s.id into v_sesion
  from sesiones_caja s join cajas c on c.id = s.caja_id
  where s.cerrada_en is null and c.sucursal_id = v_pedido.sucursal_id
  order by (s.usuario_id = p_usuario) desc, s.abierta_en desc
  limit 1;
  if v_medio = 'efectivo' and v_sesion is null then
    raise exception 'Abrí la caja de la sucursal antes de entregar un pedido cobrando en efectivo';
  end if;

  v_venta_id := coalesce(v_pedido.venta_id, gen_random_uuid());

  for v_item in
    select producto_id, cantidad, precio_unitario, reservado from pedidos_items where pedido_id = p_pedido
  loop
    v_r := reservado_del_renglon(v_pedido.reserva_stock, v_item.cantidad, v_item.reservado);
    if v_r > 0 then
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_r,
        null, 'pedido', p_pedido::text, p_usuario);
    end if;
    if v_item.precio_unitario is not null then
      v_precio := v_item.precio_unitario;
    else
      select pv.precio_final into v_precio
      from precio_vigente(v_item.producto_id, now(), v_segmento, v_medio, v_verificado, false) pv;
    end if;
    v_total := v_total + round(v_item.cantidad * coalesce(v_precio, 0), 2);
  end loop;

  perform liberar_estacionamiento(p_pedido);

  v_venta := registrar_venta(
    v_pedido.sucursal_id,
    (select coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad, 'precio_unitario', precio_unitario)), '[]'::jsonb)
       from pedidos_items where pedido_id = p_pedido),
    jsonb_build_array(jsonb_build_object('medio', v_medio, 'monto', v_total)),
    v_pedido.canal, v_dni, v_sesion, p_usuario, v_venta_id, 0, null, false);

  update pedidos
    set estado = 'entregado', venta_id = v_venta_id, entregado_en = now(), entregado_por = p_usuario,
        cambio_por = p_usuario, cambio_en = now()
    where id = p_pedido;

  return jsonb_build_object('pedido_id', p_pedido, 'venta_id', v_venta_id, 'estado', 'entregado',
                            'total', v_total, 'medio', v_medio, 'sesion_caja', v_sesion);
end $function$;

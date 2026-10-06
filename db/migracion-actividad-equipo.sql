-- QUIÉN HIZO QUÉ (Leandro, 6/10/2026: "en dónde nos quedan los datos de quién
-- hizo cada cosa"). Los datos estaban, desparramados en 20 tablas (creada_por,
-- aprobada_por, cargada_por, resuelta_por, auditoria…), y ninguna pantalla los
-- mostraba juntos. actividad_equipo() los junta en una sola lista: cuándo,
-- quién, qué área, qué hizo y dónde verlo. La pantalla es /actividad.
--
-- Solo lectura. Las filas sin autor no entran (son del sistema). Los ajustes de
-- stock se agrupan por persona y hora (la carga del sistema viejo son miles).
create or replace function public.actividad_equipo(p_desde timestamptz, p_hasta timestamptz default now())
 returns table (cuando timestamptz, usuario_id uuid, area text, accion text, detalle text, link text)
 language sql stable security definer set search_path to 'public'
as $function$
  -- PEDIDOS
  select h.creado_en, h.usuario_id, 'Pedidos',
         case h.evento
           when 'alta' then 'Cargó un pedido'
           when 'tomado' then 'Tomó un pedido'
           when 'repartidor' then 'Asignó repartidor'
           when 'pago' then 'Pago de un pedido'
           else case h.estado_despues
             when 'en_preparacion' then 'Empezó a preparar un pedido'
             when 'listo' then 'Marcó listo un pedido'
             when 'en_camino' then 'Despachó un pedido'
             when 'entregado' then 'Entregó un pedido'
             when 'cancelado' then 'Canceló un pedido'
             else 'Cambió un pedido' end end,
         coalesce(p.qr_retiro, upper(left(p.id::text, 8))) || ' · $' || replace(to_char(round(p.total), 'FM999,999,999'), ',', '.')
           || case when h.evento = 'repartidor' and h.detalle->>'repartidor' is not null then ' · ' || (h.detalle->>'repartidor') else '' end,
         '/pedidos?pedido=' || p.id
    from pedidos_historial h join pedidos p on p.id = h.pedido_id
   where h.usuario_id is not null and h.creado_en >= p_desde and h.creado_en < p_hasta
  union all
  select a.visto_en, a.visto_por, 'Pedidos', 'Marcó «Ya avisé al local»', coalesce(p.qr_retiro, ''), '/pedidos?pedido=' || p.id
    from avisos_pedidos a left join pedidos p on p.id = a.pedido_id
   where a.visto_por is not null and a.visto_en >= p_desde and a.visto_en < p_hasta
  -- AVISOS (campanita)
  union all
  select a.leida_en, a.leida_por, 'Avisos', 'Atendió un aviso', a.titulo, nullif(a.referencia->>'link', '')
    from alertas_internas a
   where a.leida_por is not null and a.leida_en >= p_desde and a.leida_en < p_hasta
  -- COMPRAS
  union all
  select o.creado_en, o.creada_por, 'Compras', 'Creó una orden de compra',
         'OC #' || o.numero || coalesce(' · ' || pr.razon_social, '') || ' · $' || replace(to_char(round(o.total), 'FM999,999,999'), ',', '.'), '/compras'
    from ordenes_compra o left join proveedores pr on pr.id = o.proveedor_id
   where o.creada_por is not null and o.creado_en >= p_desde and o.creado_en < p_hasta
  union all
  -- desde el 6/10/2026 el rechazo tiene su propio autor (rechazada_por): aprobada_por es solo la firma
  select o.aprobada_en, o.aprobada_por, 'Compras', 'Aprobó una orden de compra',
         'OC #' || o.numero || coalesce(' · ' || pr.razon_social, ''), '/compras'
    from ordenes_compra o left join proveedores pr on pr.id = o.proveedor_id
   where o.aprobada_por is not null and o.aprobada_en >= p_desde and o.aprobada_en < p_hasta
  union all
  select o.rechazada_en, o.rechazada_por, 'Compras', 'Rechazó una orden de compra',
         'OC #' || o.numero || coalesce(' · ' || pr.razon_social, '') || coalesce(' · ' || o.rechazo_motivo, ''), '/compras'
    from ordenes_compra o left join proveedores pr on pr.id = o.proveedor_id
   where o.rechazada_por is not null and o.rechazada_en >= p_desde and o.rechazada_en < p_hasta
  union all
  select o.enviada_en, o.enviada_por, 'Compras', 'Envió el pedido al proveedor', 'OC #' || o.numero || coalesce(' · ' || pr.razon_social, ''), '/compras'
    from ordenes_compra o left join proveedores pr on pr.id = o.proveedor_id
   where o.enviada_por is not null and o.enviada_en >= p_desde and o.enviada_en < p_hasta
  union all
  select o.creado_en, o.creada_por, 'Compras', 'Creó una orden de pago',
         'OP #' || o.numero || coalesce(' · ' || pr.razon_social, '') || ' · $' || replace(to_char(round(o.total), 'FM999,999,999'), ',', '.'), '/compras'
    from ordenes_pago o left join proveedores pr on pr.id = o.proveedor_id
   where o.creada_por is not null and o.creado_en >= p_desde and o.creado_en < p_hasta
  union all
  select o.aprobada_en, o.aprobada_por, 'Compras', 'Aprobó una orden de pago',
         'OP #' || o.numero || coalesce(' · ' || pr.razon_social, ''), '/compras'
    from ordenes_pago o left join proveedores pr on pr.id = o.proveedor_id
   where o.aprobada_por is not null and o.aprobada_en >= p_desde and o.aprobada_en < p_hasta
  union all
  select o.rechazada_en, o.rechazada_por, 'Compras', 'Rechazó una orden de pago',
         'OP #' || o.numero || coalesce(' · ' || pr.razon_social, '') || coalesce(' · ' || o.rechazo_motivo, ''), '/compras'
    from ordenes_pago o left join proveedores pr on pr.id = o.proveedor_id
   where o.rechazada_por is not null and o.rechazada_en >= p_desde and o.rechazada_en < p_hasta
  union all
  select f.creado_en, f.cargada_por, 'Compras', 'Cargó una factura de proveedor',
         coalesce(pr.razon_social, 'Proveedor') || ' · ' || coalesce(f.numero, '') || ' · $' || replace(to_char(round(f.monto), 'FM999,999,999'), ',', '.'), '/facturas-compra'
    from facturas_proveedor f left join proveedores pr on pr.id = f.proveedor_id
   where f.cargada_por is not null and f.creado_en >= p_desde and f.creado_en < p_hasta
  union all
  select g.creado_en, g.usuario_id, 'Compras', 'Pagó una factura de proveedor',
         coalesce(pr.razon_social, 'Proveedor') || ' · $' || replace(to_char(round(g.monto), 'FM999,999,999'), ',', '.') || coalesce(' · ' || g.medio, ''), '/facturas-compra'
    from facturas_proveedor_pagos g join facturas_proveedor f on f.id = g.factura_id left join proveedores pr on pr.id = f.proveedor_id
   where g.usuario_id is not null and g.creado_en >= p_desde and g.creado_en < p_hasta
  union all
  select r.creado_en, r.confirmado_por, 'Depósito', 'Recibió mercadería', coalesce(pr.razon_social, 'Proveedor') || coalesce(' · remito ' || r.numero, ''), '/trazabilidad'
    from remitos r left join proveedores pr on pr.id = r.proveedor_id
   where r.confirmado_por is not null and r.creado_en >= p_desde and r.creado_en < p_hasta
  union all
  select r.conciliado_en, r.conciliado_por, 'Compras', 'Cruzó remito contra factura', coalesce(pr.razon_social, 'Proveedor') || coalesce(' · remito ' || r.numero, ''), '/facturas-compra'
    from remitos r left join proveedores pr on pr.id = r.proveedor_id
   where r.conciliado_por is not null and r.conciliado_en >= p_desde and r.conciliado_en < p_hasta
  union all
  select pc.creada_en, pc.creada_por, 'Compras', 'Propuso cambios de costo', pc.titulo, '/aprobaciones'
    from propuestas_costo pc
   where pc.creada_por is not null and pc.creada_en >= p_desde and pc.creada_en < p_hasta
  union all
  select pc.decidida_en, pc.decidida_por, 'Compras', case when pc.estado::text = 'rechazada' then 'Rechazó cambios de costo' else 'Aprobó cambios de costo' end, pc.titulo, '/aprobaciones'
    from propuestas_costo pc
   where pc.decidida_por is not null and pc.decidida_en >= p_desde and pc.decidida_en < p_hasta
  -- FIRMAS
  union all
  select a.creado_en, a.usuario_id, 'Firmas', 'Firmó ' || replace(a.entidad, '_', ' '), coalesce(a.metodo, ''), '/aprobaciones'
    from aprobaciones a
   where a.usuario_id is not null and a.creado_en >= p_desde and a.creado_en < p_hasta
  -- COBROS
  union all
  select c.cargada_en, c.cargada_por, 'Cobros', 'Tomó un cobro a cuenta',
         coalesce(cl.razon_social, cl.nombre, 'Cliente') || ' · $' || replace(to_char(round(c.monto), 'FM999,999,999'), ',', '.'), '/clientes'
    from cobranzas_pendientes c left join clientes cl on cl.id = c.cliente_id
   where c.cargada_por is not null and c.cargada_en >= p_desde and c.cargada_en < p_hasta
  union all
  select c.resuelta_en, c.resuelta_por, 'Cobros', case when c.estado::text = 'rechazada' then 'Rechazó un cobro' else 'Aprobó un cobro' end,
         coalesce(cl.razon_social, cl.nombre, 'Cliente') || ' · $' || replace(to_char(round(c.monto), 'FM999,999,999'), ',', '.'), '/clientes'
    from cobranzas_pendientes c left join clientes cl on cl.id = c.cliente_id
   where c.resuelta_por is not null and c.resuelta_en >= p_desde and c.resuelta_en < p_hasta
  -- CAJA
  union all
  select s.abierta_en, s.usuario_id, 'Caja', 'Abrió la caja', coalesce(cj.nombre, 'Caja') || ' · $' || replace(to_char(round(s.monto_inicial), 'FM999,999,999'), ',', '.'), '/cierres'
    from sesiones_caja s left join cajas cj on cj.id = s.caja_id
   where s.usuario_id is not null and s.abierta_en >= p_desde and s.abierta_en < p_hasta
  union all
  select s.cerrada_en, coalesce(s.cerrada_por, s.usuario_id), 'Caja', 'Cerró la caja',
         coalesce(cj.nombre, 'Caja') || case when coalesce(s.diferencia, 0) <> 0 then ' · diferencia $' || replace(to_char(round(s.diferencia), 'FM999,999,999'), ',', '.') else ' · sin diferencia' end, '/cierres'
    from sesiones_caja s left join cajas cj on cj.id = s.caja_id
   where s.cerrada_en is not null and coalesce(s.cerrada_por, s.usuario_id) is not null and s.cerrada_en >= p_desde and s.cerrada_en < p_hasta
  union all
  select m.creado_en, m.usuario_id, 'Caja', case when m.tipo::text = 'ingreso' then 'Ingresó efectivo a la caja' else 'Retiró efectivo de la caja' end,
         '$' || replace(to_char(round(m.monto), 'FM999,999,999'), ',', '.') || coalesce(' · ' || m.motivo, ''), '/cierres'
    from caja_movimientos m
   where m.usuario_id is not null and m.creado_en >= p_desde and m.creado_en < p_hasta
  union all
  select d.creada_en, d.cajero_id, 'Caja', 'Pidió autorizar una devolución', '$' || replace(to_char(round(d.monto), 'FM999,999,999'), ',', '.') || coalesce(' · ' || d.motivo, ''), '/aprobaciones'
    from devoluciones_pendientes d
   where d.cajero_id is not null and d.creada_en >= p_desde and d.creada_en < p_hasta
  union all
  select d.resuelta_en, d.resuelta_por, 'Caja', case when d.estado::text = 'rechazada' then 'Rechazó una devolución' else 'Autorizó una devolución' end,
         '$' || replace(to_char(round(d.monto), 'FM999,999,999'), ',', '.'), '/aprobaciones'
    from devoluciones_pendientes d
   where d.resuelta_por is not null and d.resuelta_en >= p_desde and d.resuelta_en < p_hasta
  -- STOCK
  union all
  select t.creado_en, t.creada_por, 'Stock', 'Mandó una transferencia entre sucursales',
         coalesce(so.nombre, '?') || ' → ' || coalesce(sd.nombre, '?'), '/stock'
    from transferencias t left join sucursales so on so.id = t.sucursal_origen_id left join sucursales sd on sd.id = t.sucursal_destino_id
   where t.creada_por is not null and t.creado_en >= p_desde and t.creado_en < p_hasta
  union all
  select t.recibida_en, t.recibida_por, 'Stock', 'Recibió una transferencia',
         coalesce(so.nombre, '?') || ' → ' || coalesce(sd.nombre, '?'), '/stock'
    from transferencias t left join sucursales so on so.id = t.sucursal_origen_id left join sucursales sd on sd.id = t.sucursal_destino_id
   where t.recibida_por is not null and t.recibida_en >= p_desde and t.recibida_en < p_hasta
  union all
  select date_trunc('hour', m.creado_en), m.usuario_id, 'Stock',
         case when count(*) = 1 then 'Ajustó el stock de un producto' else 'Ajustó el stock de ' || count(*) || ' productos' end,
         coalesce(max(su.nombre), ''), '/stock'
    from movimientos_stock m left join sucursales su on su.id = m.sucursal_id
   where m.usuario_id is not null and m.tipo::text in ('ajuste', 'merma') and m.creado_en >= p_desde and m.creado_en < p_hasta
   group by date_trunc('hour', m.creado_en), m.usuario_id
  union all
  select c.creado_en, c.usuario_id, 'Stock', 'Hizo un conteo', coalesce(c.sector, '') , '/conteo'
    from conteos c
   where c.usuario_id is not null and c.creado_en >= p_desde and c.creado_en < p_hasta
  -- REPARTO
  union all
  select r.creado_en, r.creado_por, 'Reparto', 'Armó un reparto', 'Reparto Nº ' || r.numero || coalesce(' · ' || r.zona, ''), '/reparto'
    from repartos r
   where r.creado_por is not null and r.creado_en >= p_desde and r.creado_en < p_hasta
  -- DOCUMENTOS
  union all
  select d.emitido_en, d.emitido_por, 'Documentos', 'Emitió un documento', d.folio, '/trazabilidad'
    from documentos d
   where d.emitido_por is not null and d.emitido_en >= p_desde and d.emitido_en < p_hasta
  -- SISTEMA ("Esto está mal")
  union all
  select r.creado_en, r.usuario_id, 'Sistema', 'Reportó «Esto está mal»', coalesce(r.pantalla, '') || ' · ' || left(coalesce(r.mensaje, ''), 120), '/reportes'
    from reportes_sistema r
   where r.usuario_id is not null and r.creado_en >= p_desde and r.creado_en < p_hasta
  -- TODO LO DEMÁS QUE QUEDÓ EN AUDITORÍA (lo que no está arriba)
  union all
  select a.creado_en, a.usuario_id,
         case when a.entidad like 'usuario%' then 'Usuarios' when a.entidad in ('venta', 'ventas') then 'Caja' when a.entidad like '%compra%' then 'Compras' else 'Sistema' end,
         case a.accion
           when 'compra_directa' then 'Cargó una compra (entrada de mercadería)'
           when 'crear_usuario' then 'Creó un usuario'
           when 'editar_usuario' then 'Editó un usuario'
           when 'desactivar_usuario' then 'Desactivó un usuario'
           when 'eliminar_usuario' then 'Eliminó un usuario'
           when 'cambiar_clave' then 'Cambió su clave'
           when 'clave_restablecida' then 'Restableció una clave'
           when 'descuento_caja' then 'Hizo un descuento en caja'
           when 'devolucion_parcial' then 'Hizo una devolución parcial'
           when 'anular_transferencia' then 'Anuló una transferencia'
           when 'conciliar_remito_factura' then 'Cruzó remito contra factura'
           when 'salida_validada' then 'Validó una salida'
           when 'importacion_sistema_viejo' then 'Importó datos del sistema viejo'
           when 'prueba_circuito_compras' then 'Probó el circuito de compras'
           else initcap(replace(a.accion, '_', ' ')) end,
         coalesce(a.entidad, '') , null
    from auditoria a
   where a.usuario_id is not null and a.creado_en >= p_desde and a.creado_en < p_hasta
     and a.accion not in ('aprobacion_firmada', 'aprobar_propuesta_costo', 'conciliar_remito_factura', 'orden_compra_rechazada', 'orden_pago_rechazada', 'recepcion_contra_orden')
$function$;
revoke all on function public.actividad_equipo(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.actividad_equipo(timestamptz, timestamptz) to service_role;

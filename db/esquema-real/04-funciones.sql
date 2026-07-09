-- =============================================================
-- ODB — Esquema real: funciones (sql / plpgsql)
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-02
-- Fuente: pg_get_functiondef sobre pg_proc (schema public, lenguajes sql y
-- plpgsql; excluidas las funciones C de extensiones como pg_trgm/unaccent).
-- 66 funciones, orden alfabético.
-- Nota de dependencias: quitar_tildes() es usada por la columna generada
-- productos.nombre_normalizado (02-tablas.sql); crearla antes de las tablas
-- si se corre desde cero. Varias funciones usan crypt()/digest() (pgcrypto,
-- schema extensions) y similarity() (pg_trgm).
-- =============================================================

CREATE OR REPLACE FUNCTION public.abrir_sesion_caja(p_caja uuid, p_usuario uuid, p_monto_inicial numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if p_monto_inicial < 0 then raise exception 'Monto inicial inválido'; end if;
  if exists (select 1 from sesiones_caja where caja_id = p_caja and cerrada_en is null) then
    raise exception 'La caja ya tiene una sesión abierta';
  end if;
  insert into sesiones_caja (caja_id, usuario_id, monto_inicial)
  values (p_caja, p_usuario, p_monto_inicial)
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.analizar_proveedor(p_proveedor uuid)
 RETURNS TABLE(nombre text, costo_este numeric, mejor_otro numeric, prov_otro text, diff_pct numeric, este_mas_barato boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pr.nombre, este.ultimo_costo, o.mejor, o.prov,
    round((este.ultimo_costo - o.mejor) / nullif(o.mejor, 0) * 100, 1),
    este.ultimo_costo <= o.mejor
  from proveedor_productos este
  join productos pr on pr.id = este.producto_id
  join lateral (
    select min(x.ultimo_costo) as mejor,
           (array_agg(p.razon_social order by x.ultimo_costo asc))[1] as prov
    from proveedor_productos x
    join proveedores p on p.id = x.proveedor_id
    where x.producto_id = este.producto_id and x.proveedor_id <> p_proveedor and x.ultimo_costo > 0
  ) o on o.mejor is not null
  where este.proveedor_id = p_proveedor and este.ultimo_costo > 0
  order by 5;
$function$
;

CREATE OR REPLACE FUNCTION public.anular_transferencia(p_transferencia uuid, p_usuario uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t transferencias%rowtype;
  v_item record;
  v_unidades numeric := 0;
begin
  select * into v_t from transferencias where id = p_transferencia for update;
  if not found then raise exception 'No existe la transferencia'; end if;
  if v_t.estado <> 'en_transito' then
    raise exception 'La transferencia esta %, solo se puede anular en transito', v_t.estado;
  end if;

  -- devuelve el stock a la sucursal de ORIGEN (la mercaderia no llego a destino:
  -- se perdio en el camino o se cargo por error)
  for v_item in select producto_id, cantidad from transferencias_items
                where transferencia_id = p_transferencia loop
    perform registrar_movimiento(
      v_item.producto_id, v_t.sucursal_origen_id, 'transferencia_entrada', v_item.cantidad,
      coalesce(p_motivo, 'Anulacion de transferencia'), 'transferencia_anulada', p_transferencia::text, p_usuario);
    v_unidades := v_unidades + v_item.cantidad;
  end loop;

  update transferencias set estado = 'anulada' where id = p_transferencia;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'anular_transferencia', 'transferencia', p_transferencia::text,
          jsonb_build_object('motivo', p_motivo, 'unidades_devueltas', v_unidades));

  return jsonb_build_object('anulada', true, 'unidades_devueltas', v_unidades);
end $function$
;

CREATE OR REPLACE FUNCTION public.anular_venta(p_venta uuid, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venta ventas%rowtype;
  v_item record;
  v_pv integer;
begin
  select * into v_venta from ventas where id = p_venta for update;
  if not found then raise exception 'No existe la venta'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'La venta ya esta %', v_venta.estado;
  end if;

  for v_item in select producto_id, cantidad from ventas_items where venta_id = p_venta loop
    perform registrar_movimiento(
      v_item.producto_id, v_venta.sucursal_id, 'devolucion', v_item.cantidad,
      null, 'venta_anulada', p_venta::text, p_usuario);
  end loop;

  update ventas set estado = 'anulada' where id = p_venta;
  select coalesce(punto_venta_arca, 1) into v_pv from sucursales where id = v_venta.sucursal_id;
  insert into comprobantes_arca (venta_id, tipo, punto_venta, estado)
  values (p_venta, 'NCB', v_pv, 'pendiente');

  return jsonb_build_object('anulada', true, 'total', v_venta.total);
end $function$
;

CREATE OR REPLACE FUNCTION public.aplicar_lista_con_precio(p_proveedor uuid, p_items jsonb, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item record; v_pid uuid; v_lista uuid; v_n int := 0;
begin
  select id into v_lista from listas_precios where nombre = 'Minorista' limit 1;
  for v_item in
    select i->>'sku' as sku, (i->>'costo')::numeric as costo, (i->>'precio')::numeric as precio
    from jsonb_array_elements(p_items) i
  loop
    select id into v_pid from productos where sku = v_item.sku;
    if v_pid is null then continue; end if;
    update productos set costo = v_item.costo where id = v_pid;
    insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
      values (p_proveedor, v_pid, v_item.costo, now())
      on conflict (proveedor_id, producto_id) do update set ultimo_costo = excluded.ultimo_costo, actualizado_en = now();
    insert into costos_historial (proveedor_id, producto_id, costo, origen)
      values (p_proveedor, v_pid, v_item.costo, 'lista_pdf');
    if v_lista is not null and v_item.precio is not null then
      insert into precios (lista_id, producto_id, precio, creado_por)
        values (v_lista, v_pid, v_item.precio, p_usuario);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.aplicar_lista_proveedor(p_proveedor uuid, p_items jsonb, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item record;
  v_aplicados int := 0;
begin
  for v_item in
    select i->>'sku' as sku, (i->>'costo')::numeric as costo
    from jsonb_array_elements(p_items) i
  loop
    update productos p set costo = v_item.costo where p.sku = v_item.sku;
    if not found then continue; end if;

    insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
    select p_proveedor, p.id, v_item.costo, now() from productos p where p.sku = v_item.sku
    on conflict (proveedor_id, producto_id)
    do update set ultimo_costo = excluded.ultimo_costo, actualizado_en = now();

    insert into costos_historial (proveedor_id, producto_id, costo, origen)
    select p_proveedor, p.id, v_item.costo, 'lista_archivo' from productos p where p.sku = v_item.sku;

    v_aplicados := v_aplicados + 1;
  end loop;
  return v_aplicados;
end $function$
;

CREATE OR REPLACE FUNCTION public.aprobar_oc_panel(p_oc uuid, p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_oc ordenes_compra%rowtype;
begin
  if p_usuario is null then raise exception 'Falta el usuario aprobador'; end if;
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado <> 'pendiente_aprobacion' then
    raise exception 'La orden esta "%", no se puede aprobar', v_oc.estado;
  end if;
  update ordenes_compra
  set estado = 'aprobada', aprobada_por = p_usuario, aprobada_en = now()
  where id = p_oc;
  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_compra', p_oc, p_usuario,
          md5(v_oc.id::text || v_oc.total::text || v_oc.proveedor_id::text), 'panel');
end $function$
;

CREATE OR REPLACE FUNCTION public.aprobar_op_panel(p_op uuid, p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_op ordenes_pago%rowtype;
begin
  if p_usuario is null then raise exception 'Falta el usuario aprobador'; end if;
  select * into v_op from ordenes_pago where id = p_op for update;
  if not found then raise exception 'No existe la orden de pago'; end if;
  if v_op.estado <> 'pendiente_aprobacion' then
    raise exception 'La OP esta "%"', v_op.estado;
  end if;
  update ordenes_pago
  set estado = 'aprobada', aprobada_por = p_usuario, aprobada_en = now()
  where id = p_op;
  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_pago', p_op, p_usuario,
          md5(v_op.id::text || v_op.total::text || v_op.proveedor_id::text), 'panel');
end $function$
;

CREATE OR REPLACE FUNCTION public.aprobar_orden_compra(p_oc uuid, p_usuario uuid, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_oc ordenes_compra%rowtype;
  v_user usuarios%rowtype;
  v_ok boolean;
begin
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado <> 'pendiente_aprobacion' then
    raise exception 'La OC esta en estado %, no se puede aprobar', v_oc.estado;
  end if;

  select * into v_user from usuarios where id = p_usuario and activo;
  if not found then raise exception 'Usuario inexistente o inactivo'; end if;
  if v_user.pin_firma is null then raise exception 'PIN de firma incorrecto'; end if;
  if length(v_user.pin_firma) = 60 then
    v_ok := v_user.pin_firma = crypt(p_pin, v_user.pin_firma);
  else
    v_ok := v_user.pin_firma = encode(digest(p_pin, 'sha256'), 'hex');
  end if;
  if not v_ok then raise exception 'PIN de firma incorrecto'; end if;
  if v_user.limite_aprobacion < v_oc.total then
    raise exception 'El monto % supera el limite de aprobacion de % (%)',
      v_oc.total, v_user.nombre, v_user.limite_aprobacion;
  end if;

  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_compra', p_oc, p_usuario,
          md5(v_oc.id::text || v_oc.total::text || v_oc.proveedor_id::text), 'pin');
  update ordenes_compra set estado = 'aprobada' where id = p_oc;
end $function$
;

CREATE OR REPLACE FUNCTION public.asegurar_codigo_referido(p_cliente uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cod text; v_existente text; v_intentos int := 0;
begin
  select codigo_referido into v_existente from clientes where id = p_cliente;
  if v_existente is not null then return v_existente; end if;
  loop
    v_intentos := v_intentos + 1;
    v_cod := upper(substring(md5(gen_random_uuid()::text) for 6));
    begin
      update clientes set codigo_referido = v_cod where id = p_cliente;
      return v_cod;
    exception when unique_violation then
      if v_intentos > 10 then raise; end if;
    end;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.asignar_estacionamiento(p_pedido uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_suc uuid; v_num int; v_existente int;
begin
  select estacionamiento, sucursal_id into v_existente, v_suc from pedidos where id = p_pedido;
  if v_existente is not null then return v_existente; end if;
  if v_suc is null then return null; end if;
  update estacionamientos e
    set ocupado = true, pedido_id = p_pedido, asignado_en = now()
  where e.id = (
    select id from estacionamientos
    where sucursal_id = v_suc and ocupado = false
    order by numero limit 1 for update skip locked
  )
  returning numero into v_num;
  if v_num is not null then
    update pedidos set estacionamiento = v_num, llego_en = now() where id = p_pedido;
  end if;
  return v_num;
end $function$
;

CREATE OR REPLACE FUNCTION public.buscar_producto_similar(p_texto text)
 RETURNS TABLE(sku text, nombre text, similitud real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.sku, p.nombre, similarity(p.nombre_normalizado, quitar_tildes(p_texto)) as similitud
  from productos p
  where p.activo and similarity(p.nombre_normalizado, quitar_tildes(p_texto)) > 0.25
  order by similitud desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.catalogo_precios(p_ids uuid[], p_verificado boolean DEFAULT false, p_segmento tipo_cliente DEFAULT NULL::tipo_cliente)
 RETURNS TABLE(producto_id uuid, precio_lista numeric, precio_final numeric, descuento_nombre text, descuento_comunidad boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, (pv).precio_lista, (pv).precio_final, (pv).descuento_nombre, (pv).descuento_comunidad
  from unnest(p_ids) as ids(id)
  join productos p on p.id = ids.id
  cross join lateral (select precio_vigente(p.id, now(), p_segmento, null, p_verificado) as pv) x;
$function$
;

CREATE OR REPLACE FUNCTION public.cerrar_sesion_caja(p_sesion uuid, p_monto_cierre numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sesion sesiones_caja%rowtype;
  v_efectivo numeric;
  v_ingresos numeric;
  v_egresos numeric;
  v_esperado numeric;
begin
  select * into v_sesion from sesiones_caja where id = p_sesion for update;
  if not found then raise exception 'No existe la sesion'; end if;
  if v_sesion.cerrada_en is not null then raise exception 'La sesion ya esta cerrada'; end if;

  select coalesce(sum(p.monto), 0) into v_efectivo
  from pagos p
  join ventas v on v.id = p.venta_id
  where v.sesion_caja_id = p_sesion and v.estado = 'completada' and p.medio = 'efectivo';

  -- ingresos y retiros de efectivo hechos durante la sesion (cambio, retiros a
  -- tesoreria, reintegros de devoluciones): entran al arqueo
  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0),
         coalesce(sum(monto) filter (where tipo = 'egreso'), 0)
    into v_ingresos, v_egresos
  from caja_movimientos where sesion_id = p_sesion;

  v_esperado := v_sesion.monto_inicial + v_efectivo + v_ingresos - v_egresos;

  update sesiones_caja
  set cerrada_en = now(),
      monto_cierre = p_monto_cierre,
      diferencia = p_monto_cierre - v_esperado
  where id = p_sesion;

  return jsonb_build_object(
    'esperado', v_esperado,
    'contado', p_monto_cierre,
    'diferencia', p_monto_cierre - v_esperado,
    'efectivoVentas', v_efectivo,
    'ingresos', v_ingresos,
    'egresos', v_egresos
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.clasificar_cliente(p_cliente uuid)
 RETURNS tipo_cliente
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actual tipo_cliente;
  v_n int; v_prom numeric; v_90dias int;
  v_nuevo tipo_cliente;
begin
  select tipo into v_actual from clientes where id = p_cliente;
  if v_actual = 'mayorista' then return v_actual; end if;

  select count(*), coalesce(avg(total), 0) into v_n, v_prom
  from ventas where cliente_id = p_cliente and estado = 'completada';

  if v_n < 3 then
    v_nuevo := 'nuevo';
  else
    select count(*) into v_90dias from ventas
    where cliente_id = p_cliente and estado = 'completada'
      and vendida_en > now() - interval '90 days';
    v_nuevo := case
      when v_prom >= 40000 then 'vip'
      when v_90dias >= 6 then 'frecuente'
      else 'ocasional'
    end;
  end if;

  update clientes set tipo = v_nuevo where id = p_cliente and tipo <> v_nuevo;
  return v_nuevo;
end $function$
;

CREATE OR REPLACE FUNCTION public.clientes_inactivos(p_dias integer DEFAULT 45)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id
  from clientes c
  where coalesce(c.acepta_marketing, true) <> false
    and exists (select 1 from ventas v where v.cliente_id = c.id)
    and not exists (
      select 1 from ventas v2
      where v2.cliente_id = c.id
        and v2.vendida_en >= now() - make_interval(days => greatest(p_dias, 1))
    );
$function$
;

CREATE OR REPLACE FUNCTION public.comparar_proveedores(p_min integer DEFAULT 2)
 RETURNS TABLE(producto_id uuid, nombre text, n_prov integer, costo_min numeric, prov_min text, pago_min text, desc_min numeric, costo_lista_min numeric, costo_max numeric, prov_max text, spread_pct numeric, ahorro numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pp as (
    select pp.producto_id, p.razon_social, p.condicion_pago, p.descuento_efectivo,
      pp.ultimo_costo as costo_lista,
      round(pp.ultimo_costo * (1 - coalesce(p.descuento_efectivo, 0) / 100), 2) as costo_efectivo,
      count(*) over (partition by pp.producto_id) as n
    from proveedor_productos pp
    join proveedores p on p.id = pp.proveedor_id
    where pp.ultimo_costo > 0
  ),
  r as (
    select *,
      row_number() over (partition by producto_id order by costo_efectivo asc)  as rmin,
      row_number() over (partition by producto_id order by costo_efectivo desc) as rmax
    from pp
  )
  select pr.id, pr.nombre, mn.n::int,
    mn.costo_efectivo, mn.razon_social, mn.condicion_pago, mn.descuento_efectivo, mn.costo_lista,
    mx.costo_efectivo, mx.razon_social,
    round((mx.costo_efectivo - mn.costo_efectivo) / nullif(mn.costo_efectivo, 0) * 100, 1),
    round(mx.costo_efectivo - mn.costo_efectivo, 2)
  from r mn
  join r mx on mx.producto_id = mn.producto_id and mx.rmax = 1
  join productos pr on pr.id = mn.producto_id
  where mn.rmin = 1 and mn.n >= p_min
  order by 12 desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.conciliacion_resumen()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'porAcreditar', coalesce((select sum(neto_estimado) from acreditaciones where estado = 'pendiente'), 0),
    'pendientes',   (select count(*) from acreditaciones where estado = 'pendiente'),
    'atrasadas',    (select count(*) from acreditaciones where estado = 'pendiente' and fecha_estimada < current_date),
    'atrasadoMonto',coalesce((select sum(neto_estimado) from acreditaciones where estado = 'pendiente' and fecha_estimada < current_date), 0),
    'acreditadoMes',coalesce((select sum(neto_real) from acreditaciones where estado = 'acreditada' and date_trunc('month', fecha_real) = date_trunc('month', current_date)), 0),
    'comisionMes',  coalesce((select sum(comision_real) from acreditaciones where estado = 'acreditada' and date_trunc('month', fecha_real) = date_trunc('month', current_date)), 0),
    'porMedio', (select coalesce(jsonb_agg(m), '[]'::jsonb) from (
        select medio,
          count(*) filter (where estado = 'pendiente') as pendientes,
          coalesce(sum(neto_estimado) filter (where estado = 'pendiente'), 0) as por_acreditar,
          coalesce(sum(comision_estimada) filter (where estado = 'pendiente'), 0) as comision_pendiente,
          coalesce(sum(neto_real) filter (where estado = 'acreditada'), 0) as acreditado
        from acreditaciones group by medio) m)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.conciliar_lote(p_medio text, p_hasta date, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update acreditaciones
    set estado = 'acreditada',
        neto_real = neto_estimado,
        comision_real = comision_estimada,
        fecha_real = fecha_estimada,
        conciliado_en = now(),
        conciliado_por = p_usuario,
        nota = coalesce(nota, 'Acreditado en lote (estimado)')
    where medio = p_medio and estado = 'pendiente' and fecha_estimada <= p_hasta;
  get diagnostics n = row_count;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.conteo_cargar_item(p_conteo uuid, p_producto uuid, p_cantidad_contada numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conteo conteos%rowtype;
  v_sistema numeric;
begin
  select * into v_conteo from conteos where id = p_conteo;
  if not found then raise exception 'No existe el conteo'; end if;
  if v_conteo.estado <> 'abierto' then raise exception 'El conteo esta %', v_conteo.estado; end if;
  if p_cantidad_contada < 0 then raise exception 'La cantidad contada no puede ser negativa'; end if;

  -- snapshot del stock del sistema AL MOMENTO de contar (no al finalizar):
  -- si se vende algo mientras se cuenta otra gondola, el diff no se contamina
  select coalesce(cantidad, 0) into v_sistema
  from stock where producto_id = p_producto and sucursal_id = v_conteo.sucursal_id;
  v_sistema := coalesce(v_sistema, 0);

  insert into conteos_items (conteo_id, producto_id, cantidad_contada, cantidad_sistema)
  values (p_conteo, p_producto, p_cantidad_contada, v_sistema)
  on conflict (conteo_id, producto_id)
  do update set cantidad_contada = excluded.cantidad_contada,
                cantidad_sistema = excluded.cantidad_sistema;

  return jsonb_build_object('sistema', v_sistema, 'contado', p_cantidad_contada,
                            'diferencia', p_cantidad_contada - v_sistema);
end $function$
;

CREATE OR REPLACE FUNCTION public.crear_orden_compra(p_proveedor uuid, p_sucursal uuid, p_items jsonb, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_item record;
  v_total numeric := 0;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La orden de compra no tiene renglones';
  end if;
  insert into ordenes_compra (proveedor_id, sucursal_id, estado, total, creada_por)
  values (p_proveedor, p_sucursal, 'pendiente_aprobacion', 0, p_usuario)
  returning id into v_id;

  for v_item in
    select (i->>'producto_id')::uuid producto_id,
           (i->>'cantidad')::numeric cantidad,
           (i->>'costo_unitario')::numeric costo
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad <= 0 or v_item.costo < 0 then
      raise exception 'Renglón inválido';
    end if;
    insert into ordenes_compra_items (oc_id, producto_id, cantidad, costo_unitario)
    values (v_id, v_item.producto_id, v_item.cantidad, v_item.costo);
    v_total := v_total + v_item.cantidad * v_item.costo;
  end loop;

  update ordenes_compra set total = v_total where id = v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.crear_orden_pago(p_facturas uuid[], p_medio text DEFAULT NULL::text, p_vencimiento date DEFAULT NULL::date, p_programada date DEFAULT NULL::date, p_observaciones text DEFAULT NULL::text, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_provs uuid[];
  v_total numeric;
  v_venc date;
  v_cant integer;
  v_op uuid;
  v_num bigint;
begin
  if p_facturas is null or array_length(p_facturas, 1) is null then
    raise exception 'Elegi al menos una factura';
  end if;
  perform id from facturas_proveedor where id = any(p_facturas) for update;

  select array_agg(distinct proveedor_id), coalesce(sum(monto), 0), count(*), min(vencimiento)
    into v_provs, v_total, v_cant, v_venc
  from facturas_proveedor
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  if v_cant = 0 then raise exception 'Esas facturas ya estan pagadas o en una OP'; end if;
  if array_length(v_provs, 1) > 1 then
    raise exception 'Las facturas son de distintos proveedores: arma una OP por proveedor';
  end if;

  insert into ordenes_pago (proveedor_id, total, medio_pago, estado, vencimiento,
                            fecha_programada, observaciones, creada_por)
  values (v_provs[1], v_total, coalesce(p_medio, 'transferencia'), 'pendiente_aprobacion',
          coalesce(p_vencimiento, v_venc), p_programada, p_observaciones, p_usuario)
  returning id, numero into v_op, v_num;

  insert into ordenes_pago_items (orden_pago_id, factura_id, monto)
  select v_op, id, monto from facturas_proveedor
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  update facturas_proveedor set estado = 'en_pago'
  where id = any(p_facturas) and estado not in ('pagada', 'en_pago');

  return jsonb_build_object('orden_pago_id', v_op, 'numero', v_num,
                            'total', v_total, 'facturas', v_cant);
end $function$
;

CREATE OR REPLACE FUNCTION public.crear_pedido(p_canal canal_venta, p_sucursal uuid, p_items jsonb, p_cliente_id uuid DEFAULT NULL::uuid, p_cliente_dni text DEFAULT NULL::text, p_qr_retiro text DEFAULT NULL::text, p_reservar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido uuid;
  v_total numeric := 0;
  v_cliente uuid := p_cliente_id;
  v_item record;
  v_precio numeric;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;

  if v_cliente is null and coalesce(trim(p_cliente_dni), '') <> '' then
    select id into v_cliente from clientes where dni = trim(p_cliente_dni);
    if not found then
      insert into clientes (dni) values (trim(p_cliente_dni)) returning id into v_cliente;
    end if;
  end if;

  insert into pedidos (canal, sucursal_id, cliente_id, estado, total, qr_retiro)
  values (p_canal, p_sucursal, v_cliente, 'recibido', 0, p_qr_retiro)
  returning id into v_pedido;

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'Cantidad invalida en el pedido';
    end if;
    select coalesce(cp.precio_final, cp.precio_lista, 0) into v_precio
    from catalogo_precios(array[v_item.producto_id], false, null::tipo_cliente) cp;
    v_precio := coalesce(v_precio, 0);

    insert into pedidos_items (pedido_id, producto_id, cantidad, precio_unitario)
    values (v_pedido, v_item.producto_id, v_item.cantidad, v_precio);
    v_total := v_total + round(v_item.cantidad * v_precio, 2);

    if coalesce(p_reservar, true) then
      perform registrar_movimiento(
        v_item.producto_id, p_sucursal, 'reserva', -v_item.cantidad,
        null, 'pedido', v_pedido::text, null);
    end if;
  end loop;

  update pedidos set total = v_total where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'total', v_total);
end $function$
;

CREATE OR REPLACE FUNCTION public.crear_transferencia(p_origen uuid, p_destino uuid, p_items jsonb, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_item record;
begin
  if p_origen = p_destino then
    raise exception 'Origen y destino no pueden ser la misma sucursal';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene renglones';
  end if;

  insert into transferencias (sucursal_origen_id, sucursal_destino_id, estado, creada_por)
  values (p_origen, p_destino, 'en_transito', p_usuario_id)
  returning id into v_id;

  for v_item in select (i->>'producto_id')::uuid as producto_id, (i->>'cantidad')::numeric as cantidad
                from jsonb_array_elements(p_items) i loop
    if v_item.cantidad <= 0 then
      raise exception 'Las cantidades deben ser positivas';
    end if;
    insert into transferencias_items (transferencia_id, producto_id, cantidad)
    values (v_id, v_item.producto_id, v_item.cantidad);
    perform registrar_movimiento(
      v_item.producto_id, p_origen, 'transferencia_salida', -v_item.cantidad,
      null, 'transferencia', v_id::text, p_usuario_id);
  end loop;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.cumpleaneros_hoy()
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id
  from clientes c
  where c.fecha_nacimiento is not null
    and to_char(c.fecha_nacimiento, 'MM-DD')
        = to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'MM-DD')
    and coalesce(c.acepta_marketing, true) <> false;
$function$
;

CREATE OR REPLACE FUNCTION public.cumpleanos_proximos(p_dias integer DEFAULT 60)
 RETURNS TABLE(cliente_id uuid, nombre text, dni text, fecha_nacimiento date, dias integer, tiene_evento boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with calc as (
    select c.id, c.nombre, c.dni, c.fecha_nacimiento,
      (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy,
      (c.fecha_nacimiento + ((extract(year from age(c.fecha_nacimiento)))::int + 1) * interval '1 year')::date as prox
    from clientes c
    where c.fecha_nacimiento is not null
  )
  select calc.id, calc.nombre, calc.dni, calc.fecha_nacimiento, (calc.prox - calc.hoy)::int as dias,
    exists(
      select 1 from eventos e
      where e.cliente_id = calc.id and e.tipo = 'cumpleanos'
        and e.fecha between calc.hoy and calc.hoy + 400
    ) as tiene_evento
  from calc
  where (calc.prox - calc.hoy) between 0 and p_dias
  order by dias;
$function$
;

CREATE OR REPLACE FUNCTION public.descontar_puntos(p_cliente uuid, p_puntos integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saldo int;
begin
  if p_puntos <= 0 then raise exception 'Puntos inválidos'; end if;
  update clientes set puntos = puntos - p_puntos
  where id = p_cliente and puntos >= p_puntos
  returning puntos into v_saldo;
  return v_saldo;
end $function$
;

CREATE OR REPLACE FUNCTION public.devolver_venta_parcial(p_venta uuid, p_items jsonb, p_usuario uuid DEFAULT NULL::uuid, p_autorizado_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venta ventas%rowtype;
  v_item record;
  v_vendida numeric;
  v_devuelta numeric;
  v_precio numeric;
  v_monto numeric := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_pv int;
begin
  select * into v_venta from ventas where id = p_venta for update;
  if not found then raise exception 'No existe la venta'; end if;
  if v_venta.estado <> 'completada' then
    raise exception 'La venta esta %, no admite devoluciones', v_venta.estado;
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Indica que renglones se devuelven';
  end if;

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad <= 0 then raise exception 'Cantidad invalida'; end if;

    select coalesce(sum(vi.cantidad), 0), coalesce(max(vi.precio_unitario), 0)
      into v_vendida, v_precio
    from ventas_items vi
    where vi.venta_id = p_venta and vi.producto_id = v_item.producto_id;
    if v_vendida = 0 then raise exception 'El producto no pertenece a esta venta'; end if;

    -- lo ya devuelto en devoluciones parciales anteriores de esta venta
    select coalesce(sum(m.cantidad), 0) into v_devuelta
    from movimientos_stock m
    where m.tipo = 'devolucion'
      and m.referencia_tipo = 'devolucion_parcial'
      and m.referencia_id = p_venta::text
      and m.producto_id = v_item.producto_id;

    if v_item.cantidad > v_vendida - v_devuelta then
      raise exception 'Se devuelven % pero quedan % sin devolver de este producto',
        v_item.cantidad, v_vendida - v_devuelta;
    end if;

    perform registrar_movimiento(
      v_item.producto_id, v_venta.sucursal_id, 'devolucion', v_item.cantidad,
      null, 'devolucion_parcial', p_venta::text, p_usuario);

    v_monto := v_monto + round(v_item.cantidad * v_precio, 2);
    v_detalle := v_detalle || jsonb_build_object(
      'producto_id', v_item.producto_id, 'cantidad', v_item.cantidad,
      'precio_unitario', v_precio, 'total', round(v_item.cantidad * v_precio, 2));
  end loop;

  -- NC en la cola ARCA (parcial) + auditoria de quien autorizo
  select coalesce(punto_venta_arca, 1) into v_pv from sucursales where id = v_venta.sucursal_id;
  insert into comprobantes_arca (venta_id, tipo, punto_venta, estado)
  values (p_venta, 'NCB', v_pv, 'pendiente');

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (coalesce(p_autorizado_por, p_usuario), 'devolucion_parcial', 'venta', p_venta::text,
          jsonb_build_object('monto', v_monto, 'items', v_detalle, 'cajero', p_usuario));

  return jsonb_build_object('venta_id', p_venta, 'monto', v_monto, 'items', v_detalle);
end $function$
;

CREATE OR REPLACE FUNCTION public.eficiencia_cajeros()
 RETURNS TABLE(usuario text, rol rol_usuario, sesiones integer, tickets bigint, minutos numeric, monto numeric, min_por_ticket numeric, tickets_hora numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (
    select sc.usuario_id,
      greatest(extract(epoch from (coalesce(sc.cerrada_en, now()) - sc.abierta_en))/60, 0) as min,
      (select count(*) from ventas v where v.sesion_caja_id = sc.id and v.estado = 'completada') as tickets,
      (select coalesce(sum(v.total),0) from ventas v where v.sesion_caja_id = sc.id and v.estado = 'completada') as monto
    from sesiones_caja sc
  ),
  agg as (
    select usuario_id, count(*)::int sesiones, sum(tickets) tickets, sum(min) minutos, sum(monto) monto
    from s group by usuario_id
  )
  select u.nombre, u.rol, a.sesiones, a.tickets, round(a.minutos)::numeric, round(a.monto)::numeric,
    case when a.tickets > 0 then round((a.minutos / a.tickets)::numeric, 1) else null end,
    case when a.minutos > 0 then round((a.tickets / (a.minutos/60))::numeric, 1) else null end
  from agg a join usuarios u on u.id = a.usuario_id
  where a.tickets > 0
  order by a.tickets desc;
$function$
;

CREATE OR REPLACE FUNCTION public.eficiencia_preparadores()
 RETURNS TABLE(usuario text, rol rol_usuario, pedidos bigint, prep_min numeric, entrega_min numeric, items_pedido numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.nombre, u.rol, count(*)::bigint,
    round(avg(extract(epoch from (p.listo_en - p.preparacion_en))/60)::numeric, 1),
    round(avg(extract(epoch from (p.entregado_en - p.listo_en))/60) filter (where p.entregado_en is not null)::numeric, 1),
    round(avg((select coalesce(sum(cantidad),0) from pedidos_items pi where pi.pedido_id = p.id))::numeric, 1)
  from pedidos p
  join usuarios u on u.id = p.preparado_por
  where p.preparado_por is not null and p.preparacion_en is not null and p.listo_en is not null
  group by u.nombre, u.rol
  order by count(*) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.envases_resumen()
 RETURNS TABLE(tipo_id uuid, nombre text, valor numeric, en_calle bigint, clientes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select te.id, te.nombre, te.valor,
    coalesce(sum(me.cantidad),0)::bigint,
    count(distinct me.cliente_id) filter (where me.cantidad is not null)
  from tipos_envase te left join movimientos_envase me on me.tipo_id=te.id
  where te.activo
  group by te.id, te.nombre, te.valor order by te.nombre;
$function$
;

CREATE OR REPLACE FUNCTION public.envases_saldos_cliente()
 RETURNS TABLE(cliente_id uuid, nombre text, total bigint, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, coalesce(nullif(c.nombre,''), c.razon_social, c.dni, 'Cliente'),
    sum(me.cantidad)::bigint, sum(me.cantidad*te.valor)
  from movimientos_envase me
  join clientes c on c.id=me.cliente_id
  join tipos_envase te on te.id=me.tipo_id
  group by c.id, coalesce(nullif(c.nombre,''), c.razon_social, c.dni, 'Cliente')
  having sum(me.cantidad) > 0
  order by sum(me.cantidad*te.valor) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.facturas_abiertas(p_cliente uuid)
 RETURNS TABLE(id uuid, tipo tipo_comprobante, punto_venta integer, numero bigint, emitido_en timestamp with time zone, total numeric, imputado numeric, nc_acreditada numeric, saldo numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select * from (
    select c.id, c.tipo, c.punto_venta, c.numero, c.emitido_en, c.total,
           coalesce((select sum(ri.importe) from recibo_imputaciones ri where ri.factura_id = c.id), 0) as imputado,
           coalesce((select sum(nc.total) from comprobantes nc
                     where nc.referencia_id = c.id and nc.tipo::text like 'NC%' and nc.estado = 'emitido'), 0) as nc_acreditada,
           c.total
             - coalesce((select sum(ri.importe) from recibo_imputaciones ri where ri.factura_id = c.id), 0)
             - coalesce((select sum(nc.total) from comprobantes nc
                         where nc.referencia_id = c.id and nc.tipo::text like 'NC%' and nc.estado = 'emitido'), 0) as saldo
    from comprobantes c
    where c.cliente_id = p_cliente
      and c.estado = 'emitido'
      and c.condicion_pago = 'cta_cte'
      and c.tipo::text in ('FA','FB','FC','NDA','NDB','NDC')
  ) f
  where f.saldo > 0.01
  order by f.emitido_en;
$function$
;

CREATE OR REPLACE FUNCTION public.finalizar_conteo(p_conteo uuid, p_usuario uuid DEFAULT NULL::uuid, p_autorizado_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conteo conteos%rowtype;
  v_item record;
  v_diff numeric;
  v_ajustados integer := 0;
  v_unidades_ajustadas numeric := 0;
  v_total_items integer := 0;
begin
  select * into v_conteo from conteos where id = p_conteo for update;
  if not found then raise exception 'No existe el conteo'; end if;
  if v_conteo.estado <> 'abierto' then raise exception 'El conteo ya esta %', v_conteo.estado; end if;
  if p_autorizado_por is null then
    raise exception 'Aplicar un conteo requiere autorizacion de un supervisor';
  end if;

  for v_item in
    select producto_id, cantidad_contada, cantidad_sistema
    from conteos_items where conteo_id = p_conteo
  loop
    v_total_items := v_total_items + 1;
    v_diff := v_item.cantidad_contada - v_item.cantidad_sistema;
    if v_diff <> 0 then
      perform registrar_movimiento(
        v_item.producto_id, v_conteo.sucursal_id, 'ajuste', v_diff,
        'Inventario: conteo ' || left(p_conteo::text, 8) ||
        ' (sistema ' || v_item.cantidad_sistema || ' -> contado ' || v_item.cantidad_contada || ')',
        'conteo', p_conteo::text, p_usuario);
      v_ajustados := v_ajustados + 1;
      v_unidades_ajustadas := v_unidades_ajustadas + abs(v_diff);
    end if;
  end loop;

  update conteos set estado = 'aplicado' where id = p_conteo;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_autorizado_por, 'conteo_aplicado', 'conteo', p_conteo::text,
          jsonb_build_object('items_contados', v_total_items, 'ajustados', v_ajustados,
                             'unidades_ajustadas', v_unidades_ajustadas, 'operador', p_usuario));

  return jsonb_build_object('items_contados', v_total_items, 'ajustados', v_ajustados,
                            'unidades_ajustadas', v_unidades_ajustadas);
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_acreditacion_por_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pct numeric := 0; v_dias int := 0; v_com numeric;
begin
  if new.medio not in ('tarjeta', 'mercadopago') then return new; end if;
  select comision_pct, dias_acreditacion into v_pct, v_dias from comisiones_medios where medio = new.medio;
  v_com := round(new.monto * coalesce(v_pct, 0) / 100, 2);
  insert into acreditaciones (pago_id, venta_id, medio, bruto, comision_estimada, neto_estimado, fecha_estimada, mp_payment_id)
  values (new.id, new.venta_id, new.medio, new.monto, v_com, new.monto - v_com,
          (new.creado_en + (coalesce(v_dias, 0) || ' days')::interval)::date, new.mp_payment_id)
  on conflict (pago_id) do nothing;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_puntos_por_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_puntos int;
begin
  if new.cliente_id is null then return new; end if;

  if new.estado = 'completada' and coalesce(new.total, 0) > 0 then
    v_puntos := floor(new.total / 100)::int;
    if v_puntos > 0 then
      insert into puntos_movimientos (cliente_id, puntos, concepto, referencia)
      values (new.cliente_id, v_puntos, 'Compra', 'venta:' || new.id)
      on conflict (referencia) do nothing;
      if found then
        update clientes set puntos = puntos + v_puntos where id = new.cliente_id;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.estado = 'anulada' and coalesce(old.estado, '') <> 'anulada' then
    insert into puntos_movimientos (cliente_id, puntos, concepto, referencia)
    select new.cliente_id, -pm.puntos, 'Anulación', 'anul:' || new.id
    from puntos_movimientos pm where pm.referencia = 'venta:' || new.id
    on conflict (referencia) do nothing;
    if found then
      update clientes c set puntos = greatest(0, c.puntos - pm.puntos)
      from puntos_movimientos pm
      where pm.referencia = 'venta:' || new.id and c.id = new.cliente_id;
    end if;
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_referido_por_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if new.cliente_id is null then return new; end if;
  if new.estado = 'completada' and coalesce(new.total, 0) > 0 then
    select * into r from referidos
      where referido_id = new.cliente_id and estado = 'pendiente'
      for update skip locked;
    if found then
      update referidos set estado = 'acreditado', acreditado_en = now() where id = r.id;
      -- al que invitó
      insert into puntos_movimientos (cliente_id, puntos, concepto, referencia)
        values (r.referrer_id, r.puntos_referrer, 'Tu invitado compró 🎉', 'ref:' || r.id)
        on conflict (referencia) do nothing;
      if found then update clientes set puntos = puntos + r.puntos_referrer where id = r.referrer_id; end if;
      -- bienvenida al invitado
      insert into puntos_movimientos (cliente_id, puntos, concepto, referencia)
        values (new.cliente_id, r.puntos_referido, 'Bienvenida: te invitaron', 'refb:' || r.id)
        on conflict (referencia) do nothing;
      if found then update clientes set puntos = puntos + r.puntos_referido where id = new.cliente_id; end if;
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.fusionar_producto(p_surv uuid, p_abs uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into stock (producto_id, sucursal_id, cantidad, stock_minimo)
  select p_surv, s.sucursal_id, s.cantidad, s.stock_minimo
  from stock s where s.producto_id = p_abs
  on conflict (producto_id, sucursal_id)
  do update set cantidad = stock.cantidad + excluded.cantidad,
                stock_minimo = greatest(stock.stock_minimo, excluded.stock_minimo);
  select coalesce(sum(cantidad),0) into v_stock_mov from stock where producto_id = p_abs;
  delete from stock where producto_id = p_abs;

  update ventas_items         set producto_id = p_surv where producto_id = p_abs;
  update movimientos_stock     set producto_id = p_surv where producto_id = p_abs;
  update costos_historial      set producto_id = p_surv where producto_id = p_abs;
  update pedidos_items         set producto_id = p_surv where producto_id = p_abs;
  update ordenes_compra_items  set producto_id = p_surv where producto_id = p_abs;
  update remitos_items         set producto_id = p_surv where producto_id = p_abs;
  update lotes                 set producto_id = p_surv where producto_id = p_abs;
  update eventos_items         set producto_id = p_surv where producto_id = p_abs;
  update transferencias_items  set producto_id = p_surv where producto_id = p_abs;

  update proveedor_productos pp set producto_id = p_surv
  where pp.producto_id = p_abs
    and not exists (select 1 from proveedor_productos x where x.producto_id = p_surv and x.proveedor_id = pp.proveedor_id);
  delete from proveedor_productos where producto_id = p_abs;

  update codigos_barras cb set producto_id = p_surv
  where cb.producto_id = p_abs
    and not exists (select 1 from codigos_barras x where x.codigo = cb.codigo and x.producto_id <> p_abs);
  delete from codigos_barras where producto_id = p_abs;

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

  update productos set activo = false,
    descripcion = '[fusionado en ' || p_surv || '] ' || coalesce(descripcion, '')
  where id = p_abs;

  insert into auditoria (accion, entidad, entidad_id, datos_despues)
  values ('fusion_producto', 'producto', p_abs::text,
          jsonb_build_object('superviviente', p_surv, 'stock_movido', v_stock_mov, 'sku_abs', v_abs.sku, 'sku_surv', v_surv.sku));

  return jsonb_build_object('ok', true, 'surv', p_surv, 'abs', p_abs, 'stock_movido', v_stock_mov);
end $function$
;

CREATE OR REPLACE FUNCTION public.generar_precios_mayorista(p_factor numeric, p_solo_faltantes boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_may uuid; v_min uuid; v_n integer;
begin
  if p_factor <= 0 or p_factor >= 1 then
    raise exception 'El factor mayorista debe estar entre 0 y 1 (ej 0.78 = 22%% mas barato que minorista)';
  end if;
  select id into v_may from listas_precios where nombre = 'Mayorista';
  select id into v_min from listas_precios where nombre = 'Minorista';

  with min_actual as (
    select distinct on (producto_id) producto_id, precio
    from precios where lista_id = v_min order by producto_id, vigente_desde desc
  )
  insert into precios (lista_id, producto_id, precio, vigente_desde)
  select v_may, m.producto_id, round(m.precio * p_factor, 2), now()
  from min_actual m
  where m.precio > 0
    and (not p_solo_faltantes or not exists (
      select 1 from precios x where x.lista_id = v_may and x.producto_id = m.producto_id));
  get diagnostics v_n = row_count;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.liberar_estacionamiento(p_pedido uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update estacionamientos set ocupado = false, pedido_id = null, asignado_en = null where pedido_id = p_pedido;
$function$
;

CREATE OR REPLACE FUNCTION public.ofertas_tienda(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id
  from productos p
  join lateral (
    select pr.precio
    from precios pr
    join listas_precios lp on lp.id = pr.lista_id
    where pr.producto_id = p.id and lp.nombre ilike 'minorista'
    order by pr.vigente_desde desc nulls last
    limit 1
  ) ult on true
  where p.activo and ult.precio >= 100
  order by md5(p.id::text || to_char(now(), 'IYYY-IW'))
  limit greatest(coalesce(p_limit, 20), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$function$
;

CREATE OR REPLACE FUNCTION public.pagar_orden_pago(p_op uuid, p_cheques_propios jsonb DEFAULT NULL::jsonb, p_cheques_terceros uuid[] DEFAULT NULL::uuid[], p_usuario uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_op ordenes_pago%rowtype;
  v_ch record;
  v_id uuid;
  v_estado text;
  v_tipo text;
begin
  select * into v_op from ordenes_pago where id = p_op for update;
  if not found then raise exception 'No existe la orden de pago'; end if;
  if v_op.estado <> 'aprobada' then
    raise exception 'La OP tiene que estar APROBADA por el dueno antes de pagarse';
  end if;

  for v_ch in
    select c->>'numero' as numero, c->>'banco' as banco, c->>'titular' as titular,
           (c->>'importe')::numeric as importe, (c->>'fechaCobro')::date as fecha_cobro
    from jsonb_array_elements(coalesce(p_cheques_propios, '[]'::jsonb)) c
  loop
    if coalesce(v_ch.numero, '') = '' or coalesce(v_ch.importe, 0) <= 0 then
      raise exception 'Cada cheque propio necesita numero e importe';
    end if;
    insert into cheques (tipo, numero, banco, titular, importe, fecha_cobro,
                         es_diferido, estado, proveedor_id, orden_pago_id, usuario_id)
    values ('propio', v_ch.numero, v_ch.banco, v_ch.titular, v_ch.importe, v_ch.fecha_cobro,
            v_ch.fecha_cobro is not null, 'emitido', v_op.proveedor_id, p_op, p_usuario);
  end loop;

  if p_cheques_terceros is not null then
    foreach v_id in array p_cheques_terceros loop
      select estado, tipo into v_estado, v_tipo from cheques where id = v_id for update;
      if not found or v_tipo <> 'terceros' then
        raise exception 'Cheque de terceros invalido';
      end if;
      if v_estado <> 'cartera' then
        raise exception 'El cheque de terceros no esta en cartera';
      end if;
      update cheques set estado = 'aplicado', proveedor_id = v_op.proveedor_id, orden_pago_id = p_op
      where id = v_id;
    end loop;
  end if;

  update ordenes_pago set estado = 'pagada', pagada_en = now() where id = p_op;
  update facturas_proveedor set estado = 'pagada'
  where id in (select factura_id from ordenes_pago_items where orden_pago_id = p_op);
end $function$
;

CREATE OR REPLACE FUNCTION public.perfil_somelier(p_cliente uuid)
 RETURNS TABLE(compras integer, ticket_promedio numeric, vino_items integer, vino_precio_prom numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select id, total
    from ventas
    where cliente_id = p_cliente
      and coalesce(estado, '') not ilike 'anul%'
  ),
  vinos as (
    select vit.precio_unitario
    from ventas_items vit
    join v on v.id = vit.venta_id
    join productos p on p.id = vit.producto_id
    left join categorias c on c.id = p.categoria_id
    where (coalesce(c.nombre, '') ilike 'vino%'
        or coalesce(c.nombre, '') ilike 'espumante%'
        or coalesce(c.nombre, '') ilike 'champ%'
        or p.nombre ilike 'vino%'
        or p.nombre ilike 'espumante%')
      and vit.precio_unitario >= 500
  )
  select
    (select count(*)::int from v),
    (select round(avg(total)) from v),
    (select count(*)::int from vinos),
    (select round(avg(precio_unitario)) from vinos);
$function$
;

CREATE OR REPLACE FUNCTION public.pos_buscar(p_q text, p_limit integer DEFAULT 8)
 RETURNS TABLE(sku text, nombre text, precio numeric, precio_mayorista numeric, es_alcohol boolean, codigos text[], codigo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lm as (select id from listas_precios where nombre = 'Minorista' limit 1),
  lma as (select id from listas_precios where nombre = 'Mayorista' limit 1),
  cod as (select cb.producto_id from codigos_barras cb where cb.codigo = trim(p_q)),
  base as (
    select p.id, p.sku, p.nombre, p.es_alcohol, p.codigo_legacy
    from productos p
    where p.activo and (
      p.id in (select producto_id from cod)
      or p.codigo_legacy = trim(p_q)
      or p.nombre_normalizado ilike '%' || lower(trim(p_q)) || '%'
      or p.sku ilike trim(p_q) || '%'
    )
    order by (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q)) desc, p.nombre
    limit p_limit
  )
  select b.sku, b.nombre,
    (select pr.precio from precios pr, lm where pr.producto_id = b.id and pr.lista_id = lm.id order by pr.vigente_desde desc limit 1),
    (select pr.precio from precios pr, lma where pr.producto_id = b.id and pr.lista_id = lma.id order by pr.vigente_desde desc limit 1),
    b.es_alcohol,
    coalesce((select array_agg(cb.codigo) from codigos_barras cb where cb.producto_id = b.id), '{}'),
    b.codigo_legacy
  from base b;
$function$
;

CREATE OR REPLACE FUNCTION public.pos_catalogo()
 RETURNS TABLE(sku text, nombre text, precio numeric, precio_mayorista numeric, es_alcohol boolean, codigos text[], codigo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lm as (select id from listas_precios where nombre = 'Minorista' limit 1),
  lma as (select id from listas_precios where nombre = 'Mayorista' limit 1)
  select p.sku, p.nombre,
    (select pr.precio from precios pr, lm where pr.producto_id = p.id and pr.lista_id = lm.id order by pr.vigente_desde desc limit 1),
    (select pr.precio from precios pr, lma where pr.producto_id = p.id and pr.lista_id = lma.id order by pr.vigente_desde desc limit 1),
    p.es_alcohol,
    coalesce((select array_agg(cb.codigo) from codigos_barras cb where cb.producto_id = p.id), '{}'),
    p.codigo_legacy
  from productos p
  where p.activo and exists (select 1 from stock s where s.producto_id = p.id and s.cantidad > 0)
  order by p.nombre;
$function$
;

CREATE OR REPLACE FUNCTION public.precio_vigente(p_producto_id uuid, p_fecha timestamp with time zone DEFAULT now(), p_segmento tipo_cliente DEFAULT NULL::tipo_cliente, p_medio_pago text DEFAULT NULL::text, p_verificado boolean DEFAULT false, p_mayorista boolean DEFAULT false)
 RETURNS TABLE(precio_lista numeric, precio_final numeric, descuento_id uuid, descuento_nombre text, descuento_comunidad boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with pm as (
    select pr.precio from precios pr
      join listas_precios lp on lp.id = pr.lista_id and lp.nombre = 'Mayorista'
    where p_mayorista and pr.producto_id = p_producto_id and pr.vigente_desde <= p_fecha
    order by pr.vigente_desde desc limit 1
  ),
  pmin as (
    select pr.precio from precios pr
      join listas_precios lp on lp.id = pr.lista_id and lp.nombre = 'Minorista'
    where pr.producto_id = p_producto_id and pr.vigente_desde <= p_fecha
    order by pr.vigente_desde desc limit 1
  ),
  lista as (
    -- mayorista si existe, sino minorista; solo devuelve fila si hay algún precio
    select coalesce((select precio from pm), (select precio from pmin)) as precio
  ),
  prod as (select categoria_id, marca_id from productos where id = p_producto_id),
  aplicables as (
    select d.id, d.nombre, d.solo_comunidad,
      case d.tipo
        when 'porcentaje' then greatest(l.precio * (1 - d.valor / 100), 0)
        when 'monto_fijo' then greatest(l.precio - d.valor, 0)
        when 'precio_fijo' then d.valor
      end as precio_desc
    from descuentos d, lista l, prod p
    where l.precio is not null and d.activo
      and p_fecha between d.desde and d.hasta
      and (d.segmento is null or d.segmento = p_segmento)
      and (d.medio_pago is null or d.medio_pago = p_medio_pago)
      and (not d.solo_comunidad or p_verificado)
      and (
        d.alcance = 'global'
        or (d.alcance = 'categoria' and d.categoria_id = p.categoria_id)
        or (d.alcance = 'marca' and d.marca_id = p.marca_id)
        or (d.alcance = 'producto' and d.producto_id = p_producto_id)
      )
  )
  select l.precio,
         coalesce(a.precio_desc, l.precio),
         a.id, a.nombre, coalesce(a.solo_comunidad, false)
  from lista l
  left join lateral (select * from aplicables order by precio_desc asc limit 1) a on true
  where l.precio is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.proximo_numero(p_tipo tipo_comprobante, p_pv integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v bigint;
begin
  insert into numeradores (tipo, punto_venta, ultimo) values (p_tipo, p_pv, 1)
  on conflict (tipo, punto_venta) do update set ultimo = numeradores.ultimo + 1
  returning ultimo into v;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.quitar_tildes(texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  select lower(public.unaccent(texto))
$function$
;

CREATE OR REPLACE FUNCTION public.recibir_compra_directa(p_proveedor uuid, p_sucursal uuid, p_items jsonb, p_numero_remito text DEFAULT NULL::text, p_usuario uuid DEFAULT NULL::uuid, p_items_precio jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_oc uuid;
  v_remito uuid;
  v_item record;
  v_total numeric := 0;
  v_repreciados integer := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La entrada no tiene renglones';
  end if;

  -- OC retroactiva con origen 'directa': la mercaderia llego sin orden previa
  -- (caso diario). Nace ya recibida, atribuida a quien la registro.
  insert into ordenes_compra (proveedor_id, sucursal_id, estado, total, origen, creada_por, aprobada_por, aprobada_en)
  values (p_proveedor, p_sucursal, 'recibida', 0, 'directa', p_usuario, p_usuario, now())
  returning id into v_oc;

  insert into remitos (proveedor_id, oc_id, sucursal_id, numero, estado, confirmado_por)
  values (p_proveedor, v_oc, p_sucursal, p_numero_remito, 'confirmado', p_usuario)
  returning id into v_remito;

  for v_item in
    select (i->>'producto_id')::uuid producto_id,
           (i->>'cantidad')::numeric cantidad,
           coalesce((i->>'costo_unitario')::numeric, 0) costo,
           i->>'lote' lote,
           (i->>'vencimiento')::date vencimiento
    from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad <= 0 or v_item.costo < 0 then
      raise exception 'Renglon invalido (cantidad o costo)';
    end if;
    insert into ordenes_compra_items (oc_id, producto_id, cantidad, costo_unitario, cantidad_recibida)
    values (v_oc, v_item.producto_id, v_item.cantidad, v_item.costo, v_item.cantidad);
    v_total := v_total + v_item.cantidad * v_item.costo;

    perform registrar_movimiento(
      v_item.producto_id, p_sucursal, 'compra', v_item.cantidad,
      null, 'compra_directa', v_oc::text, p_usuario);

    -- vencimiento informado -> nace el lote (alimenta el panel de vencimientos)
    if v_item.vencimiento is not null then
      insert into lotes (producto_id, sucursal_id, lote, vencimiento, cantidad)
      values (v_item.producto_id, p_sucursal, coalesce(nullif(trim(v_item.lote), ''), 'S/L'), v_item.vencimiento, v_item.cantidad);
    end if;
  end loop;

  update ordenes_compra set total = v_total where id = v_oc;

  -- regla de oro: costo real -> precio de venta, en la misma transaccion
  if p_items_precio is not null and jsonb_array_length(p_items_precio) > 0 then
    select aplicar_lista_con_precio(p_proveedor, p_items_precio, p_usuario) into v_repreciados;
  end if;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'compra_directa', 'orden_compra', v_oc::text,
          jsonb_build_object('total', v_total, 'remito', p_numero_remito, 'renglones', jsonb_array_length(p_items)));

  return jsonb_build_object('oc_id', v_oc, 'remito_id', v_remito, 'total', v_total, 'repreciados', v_repreciados);
end $function$
;

CREATE OR REPLACE FUNCTION public.recibir_oc_con_precio(p_oc uuid, p_items jsonb, p_items_precio jsonb, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prov uuid;
  v_sucursal uuid;
  v_estado text;
  v_repreciados integer := 0;
  v_item record;
begin
  select proveedor_id, sucursal_id into v_prov, v_sucursal from ordenes_compra where id = p_oc;
  if v_prov is null then raise exception 'No existe la orden de compra'; end if;
  select recibir_orden_compra(p_oc, p_items, p_usuario) into v_estado;

  -- vencimientos informados al recibir -> lotes (vigilancia real de vencimientos)
  for v_item in
    select (i->>'producto_id')::uuid producto_id,
           (i->>'cantidad')::numeric cantidad,
           i->>'lote' lote,
           (i->>'vencimiento')::date vencimiento
    from jsonb_array_elements(p_items) i
    where (i->>'vencimiento') is not null
  loop
    insert into lotes (producto_id, sucursal_id, lote, vencimiento, cantidad)
    values (v_item.producto_id, v_sucursal, coalesce(nullif(trim(v_item.lote), ''), 'S/L'), v_item.vencimiento, v_item.cantidad);
  end loop;

  if p_items_precio is not null and jsonb_array_length(p_items_precio) > 0 then
    select aplicar_lista_con_precio(v_prov, p_items_precio, p_usuario) into v_repreciados;
  end if;
  return jsonb_build_object('estado', v_estado, 'repreciados', coalesce(v_repreciados, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.recibir_orden_compra(p_oc uuid, p_items jsonb, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_oc ordenes_compra%rowtype;
  v_item record;
  v_pendientes int;
  v_estado estado_oc;
begin
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado not in ('aprobada','enviada','recibida_parcial') then
    raise exception 'La OC está en estado %, no se puede recibir', v_oc.estado;
  end if;

  for v_item in
    select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad
    from jsonb_array_elements(p_items) i
  loop
    update ordenes_compra_items
    set cantidad_recibida = cantidad_recibida + v_item.cantidad
    where oc_id = p_oc and producto_id = v_item.producto_id
      and cantidad_recibida + v_item.cantidad <= cantidad;
    if not found then
      raise exception 'Renglón inválido o cantidad mayor a la pedida (producto %)', v_item.producto_id;
    end if;
    perform registrar_movimiento(
      v_item.producto_id, v_oc.sucursal_id, 'compra', v_item.cantidad,
      null, 'orden_compra', p_oc::text, p_usuario);
  end loop;

  select count(*) into v_pendientes
  from ordenes_compra_items where oc_id = p_oc and cantidad_recibida < cantidad;

  v_estado := case when v_pendientes = 0 then 'recibida'::estado_oc else 'recibida_parcial'::estado_oc end;
  update ordenes_compra set estado = v_estado where id = p_oc;
  return v_estado::text;
end $function$
;

CREATE OR REPLACE FUNCTION public.recibir_transferencia(p_transferencia uuid, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t transferencias%rowtype;
  v_item record;
begin
  select * into v_t from transferencias where id = p_transferencia for update;
  if not found then
    raise exception 'No existe la transferencia';
  end if;
  if v_t.estado <> 'en_transito' then
    raise exception 'La transferencia está en estado %, no se puede recibir', v_t.estado;
  end if;

  for v_item in select producto_id, cantidad from transferencias_items
                where transferencia_id = p_transferencia loop
    perform registrar_movimiento(
      v_item.producto_id, v_t.sucursal_destino_id, 'transferencia_entrada', v_item.cantidad,
      null, 'transferencia', p_transferencia::text, p_usuario_id);
  end loop;

  update transferencias set estado = 'recibida', recibida_por = p_usuario_id
  where id = p_transferencia;
end $function$
;

CREATE OR REPLACE FUNCTION public.registrar_movimiento(p_producto_id uuid, p_sucursal_id uuid, p_tipo tipo_movimiento, p_cantidad numeric, p_motivo text DEFAULT NULL::text, p_referencia_tipo text DEFAULT NULL::text, p_referencia_id text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nueva numeric;
  v_id bigint;
begin
  if p_cantidad = 0 then
    raise exception 'La cantidad no puede ser 0';
  end if;
  if p_tipo in ('ajuste','merma') and coalesce(trim(p_motivo),'') = '' then
    raise exception 'Los movimientos de tipo % requieren motivo', p_tipo;
  end if;
  if p_tipo in ('venta','merma','transferencia_salida','reserva') and p_cantidad > 0 then
    raise exception 'El tipo % debe tener cantidad negativa', p_tipo;
  end if;
  if p_tipo in ('compra','devolucion','transferencia_entrada','liberacion_reserva') and p_cantidad < 0 then
    raise exception 'El tipo % debe tener cantidad positiva', p_tipo;
  end if;

  insert into stock (producto_id, sucursal_id, cantidad)
  values (p_producto_id, p_sucursal_id, 0)
  on conflict (producto_id, sucursal_id) do nothing;

  update stock set cantidad = cantidad + p_cantidad
  where producto_id = p_producto_id and sucursal_id = p_sucursal_id
  returning cantidad into v_nueva;

  if v_nueva < 0 then
    raise exception 'Stock insuficiente: la operación dejaría % unidades', v_nueva;
  end if;

  insert into movimientos_stock (producto_id, sucursal_id, tipo, cantidad, motivo, referencia_tipo, referencia_id, usuario_id)
  values (p_producto_id, p_sucursal_id, p_tipo, p_cantidad, p_motivo, p_referencia_tipo, p_referencia_id, p_usuario_id)
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.registrar_venta(p_sucursal uuid, p_items jsonb, p_pagos jsonb, p_canal canal_venta DEFAULT 'mostrador'::canal_venta, p_cliente_dni text DEFAULT NULL::text, p_sesion_caja uuid DEFAULT NULL::uuid, p_usuario uuid DEFAULT NULL::uuid, p_venta_id uuid DEFAULT NULL::uuid, p_descuento_extra numeric DEFAULT 0, p_autorizado_por uuid DEFAULT NULL::uuid, p_mayorista boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := coalesce(p_venta_id, gen_random_uuid());
  v_cliente_id uuid; v_segmento tipo_cliente; v_verificado boolean := false;
  v_mayorista boolean := coalesce(p_mayorista, false);
  v_medio text; v_item record; v_pv record; v_pago record;
  v_subtotal numeric := 0; v_total numeric := 0; v_suma_pagos numeric := 0;
  v_tipo_cliente tipo_cliente; v_pto_venta int;
begin
  if exists (select 1 from ventas where id = v_id) then
    return jsonb_build_object('venta_id', v_id, 'duplicada', true);
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene renglones'; end if;

  if p_cliente_dni is not null and trim(p_cliente_dni) <> '' then
    select id, tipo, verificado, mayorista into v_cliente_id, v_segmento, v_verificado, v_mayorista
    from clientes where dni = trim(p_cliente_dni);
    if not found then
      insert into clientes (dni) values (trim(p_cliente_dni))
      returning id, tipo, verificado into v_cliente_id, v_segmento, v_verificado;
      v_mayorista := coalesce(p_mayorista, false);
    else
      -- el cliente mayorista fuerza mayorista; el cajero también puede forzarlo con p_mayorista
      v_mayorista := coalesce(v_mayorista, false) or coalesce(p_mayorista, false);
    end if;
  end if;

  select p->>'medio' into v_medio from jsonb_array_elements(p_pagos) p order by (p->>'monto')::numeric desc limit 1;

  insert into ventas (id, sucursal_id, sesion_caja_id, cliente_id, canal, subtotal, descuento, total)
  values (v_id, p_sucursal, p_sesion_caja, v_cliente_id, p_canal, 0, 0, 0);

  for v_item in select (i->>'producto_id')::uuid producto_id, (i->>'cantidad')::numeric cantidad from jsonb_array_elements(p_items) i
  loop
    if v_item.cantidad <= 0 then raise exception 'Cantidad invalida'; end if;
    select * into v_pv from precio_vigente(v_item.producto_id, now(), v_segmento, v_medio, v_verificado, v_mayorista);
    if v_pv.precio_lista is null then raise exception 'El producto % no tiene precio de lista', v_item.producto_id; end if;
    insert into ventas_items (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, promocion_id)
    select v_id, v_item.producto_id, v_item.cantidad, round(v_pv.precio_final, 2), p.costo, null from productos p where p.id = v_item.producto_id;
    v_subtotal := v_subtotal + round(v_item.cantidad * v_pv.precio_lista, 2);
    v_total := v_total + round(v_item.cantidad * v_pv.precio_final, 2);
    perform registrar_movimiento(v_item.producto_id, p_sucursal, 'venta', -v_item.cantidad, null, 'venta', v_id::text, p_usuario);
  end loop;

  if coalesce(p_descuento_extra, 0) > 0 then
    if p_autorizado_por is null then raise exception 'El descuento manual requiere autorizacion de un supervisor'; end if;
    if p_descuento_extra >= v_total then raise exception 'El descuento (%) no puede superar el total (%)', p_descuento_extra, v_total; end if;
    v_total := round(v_total - p_descuento_extra, 2);
  end if;

  for v_pago in select p->>'medio' medio, (p->>'monto')::numeric monto from jsonb_array_elements(p_pagos) p
  loop
    if v_pago.monto <= 0 then raise exception 'Monto de pago invalido'; end if;
    insert into pagos (venta_id, medio, monto) values (v_id, v_pago.medio, v_pago.monto);
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;
  if round(v_suma_pagos, 2) <> round(v_total, 2) then raise exception 'Los pagos (%) no coinciden con el total (%)', v_suma_pagos, v_total; end if;

  update ventas set subtotal = v_subtotal, descuento = v_subtotal - v_total, total = v_total where id = v_id;

  if coalesce(p_descuento_extra, 0) > 0 then
    insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
    values (p_autorizado_por, 'descuento_caja', 'venta', v_id::text,
            jsonb_build_object('descuento_extra', p_descuento_extra, 'cajero', p_usuario, 'total_final', v_total));
  end if;

  select coalesce(punto_venta_arca, 1) into v_pto_venta from sucursales where id = p_sucursal;
  insert into comprobantes_arca (venta_id, tipo, punto_venta, estado) values (v_id, 'FB', v_pto_venta, 'pendiente');

  if v_cliente_id is not null then v_tipo_cliente := clasificar_cliente(v_cliente_id); end if;

  return jsonb_build_object('venta_id', v_id, 'subtotal', v_subtotal, 'descuento', v_subtotal - v_total,
    'total', v_total, 'tipo_cliente', v_tipo_cliente, 'mayorista', v_mayorista);
end $function$
;

CREATE OR REPLACE FUNCTION public.saldo_cuenta(p_cliente uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(debe - haber), 0) from cuenta_corriente where cliente_id = p_cliente;
$function$
;

CREATE OR REPLACE FUNCTION public.siguiente_sku()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(max(sku::bigint), 0) + 1
  from productos
  where sku ~ '^[0-9]+$';
$function$
;

CREATE OR REPLACE FUNCTION public.stock_abc()
 RETURNS TABLE(sku text, producto text, facturado numeric, unidades numeric, acum_pct numeric, clase text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select vi.producto_id,
      sum(vi.cantidad * vi.precio_unitario)::numeric as fact,
      sum(vi.cantidad)::numeric as u
    from ventas_items vi
    join ventas ve on ve.id = vi.venta_id
    where ve.estado = 'completada' and ve.vendida_en >= now() - interval '30 days'
    group by vi.producto_id
  ),
  r as (
    select p.sku, p.nombre, v.fact, v.u,
      sum(v.fact) over (order by v.fact desc rows between unbounded preceding and current row) as acum,
      nullif(sum(v.fact) over (), 0) as total
    from v join productos p on p.id = v.producto_id
  )
  select sku, nombre, round(fact) , round(u,1),
    round(100 * acum / total, 1),
    case when 100*acum/total <= 80 then 'A' when 100*acum/total <= 95 then 'B' else 'C' end
  from r order by fact desc limit 500;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_consulta(p_q text, p_limit integer DEFAULT 10)
 RETURNS TABLE(sku text, nombre text, codigo text, sucursales jsonb, total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cod as (select cb.producto_id from codigos_barras cb where cb.codigo = trim(p_q)),
  base as (
    select p.id, p.sku, p.nombre, p.codigo_legacy,
      (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q)) as exacto
    from productos p
    where p.activo and (
      p.id in (select producto_id from cod)
      or p.codigo_legacy = trim(p_q)
      or p.nombre_normalizado ilike '%' || lower(trim(p_q)) || '%'
      or p.sku ilike trim(p_q) || '%'
    )
    order by (p.id in (select producto_id from cod) or p.codigo_legacy = trim(p_q)) desc, p.nombre
    limit p_limit
  )
  select b.sku, b.nombre, b.codigo_legacy,
    -- todas las sucursales activas, con su stock (0 si no hay fila)
    (select jsonb_agg(jsonb_build_object('sucursal', su.nombre, 'cantidad', coalesce(s.cantidad, 0)) order by su.nombre)
       from sucursales su
       left join stock s on s.producto_id = b.id and s.sucursal_id = su.id
       where su.activa) as sucursales,
    coalesce((select sum(s.cantidad) from stock s where s.producto_id = b.id), 0) as total
  from base b;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_negativo()
 RETURNS TABLE(sku text, producto text, sucursal text, cantidad numeric, costo numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.sku, p.nombre, su.nombre, st.cantidad, coalesce(p.costo,0)
  from stock st
  join productos p on p.id = st.producto_id
  join sucursales su on su.id = st.sucursal_id
  where st.cantidad < 0
  order by st.cantidad asc;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_por_rubro()
 RETURNS TABLE(rubro text, skus integer, unidades numeric, valor numeric, negativos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(c.nombre, 'Sin rubro'),
    count(distinct st.producto_id)::int,
    coalesce(sum(st.cantidad) filter (where st.cantidad > 0), 0),
    coalesce(sum(st.cantidad * coalesce(p.costo,0)) filter (where st.cantidad > 0), 0),
    count(*) filter (where st.cantidad < 0)::int
  from stock st
  join productos p on p.id = st.producto_id and p.activo
  left join categorias c on c.id = p.categoria_id
  group by c.nombre
  order by 4 desc;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_por_sucursal()
 RETURNS TABLE(sucursal text, skus integer, unidades numeric, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select su.nombre,
    count(distinct st.producto_id)::int,
    coalesce(sum(st.cantidad) filter (where st.cantidad > 0), 0),
    coalesce(sum(st.cantidad * coalesce(p.costo,0)) filter (where st.cantidad > 0), 0)
  from stock st
  join productos p on p.id = st.producto_id and p.activo
  join sucursales su on su.id = st.sucursal_id
  group by su.nombre order by 4 desc;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_resumen()
 RETURNS TABLE(skus_activos integer, con_stock integer, sin_stock integer, negativos integer, unidades numeric, valor_inventario numeric, bajo_reposicion integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (
    select st.cantidad, st.punto_reposicion, coalesce(p.costo,0) as costo, st.producto_id
    from stock st join productos p on p.id = st.producto_id and p.activo
  )
  select
    (select count(distinct producto_id) from s)::int,
    count(*) filter (where cantidad > 0)::int,
    count(*) filter (where cantidad = 0)::int,
    count(*) filter (where cantidad < 0)::int,
    coalesce(sum(cantidad) filter (where cantidad > 0), 0),
    coalesce(sum(cantidad * costo) filter (where cantidad > 0), 0),
    count(*) filter (where punto_reposicion > 0 and cantidad <= punto_reposicion)::int
  from s;
$function$
;

CREATE OR REPLACE FUNCTION public.stock_sin_rotacion(p_dias integer DEFAULT 30)
 RETURNS TABLE(sku text, producto text, unidades numeric, capital numeric, ultima_venta timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with constock as (
    select st.producto_id, sum(st.cantidad) as u
    from stock st group by st.producto_id having sum(st.cantidad) > 0
  ),
  vendidos as (
    select distinct vi.producto_id
    from ventas_items vi join ventas ve on ve.id = vi.venta_id
    where ve.estado='completada' and ve.vendida_en >= now() - (p_dias || ' days')::interval
  )
  select p.sku, p.nombre, cs.u, round(cs.u * coalesce(p.costo,0)),
    (select max(ve.vendida_en) from ventas_items vi join ventas ve on ve.id=vi.venta_id where vi.producto_id=p.id and ve.estado='completada')
  from constock cs
  join productos p on p.id = cs.producto_id and p.activo
  where cs.producto_id not in (select producto_id from vendidos)
  order by cs.u * coalesce(p.costo,0) desc
  limit 100;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_cheque()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.actualizado_en = now(); return new; end; $function$
;

CREATE OR REPLACE FUNCTION public.verificar_login(p_email text, p_clave text)
 RETURNS TABLE(id uuid, nombre text, rol rol_usuario, sucursal_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select u.id, u.nombre, u.rol, u.sucursal_id
  from usuarios u
  where u.email = lower(trim(p_email))
    and u.activo
    and case
      when u.clave_hash like '$2%' then u.clave_hash = crypt(p_clave, u.clave_hash)
      else u.clave_hash = encode(digest(p_clave, 'sha256'), 'hex')
    end;
$function$
;

CREATE OR REPLACE FUNCTION public.verificar_pin_supervisor(p_pin text)
 RETURNS TABLE(id uuid, nombre text, rol rol_usuario)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_u record;
  v_ok boolean;
begin
  if coalesce(trim(p_pin), '') = '' then return; end if;
  for v_u in
    select u.id, u.nombre, u.rol, u.pin_firma
    from usuarios u
    where u.activo and u.rol in ('gerente','dueno') and u.pin_firma is not null
  loop
    if length(v_u.pin_firma) = 60 then
      v_ok := v_u.pin_firma = crypt(p_pin, v_u.pin_firma);
    else
      v_ok := v_u.pin_firma = encode(digest(p_pin, 'sha256'), 'hex');
    end if;
    if v_ok then
      id := v_u.id; nombre := v_u.nombre; rol := v_u.rol;
      return next;
      return;
    end if;
  end loop;
end $function$
;

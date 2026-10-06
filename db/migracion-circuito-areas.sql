-- EL CIRCUITO ENTRE ÁREAS (Leandro, 6/10/2026): "llega un pedido, a quién le
-- avisa, cómo lo recepciona, en dónde lo hace, en dónde nos quedan los datos de
-- quién hizo cada cosa".
--
-- Lo que había: el aviso por WhatsApp a administración salía (3/10), pero nadie
-- "tomaba" el pedido (el de las picadas del 3/10 siguió en «recibido» para
-- siempre), y del pedido solo quedaba quién lo empezó a preparar y quién lo
-- entregó. Quién lo canceló, lo marcó listo, lo despachó o le asignó repartidor
-- no quedaba en ningún lado.
--
-- Lo que agrega:
-- 1. pedidos.tomado_por / tomado_en: quién lo recibió ("Lo tomo" en el panel,
--    en la ventana emergente o desde el link del WhatsApp). Preparar sin haberlo
--    tomado lo toma.
-- 2. pedidos_historial: cada paso del pedido con quién y cuándo, lo escriba quien
--    lo escriba (trigger). El autor viaja en pedidos.cambio_por + cambio_en: el
--    trigger lo usa solo si cambio_en cambió en esa misma escritura; un cambio que
--    no lo trae (el webhook de Mercado Pago) queda "del sistema", nunca a nombre
--    del anterior.
-- 3. Reclamo del pedido sin tomar: a los 15 minutos de horario de atención (8 a
--    21 h), UN WhatsApp a administración (avisos_pedidos tipo pedido_sin_tomar) y
--    una alerta a los dueños. Se cierran solos al tomarlo.
-- 4. alertas_internas.leida_por: quién tocó "Listo".
-- 5. La clave pública (anon) ya no puede ejecutar las funciones que mueven plata
--    o stock (entregar/cancelar pedidos, aprobar cobranzas, sumar saldo…). La API
--    usa la clave de servicio: no cambia nada para el sistema.

-- 1 y 2 ----------------------------------------------------------------------
alter table public.pedidos
  add column if not exists tomado_por uuid references public.usuarios(id),
  add column if not exists tomado_en timestamptz,
  add column if not exists creado_por uuid references public.usuarios(id),
  -- por dónde entró: bot | web | app | panel | pedidosya | tiendanube
  add column if not exists origen text,
  -- el contacto que deja quien compra sin cuenta (web/app): para avisarle y llamarlo
  add column if not exists contacto_nombre text,
  add column if not exists contacto_telefono text,
  add column if not exists cambio_por uuid references public.usuarios(id),
  add column if not exists cambio_en timestamptz;

create index if not exists pedidos_sin_tomar_idx on public.pedidos (creado_en) where tomado_por is null and estado in ('recibido', 'pagado');

create table if not exists public.pedidos_historial (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  -- alta | tomado | estado | repartidor | pago
  evento text not null,
  estado_antes text,
  estado_despues text,
  usuario_id uuid references public.usuarios(id),
  detalle jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists pedidos_historial_pedido_idx on public.pedidos_historial (pedido_id, creado_en);
create index if not exists pedidos_historial_fecha_idx on public.pedidos_historial (creado_en desc);
alter table public.pedidos_historial enable row level security;
revoke all on public.pedidos_historial from anon, authenticated;
grant all on public.pedidos_historial to service_role;

create or replace function public.registrar_historial_pedido()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_autor uuid;
begin
  begin
    if tg_op = 'INSERT' then
      insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
      values (new.id, 'alta', new.estado::text, coalesce(new.creado_por, new.cambio_por),
              jsonb_build_object('canal', new.canal, 'codigo', new.qr_retiro, 'total', new.total, 'origen', new.origen));
      return new;
    end if;

    -- el autor es el de ESTA escritura (cambio_en se movió); si no, es del sistema
    v_autor := case when new.cambio_en is distinct from old.cambio_en then new.cambio_por end;

    -- el panel graba el creador después del alta (crear_pedido no lo recibe)
    if new.creado_por is not null and old.creado_por is null then
      update pedidos_historial set usuario_id = new.creado_por
       where pedido_id = new.id and evento = 'alta' and usuario_id is null;
    end if;
    if new.origen is not null and old.origen is null then
      update pedidos_historial set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('origen', new.origen)
       where pedido_id = new.id and evento = 'alta';
    end if;

    if new.tomado_por is not null and new.tomado_por is distinct from old.tomado_por then
      insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id)
      values (new.id, 'tomado', new.estado::text, new.tomado_por);
    end if;

    if new.estado is distinct from old.estado then
      insert into pedidos_historial(pedido_id, evento, estado_antes, estado_despues, usuario_id, detalle)
      values (new.id, 'estado', old.estado::text, new.estado::text,
              coalesce(v_autor,
                       case when new.estado = 'en_preparacion' then new.preparado_por
                            when new.estado = 'entregado' then new.entregado_por end),
              case when new.estado = 'entregado' then jsonb_build_object('venta_id', new.venta_id) end);
    end if;

    if new.repartidor_id is distinct from old.repartidor_id then
      insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
      values (new.id, 'repartidor', new.estado::text, v_autor,
              jsonb_build_object('repartidor_id', new.repartidor_id,
                                 'repartidor', (select nombre from usuarios where id = new.repartidor_id)));
    end if;

    if new.pagado_en is not null and old.pagado_en is null then
      insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
      values (new.id, 'pago', new.estado::text, v_autor, jsonb_build_object('medio', 'mercadopago'));
    end if;
  exception when others then
    -- el pedido no se traba nunca por el historial
    raise warning 'historial del pedido % no registrado: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;
revoke all on function public.registrar_historial_pedido() from public, anon, authenticated;

drop trigger if exists pedidos_historial_alta on public.pedidos;
create trigger pedidos_historial_alta after insert on public.pedidos
  for each row execute function public.registrar_historial_pedido();
drop trigger if exists pedidos_historial_cambios on public.pedidos;
create trigger pedidos_historial_cambios after update on public.pedidos
  for each row execute function public.registrar_historial_pedido();

-- "Lo tomo": el primero que lo toma queda; el segundo ve quién lo tiene.
create or replace function public.tomar_pedido(p_pedido uuid, p_usuario uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v pedidos%rowtype;
begin
  if p_usuario is null then raise exception 'Falta quién toma el pedido'; end if;
  update pedidos
     set tomado_por = p_usuario, tomado_en = now(), cambio_por = p_usuario, cambio_en = now()
   where id = p_pedido and tomado_por is null and estado not in ('cancelado', 'entregado')
  returning * into v;
  if found then
    -- el reclamo se cierra solo: la alerta de los dueños y el WhatsApp si todavía no salió
    update alertas_internas set leida_en = now(), leida_por = p_usuario
     where tipo = 'pedido_sin_tomar' and referencia->>'pedido_id' = p_pedido::text and leida_en is null;
    update avisos_pedidos set estado = 'omitido', motivo = 'el pedido se tomó antes del reclamo'
     where pedido_id = p_pedido and tipo = 'pedido_sin_tomar' and estado = 'pendiente'
       and (tomado_hasta is null or tomado_hasta < now());
    return jsonb_build_object('tomado', true, 'tomado_por', p_usuario, 'tomado_en', v.tomado_en,
                              'nombre', (select nombre from usuarios where id = p_usuario));
  end if;
  select * into v from pedidos where id = p_pedido;
  if not found then raise exception 'No existe el pedido'; end if;
  return jsonb_build_object('tomado', false, 'tomado_por', v.tomado_por, 'tomado_en', v.tomado_en, 'estado', v.estado,
                            'nombre', (select nombre from usuarios where id = v.tomado_por));
end;
$function$;
revoke all on function public.tomar_pedido(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tomar_pedido(uuid, uuid) to service_role;

-- entregar y cancelar dejan su autor en el historial
create or replace function public.cancelar_pedido(p_pedido uuid, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido pedidos%rowtype;
  v_item record;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;

  -- idempotente: cancelar dos veces no duplica la liberación
  if v_pedido.estado = 'cancelado' then
    return jsonb_build_object('pedido_id', p_pedido, 'estado', 'cancelado', 'duplicada', true);
  end if;
  if v_pedido.estado not in ('recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino') then
    raise exception 'Transicion invalida: % -> cancelado', v_pedido.estado;
  end if;

  if v_pedido.reserva_stock then
    for v_item in select producto_id, cantidad from pedidos_items where pedido_id = p_pedido loop
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_item.cantidad,
        null, 'pedido', p_pedido::text, p_usuario);
    end loop;
  end if;
  perform liberar_estacionamiento(p_pedido);

  update pedidos set estado = 'cancelado', cambio_por = p_usuario, cambio_en = now() where id = p_pedido;
  -- el reclamo de un pedido cancelado ya no corre
  update alertas_internas set leida_en = now(), leida_por = p_usuario
   where tipo = 'pedido_sin_tomar' and referencia->>'pedido_id' = p_pedido::text and leida_en is null;
  return jsonb_build_object('pedido_id', p_pedido, 'estado', 'cancelado');
end $function$;

create or replace function public.entregar_pedido(p_pedido uuid, p_usuario uuid DEFAULT NULL::uuid, p_medio text DEFAULT NULL::text)
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
  -- cuenta corriente no pasa por acá: exige validar límite y generar la deuda,
  -- y eso vive en el circuito de ventas, no en la entrega de un pedido
  if v_medio not in ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'pedidosya') then
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
    select producto_id, cantidad, precio_unitario from pedidos_items where pedido_id = p_pedido
  loop
    if v_pedido.reserva_stock then
      perform registrar_movimiento(
        v_item.producto_id, v_pedido.sucursal_id, 'liberacion_reserva', v_item.cantidad,
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

-- 3 --------------------------------------------------------------------------
-- 15 minutos de horario de atención (8 a 21 h de Buenos Aires): un pedido de la
-- madrugada o de la noche se reclama a las 8:15 del día siguiente.
create or replace function public.reclamo_sin_tomar_vence(p_creado timestamptz)
 returns timestamptz language sql stable set search_path to 'public'
as $function$
  select case
    when (p_creado at time zone 'America/Argentina/Buenos_Aires')::time < time '08:00'
      then (date_trunc('day', p_creado at time zone 'America/Argentina/Buenos_Aires') + time '08:15') at time zone 'America/Argentina/Buenos_Aires'
    when (p_creado at time zone 'America/Argentina/Buenos_Aires')::time >= time '20:45'
      then (date_trunc('day', p_creado at time zone 'America/Argentina/Buenos_Aires') + interval '1 day' + time '08:15') at time zone 'America/Argentina/Buenos_Aires'
    else p_creado + interval '15 minutes'
  end;
$function$;

-- Encola el reclamo (UNO por pedido) y la alerta de los dueños. Lo llama el API
-- en cada vuelta de avisos. Solo para pedidos cuyo alta ya se avisó: si el alta
-- no salió, ya lo está escalando el vigía.
create or replace function public.encolar_reclamos_sin_tomar()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  with nuevos as (
    insert into avisos_pedidos(pedido_id, tipo)
    select p.id, 'pedido_sin_tomar' from pedidos p
     where p.estado in ('recibido', 'pagado')
       and p.tomado_por is null
       and p.creado_en > now() - interval '48 hours'
       and reclamo_sin_tomar_vence(p.creado_en) <= now()
       and alta_avisada(p.id)
       and not exists (select 1 from avisos_pedidos a where a.pedido_id = p.id and a.tipo = 'pedido_sin_tomar')
    on conflict (pedido_id, tipo) where pedido_id is not null do nothing
    returning pedido_id
  ), alertas as (
    insert into alertas_internas(tipo, titulo, detalle, referencia)
    select 'pedido_sin_tomar',
           'Pedido sin tomar: ' || coalesce(p.qr_retiro, upper(left(p.id::text, 8))),
           'Entró el ' || to_char(p.creado_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI')
             || ' y nadie lo tomó todavía. Total $' || replace(to_char(round(p.total), 'FM999,999,999'), ',', '.') || '.',
           jsonb_build_object('pedido_id', p.id, 'link', '/pedidos?pedido=' || p.id)
      from nuevos join pedidos p on p.id = nuevos.pedido_id
    returning 1
  )
  select count(*) into n from nuevos;
  return n;
end;
$function$;
revoke all on function public.encolar_reclamos_sin_tomar() from public, anon, authenticated;
grant execute on function public.encolar_reclamos_sin_tomar() to service_role;

-- 4 --------------------------------------------------------------------------
alter table public.alertas_internas add column if not exists leida_por uuid references public.usuarios(id);

-- Datos de los pedidos que ya existían: por dónde entraron y un historial
-- reconstruido con lo que había (marcado como reconstruido).
update public.pedidos p set origen = case
    when exists (select 1 from bot_cotizaciones c where c.pedido_id = p.id) then 'bot'
    when p.qr_retiro like 'PY-%' then 'pedidosya'
    when p.qr_retiro like 'TN-%' then 'tiendanube'
    when p.qr_retiro like 'WA-%' or p.canal = 'whatsapp' then 'panel'
    else 'web' end
 where p.origen is null;

insert into public.pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle, creado_en)
select p.id, 'alta', 'recibido', null,
       jsonb_build_object('canal', p.canal, 'codigo', p.qr_retiro, 'total', p.total, 'origen', p.origen, 'reconstruido', true), p.creado_en
  from public.pedidos p
 where not exists (select 1 from public.pedidos_historial h where h.pedido_id = p.id);
insert into public.pedidos_historial(pedido_id, evento, estado_antes, estado_despues, usuario_id, detalle, creado_en)
select p.id, 'estado', null, 'en_preparacion', p.preparado_por, '{"reconstruido": true}'::jsonb, p.preparacion_en
  from public.pedidos p
 where p.preparacion_en is not null
   and not exists (select 1 from public.pedidos_historial h where h.pedido_id = p.id and h.evento = 'estado');
insert into public.pedidos_historial(pedido_id, evento, estado_antes, estado_despues, usuario_id, detalle, creado_en)
select p.id, 'estado', null, 'listo', null, '{"reconstruido": true}'::jsonb, p.listo_en
  from public.pedidos p
 where p.listo_en is not null
   and not exists (select 1 from public.pedidos_historial h where h.pedido_id = p.id and h.estado_despues = 'listo');
insert into public.pedidos_historial(pedido_id, evento, estado_antes, estado_despues, usuario_id, detalle, creado_en)
select p.id, 'estado', null, 'en_camino', null, '{"reconstruido": true}'::jsonb, p.en_camino_en
  from public.pedidos p
 where p.en_camino_en is not null
   and not exists (select 1 from public.pedidos_historial h where h.pedido_id = p.id and h.estado_despues = 'en_camino');
insert into public.pedidos_historial(pedido_id, evento, estado_antes, estado_despues, usuario_id, detalle, creado_en)
select p.id, 'estado', null, 'entregado', p.entregado_por, '{"reconstruido": true}'::jsonb, p.entregado_en
  from public.pedidos p
 where p.entregado_en is not null
   and not exists (select 1 from public.pedidos_historial h where h.pedido_id = p.id and h.estado_despues = 'entregado');

-- 5 --------------------------------------------------------------------------
-- Funciones SECURITY DEFINER que la clave pública podía ejecutar (6/10/2026):
-- con ellas cualquiera con esa clave podía entregar o cancelar un pedido,
-- aprobar una cobranza o sumar saldo a una cuenta corriente sin pasar por la
-- API. La API usa la clave de servicio.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
       and p.proname in ('aprobar_cobranza', 'aprobar_propuesta_costo', 'avisar_credito_consumido', 'cancelar_pedido',
                         'catalogo_proveedor', 'emitir_documento', 'entregar_pedido', 'fn_blindaje_arca_cola',
                         'fraccionar_producto', 'oc_pedir_proveedor_completo', 'perfil_compra', 'pos_buscar', 'pos_catalogo',
                         'proveedor_completado', 'recalcular_tipo_cliente', 'registrar_pago_factura', 'sumar_saldo_cta_cte',
                         'trg_perfil_tras_venta', 'venta_diaria', 'verificar_login')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;

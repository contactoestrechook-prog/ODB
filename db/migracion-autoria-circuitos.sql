-- ============================================================================
-- Autoría de los circuitos (6/10/2026)
--
-- Que cada paso diga quién lo hizo y cuándo, y que nada quede colgado:
--
--   1) Rechazos de OC y de OP con su propio autor. Hasta hoy el rechazo se
--      guardaba en aprobada_por / aprobada_en: la trazabilidad mostraba la
--      orden rechazada como APROBADA y el PDF de la OP decía "Autorizada por"
--      el que la había rechazado. Columnas nuevas rechazada_por / rechazada_en,
--      corrección de los rechazos viejos y dos funciones atómicas
--      (rechazar_oc_panel, rechazar_op_panel) que validan el estado y dejan la
--      fila en auditoria.
--   2) Transferencias entre sucursales: fecha de recepción (recibida_en). El
--      autor (creada_por / recibida_por) ya lo reciben crear_transferencia y
--      recibir_transferencia por p_usuario_id; la API no lo mandaba.
--   3) Recepción con pistola CONTRA una orden enviada (recibir_oc_pistola):
--      cierra la orden original en vez de crear otra "directa" y deja el
--      remito para la conciliación con la factura.
--   4) sesiones_caja.cerrada_por: la columna ya existe; la escribe la API
--      después del cierre (no hace falta tocar cerrar_sesion_caja).
--
-- APLICAR ANTES DE SUBIR LA API: la API nueva lee y escribe estas columnas y
-- llama a estas funciones. Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

-- ---------- 0) chequeos previos ----------
-- La API manda el usuario a estas funciones. Si en la base viva cambiaron de
-- firma, mejor que la migración frene acá y no que las transferencias o las
-- recepciones fallen en el mostrador.
do $$
begin
  if to_regprocedure('public.crear_transferencia(uuid, uuid, jsonb, uuid)') is null then
    raise exception 'crear_transferencia no recibe p_usuario_id en esta base: revisar antes de subir la API';
  end if;
  if to_regprocedure('public.recibir_transferencia(uuid, uuid)') is null then
    raise exception 'recibir_transferencia no recibe p_usuario_id en esta base: revisar antes de subir la API';
  end if;
  if to_regprocedure('public.recibir_orden_compra(uuid, jsonb, uuid)') is null then
    raise exception 'recibir_orden_compra cambió de firma en esta base: revisar antes de aplicar recibir_oc_pistola';
  end if;
end $$;

-- ---------- 1) rechazos con autor propio ----------
alter table public.ordenes_compra
  add column if not exists rechazada_por uuid references public.usuarios(id),
  add column if not exists rechazada_en timestamptz;

alter table public.ordenes_pago
  add column if not exists rechazada_por uuid references public.usuarios(id),
  add column if not exists rechazada_en timestamptz;

-- Los rechazos viejos: lo que hay en aprobada_por / aprobada_en es en realidad
-- quién rechazó y cuándo. Se mueve a las columnas nuevas y la aprobación queda
-- con la firma REAL si la hubo (tabla aprobaciones), o vacía si no.
-- (en un UPDATE todas las expresiones ven la fila de antes: el swap es seguro)
update public.ordenes_compra oc
   set rechazada_por = oc.aprobada_por,
       rechazada_en  = oc.aprobada_en,
       aprobada_por  = (select a.usuario_id from public.aprobaciones a
                         where a.entidad = 'orden_compra' and a.entidad_id = oc.id
                         order by a.creado_en desc limit 1),
       aprobada_en   = (select a.creado_en from public.aprobaciones a
                         where a.entidad = 'orden_compra' and a.entidad_id = oc.id
                         order by a.creado_en desc limit 1)
 where oc.estado = 'cancelada'
   and oc.rechazo_motivo is not null
   and oc.rechazada_en is null
   and oc.aprobada_en is not null;

update public.ordenes_pago op
   set rechazada_por = op.aprobada_por,
       rechazada_en  = op.aprobada_en,
       aprobada_por  = (select a.usuario_id from public.aprobaciones a
                         where a.entidad = 'orden_pago' and a.entidad_id = op.id
                         order by a.creado_en desc limit 1),
       aprobada_en   = (select a.creado_en from public.aprobaciones a
                         where a.entidad = 'orden_pago' and a.entidad_id = op.id
                         order by a.creado_en desc limit 1)
 where op.estado = 'rechazada'
   and op.rechazada_en is null
   and op.aprobada_en is not null;

-- Rechazo de OC desde el panel o la bandeja: estado + autor + auditoría, juntos.
create or replace function public.rechazar_oc_panel(p_oc uuid, p_usuario uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_oc ordenes_compra%rowtype;
  v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'Rechazada por dirección');
begin
  if p_usuario is null then raise exception 'No pude identificar quién rechaza'; end if;
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado not in ('pendiente_aprobacion', 'borrador') then
    raise exception 'No se puede rechazar una orden "%"', v_oc.estado;
  end if;

  update ordenes_compra
     set estado = 'cancelada', rechazo_motivo = v_motivo,
         rechazada_por = p_usuario, rechazada_en = now()
   where id = p_oc;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
  values (p_usuario, 'orden_compra_rechazada', 'orden_compra', p_oc::text,
          jsonb_build_object('estado', v_oc.estado::text, 'numero', v_oc.numero, 'total', v_oc.total),
          jsonb_build_object('estado', 'cancelada', 'motivo', v_motivo));
end $function$;

-- Rechazo de OP: solo una orden pendiente de aprobación (antes se podía
-- "rechazar" cualquiera, incluso una aprobada). Las facturas vuelven a su
-- estado real: 'parcial' si ya tenían pagos, si no 'pendiente'.
create or replace function public.rechazar_op_panel(p_op uuid, p_usuario uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_op ordenes_pago%rowtype;
  v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'Rechazada por dirección');
  v_facturas integer := 0;
begin
  if p_usuario is null then raise exception 'No pude identificar quién rechaza'; end if;
  select * into v_op from ordenes_pago where id = p_op for update;
  if not found then raise exception 'No existe la orden de pago'; end if;
  if v_op.estado <> 'pendiente_aprobacion' then
    raise exception 'La OP #% está "%": solo se rechaza una orden pendiente de aprobación', v_op.numero, v_op.estado;
  end if;

  update ordenes_pago
     set estado = 'rechazada', rechazo_motivo = v_motivo,
         rechazada_por = p_usuario, rechazada_en = now()
   where id = p_op;

  update facturas_proveedor f
     set estado = case when coalesce(f.monto_pagado, 0) > 0 then 'parcial' else 'pendiente' end
   where f.id in (select i.factura_id from ordenes_pago_items i where i.orden_pago_id = p_op)
     and f.estado = 'en_pago';
  get diagnostics v_facturas = row_count;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
  values (p_usuario, 'orden_pago_rechazada', 'orden_pago', p_op::text,
          jsonb_build_object('estado', v_op.estado, 'numero', v_op.numero, 'total', v_op.total),
          jsonb_build_object('estado', 'rechazada', 'motivo', v_motivo, 'facturas_liberadas', v_facturas));

  return jsonb_build_object('numero', v_op.numero, 'facturas', v_facturas);
end $function$;

-- ---------- 2) transferencias: fecha de recepción ----------
alter table public.transferencias
  add column if not exists recibida_en timestamptz;

-- La fecha la pone la base al pasar a 'recibida', venga de donde venga (no
-- hace falta reescribir recibir_transferencia).
create or replace function public.transferencias_sellar_recepcion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado = 'recibida' and old.estado is distinct from 'recibida' and new.recibida_en is null then
    new.recibida_en := now();
  end if;
  return new;
end $$;

drop trigger if exists transferencias_sellar_recepcion on public.transferencias;
create trigger transferencias_sellar_recepcion before update of estado on public.transferencias
  for each row execute function public.transferencias_sellar_recepcion();

-- Las ya recibidas: la fecha sale del movimiento de entrada que dejó la recepción.
update public.transferencias t
   set recibida_en = (select min(m.creado_en) from public.movimientos_stock m
                       where m.referencia_tipo = 'transferencia'
                         and m.referencia_id = t.id::text
                         and m.tipo = 'transferencia_entrada')
 where t.estado = 'recibida'
   and t.recibida_en is null;

-- ---------- 3) recepción con pistola contra una orden ----------
-- Antes la pistola SIEMPRE creaba otra OC "directa" y la orden enviada al
-- proveedor quedaba 'enviada' para siempre: contaba como "en camino" para el
-- Analista y el plazo real del proveedor nunca se aprendía.
--
-- Cada renglón tiene que estar en la orden y entrar en lo que falta. Lo que no,
-- se nombra y no entra nada: el depósito lo saca y lo recibe aparte sin orden.
-- El stock entra a la sucursal de la orden (recibir_orden_compra) y nace el
-- remito para que administración lo cruce con la factura.
create or replace function public.recibir_oc_pistola(
  p_oc uuid,
  p_proveedor uuid,
  p_items jsonb,                -- [{producto_id, cantidad}]
  p_numero_remito text default null,
  p_usuario uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_oc ordenes_compra%rowtype;
  v_item record;
  v_falta numeric;
  v_nombre text;
  v_en_orden boolean;
  v_problemas text[] := '{}';
  v_estado text;
  v_remito uuid;
  v_numero text := nullif(trim(coalesce(p_numero_remito, '')), '');
begin
  if p_usuario is null then raise exception 'No pude identificar quién recibe'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La recepción no tiene renglones';
  end if;

  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if p_proveedor is null or v_oc.proveedor_id <> p_proveedor then
    raise exception 'La orden #% es de otro proveedor', v_oc.numero;
  end if;
  if v_oc.estado not in ('aprobada', 'enviada', 'recibida_parcial') then
    raise exception 'La orden #% está "%": no se puede recibir contra ella', v_oc.numero, v_oc.estado;
  end if;

  for v_item in
    select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad
    from jsonb_array_elements(p_items) i
    group by 1
  loop
    select p.nombre, oci.producto_id is not null, oci.cantidad - oci.cantidad_recibida
      into v_nombre, v_en_orden, v_falta
    from productos p
    left join ordenes_compra_items oci on oci.oc_id = p_oc and oci.producto_id = p.id
    where p.id = v_item.producto_id;

    if v_nombre is null then
      v_problemas := v_problemas || format('un producto que no existe (%s)', v_item.producto_id);
    elsif v_item.cantidad is null or v_item.cantidad <= 0 then
      v_problemas := v_problemas || format('%s: la cantidad tiene que ser mayor a cero', v_nombre);
    elsif not v_en_orden then
      v_problemas := v_problemas || format('%s no está en la orden', v_nombre);
    elsif v_item.cantidad > greatest(v_falta, 0) then
      v_problemas := v_problemas || format('%s: llegaron %s y faltaban %s', v_nombre,
                                           trim_scale(v_item.cantidad), trim_scale(greatest(v_falta, 0)));
    end if;
  end loop;

  if cardinality(v_problemas) > 0 then
    raise exception 'No coincide con la orden #%: %. Sacá esos renglones y recibilos aparte sin orden, o recibí todo sin orden.',
      v_oc.numero, array_to_string(v_problemas, ' · ');
  end if;

  -- stock + cantidades recibidas + estado de la orden (recibida / recibida_parcial)
  v_estado := recibir_orden_compra(p_oc, p_items, p_usuario);

  -- Si la recepción de la orden ya dejó su remito en esta misma transacción
  -- (now() es la hora de la transacción), se usa ese y no se duplica.
  select r.id into v_remito from remitos r
   where r.oc_id = p_oc and r.creado_en = now()
   order by r.id limit 1;
  if v_remito is null then
    insert into remitos (proveedor_id, oc_id, sucursal_id, numero, estado, confirmado_por)
    values (v_oc.proveedor_id, p_oc, v_oc.sucursal_id, v_numero, 'pendiente_conciliar', p_usuario)
    returning id into v_remito;
  else
    update remitos
       set numero = coalesce(v_numero, numero),
           estado = 'pendiente_conciliar',
           confirmado_por = coalesce(confirmado_por, p_usuario)
     where id = v_remito;
  end if;

  -- lo que bajó de ESTE camión (la orden acumula todas las entregas)
  insert into remitos_items (remito_id, producto_id, cantidad)
  select v_remito, x.producto_id, x.cantidad
  from (
    select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad
    from jsonb_array_elements(p_items) i
    group by 1
  ) x
  on conflict (remito_id, producto_id) do update set cantidad = excluded.cantidad;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'recepcion_contra_orden', 'orden_compra', p_oc::text,
          jsonb_build_object('numero', v_oc.numero, 'estado', v_estado, 'remito', v_numero,
                             'remito_id', v_remito, 'renglones', jsonb_array_length(p_items)));

  return jsonb_build_object('oc_id', p_oc, 'numero', v_oc.numero, 'estado', v_estado, 'remito_id', v_remito);
end $function$;

-- ---------- 4) caja: quién cerró ----------
-- La columna ya existe en producción; esto es solo por si se corre en una base nueva.
alter table public.sesiones_caja
  add column if not exists cerrada_por uuid references public.usuarios(id);

-- ---------- permisos: solo la API (service_role) ----------
revoke all on function public.rechazar_oc_panel(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rechazar_op_panel(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.recibir_oc_pistola(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.transferencias_sellar_recepcion() from public, anon, authenticated;
grant execute on function public.rechazar_oc_panel(uuid, uuid, text) to service_role;
grant execute on function public.rechazar_op_panel(uuid, uuid, text) to service_role;
grant execute on function public.recibir_oc_pistola(uuid, uuid, jsonb, text, uuid) to service_role;

-- que la API vea ya las columnas y relaciones nuevas (rechazador, etc.)
notify pgrst, 'reload schema';

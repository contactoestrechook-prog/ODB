-- ============================================================================
-- TRASPASOS ENTRE LOCALES (Leandro, 10/11/2026: «tenemos que hacer un módulo
-- para traspaso de mercadería entre los locales, bien completo, que no le falte
-- nada»). Decisiones suyas: pedido + envío; las diferencias las decide
-- gerencia; remito interno (sin ARCA) valorizado al costo; lo usan cajeros,
-- repartidor y administración (además de depósito, gerencia y dueños).
--
-- Se apoya en `transferencias` (existía y nunca se usó: 0 filas) y en
-- registrar_movimiento, el único camino del stock.
--
--   pedido ──enviar──▶ en_transito ──recibir──▶ recibida
--     │                    │                └─▶ con_diferencias ──resolver──▶ recibida
--     └──anular            └──anular (vuelve al origen)
--
-- Las funciones son de la API (service_role): anon y authenticated no las ven.
-- ============================================================================

create sequence if not exists transferencias_numero_seq;

alter table public.transferencias
  add column if not exists numero integer default nextval('transferencias_numero_seq'),
  add column if not exists pedida_por uuid references public.usuarios(id),
  add column if not exists pedida_en timestamptz,
  add column if not exists enviada_por uuid references public.usuarios(id),
  add column if not exists enviada_en timestamptz,
  add column if not exists lleva_id uuid references public.usuarios(id),
  add column if not exists entregada_en timestamptz,
  add column if not exists nota text,
  add column if not exists nota_recepcion text,
  add column if not exists anulada_por uuid references public.usuarios(id),
  add column if not exists anulada_en timestamptz,
  add column if not exists motivo_anulacion text,
  add column if not exists cerrada_en timestamptz;

alter table public.transferencias drop constraint if exists transferencias_estado_check;
alter table public.transferencias add constraint transferencias_estado_check
  check (estado in ('pedido', 'en_transito', 'con_diferencias', 'recibida', 'anulada'));

alter table public.transferencias_items
  add column if not exists cantidad_pedida numeric,
  add column if not exists cantidad_recibida numeric,
  add column if not exists costo_unitario numeric,
  add column if not exists nota text,
  add column if not exists resolucion text,
  add column if not exists resuelta_por uuid references public.usuarios(id),
  add column if not exists resuelta_en timestamptz;
-- «cantidad» es lo ENVIADO (lo que salió del origen)
alter table public.transferencias_items alter column cantidad set default 0;
alter table public.transferencias_items drop constraint if exists transferencias_items_resolucion_check;
alter table public.transferencias_items add constraint transferencias_items_resolucion_check
  check (resolucion is null or resolucion in ('vuelve_origen', 'merma', 'descontar_origen', 'queda'));

create index if not exists transferencias_estado_idx on public.transferencias (estado, creado_en desc);

-- ---- pedir: el local que necesita le pide al otro -------------------------
create or replace function public.traspaso_pedir(p_origen uuid, p_destino uuid, p_items jsonb, p_usuario uuid, p_nota text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_item record;
begin
  if p_origen = p_destino then raise exception 'Se pide a OTRO local'; end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then raise exception 'El pedido no tiene productos'; end if;
  insert into transferencias (sucursal_origen_id, sucursal_destino_id, estado, creada_por, pedida_por, pedida_en, nota)
  values (p_origen, p_destino, 'pedido', p_usuario, p_usuario, now(), nullif(trim(coalesce(p_nota, '')), ''))
  returning id into v_id;
  for v_item in select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad
                from jsonb_array_elements(p_items) i group by 1 loop
    if v_item.cantidad <= 0 then raise exception 'Las cantidades tienen que ser mayores a cero'; end if;
    insert into transferencias_items (transferencia_id, producto_id, cantidad_pedida, cantidad)
    values (v_id, v_item.producto_id, v_item.cantidad, 0);
  end loop;
  return v_id;
end $$;

-- ---- enviar: sale del stock del origen y queda en camino -------------------
-- p_id null = envío sin pedido. Con pedido, lo enviado puede ser menos (no
-- había), más o productos que no se pidieron.
create or replace function public.traspaso_enviar(p_id uuid, p_origen uuid, p_destino uuid, p_items jsonb, p_usuario uuid, p_lleva uuid default null, p_nota text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_t transferencias%rowtype; v_id uuid; v_item record; v_enviados int := 0;
begin
  if p_id is null then
    if p_origen = p_destino then raise exception 'Se manda a OTRO local'; end if;
    insert into transferencias (sucursal_origen_id, sucursal_destino_id, estado, creada_por, nota)
    values (p_origen, p_destino, 'en_transito', p_usuario, nullif(trim(coalesce(p_nota, '')), ''))
    returning * into v_t;
  else
    select * into v_t from transferencias where id = p_id for update;
    if not found then raise exception 'No existe ese traspaso'; end if;
    if v_t.estado <> 'pedido' then raise exception 'Ese traspaso ya salió (está %)', v_t.estado; end if;
    update transferencias set nota = coalesce(nullif(trim(coalesce(p_nota, '')), ''), nota) where id = p_id;
  end if;
  v_id := v_t.id;
  for v_item in select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad
                from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i group by 1 loop
    if v_item.cantidad < 0 then raise exception 'Las cantidades no pueden ser negativas'; end if;
    insert into transferencias_items (transferencia_id, producto_id, cantidad, costo_unitario)
    values (v_id, v_item.producto_id, v_item.cantidad, (select costo from productos where id = v_item.producto_id))
    on conflict (transferencia_id, producto_id) do update
      set cantidad = excluded.cantidad, costo_unitario = excluded.costo_unitario;
    if v_item.cantidad > 0 then
      perform registrar_movimiento(v_item.producto_id, v_t.sucursal_origen_id, 'transferencia_salida', -v_item.cantidad,
        'Traspaso #' || v_t.numero, 'transferencia', v_id::text, p_usuario);
      v_enviados := v_enviados + 1;
    end if;
  end loop;
  if v_enviados = 0 then raise exception 'No se manda nada: todas las cantidades están en cero'; end if;
  update transferencias set estado = 'en_transito', enviada_por = p_usuario, enviada_en = now(), lleva_id = p_lleva where id = v_id;
  return v_id;
end $$;

-- ---- entregado: el que lo lleva avisa que lo dejó --------------------------
create or replace function public.traspaso_entregar(p_id uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update transferencias set entregada_en = now() where id = p_id and estado = 'en_transito' and entregada_en is null;
  if not found then raise exception 'Ese traspaso no está en camino'; end if;
end $$;

-- ---- recibir: entra al stock lo que llegó ---------------------------------
-- p_items null = llegó todo lo enviado. Si no, una línea por producto contado
-- (lo que no se nombra, no llegó). Un producto que vino y no figuraba entra igual.
create or replace function public.traspaso_recibir(p_id uuid, p_items jsonb, p_usuario uuid, p_nota text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_t transferencias%rowtype; v_item record; v_dif boolean := false;
begin
  select * into v_t from transferencias where id = p_id for update;
  if not found then raise exception 'No existe ese traspaso'; end if;
  if v_t.estado <> 'en_transito' then raise exception 'Ese traspaso está %: no se puede recibir', v_t.estado; end if;
  if p_items is null then
    update transferencias_items set cantidad_recibida = cantidad where transferencia_id = p_id;
  else
    update transferencias_items set cantidad_recibida = 0 where transferencia_id = p_id;
    for v_item in select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad, max(i->>'nota') nota
                  from jsonb_array_elements(p_items) i group by 1 loop
      if v_item.cantidad < 0 then raise exception 'Las cantidades no pueden ser negativas'; end if;
      insert into transferencias_items (transferencia_id, producto_id, cantidad, cantidad_recibida, costo_unitario, nota)
      values (p_id, v_item.producto_id, 0, v_item.cantidad, (select costo from productos where id = v_item.producto_id), nullif(trim(coalesce(v_item.nota, '')), ''))
      on conflict (transferencia_id, producto_id) do update
        set cantidad_recibida = excluded.cantidad_recibida, nota = coalesce(excluded.nota, transferencias_items.nota);
    end loop;
  end if;
  for v_item in select producto_id, cantidad, cantidad_recibida from transferencias_items where transferencia_id = p_id loop
    if coalesce(v_item.cantidad_recibida, 0) > 0 then
      perform registrar_movimiento(v_item.producto_id, v_t.sucursal_destino_id, 'transferencia_entrada', v_item.cantidad_recibida,
        'Traspaso #' || v_t.numero, 'transferencia', p_id::text, p_usuario);
    end if;
    if coalesce(v_item.cantidad_recibida, 0) <> coalesce(v_item.cantidad, 0) then v_dif := true; end if;
  end loop;
  update transferencias set estado = case when v_dif then 'con_diferencias' else 'recibida' end,
    recibida_por = p_usuario, recibida_en = now(), nota_recepcion = nullif(trim(coalesce(p_nota, '')), ''),
    cerrada_en = case when v_dif then null else now() end
  where id = p_id;
  return case when v_dif then 'con_diferencias' else 'recibida' end;
end $$;

-- ---- resolver una diferencia (gerencia / dueño) ----------------------------
--   faltó:  vuelve_origen (no salió de verdad: vuelve al stock del origen) | merma (se perdió)
--   sobró:  descontar_origen (salió de más: se resta del origen) | queda (se acepta como está)
create or replace function public.traspaso_resolver(p_id uuid, p_producto uuid, p_resolucion text, p_usuario uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_t transferencias%rowtype; v_i transferencias_items%rowtype; v_dif numeric; v_pend int;
begin
  select * into v_t from transferencias where id = p_id for update;
  if not found then raise exception 'No existe ese traspaso'; end if;
  if v_t.estado <> 'con_diferencias' then raise exception 'Ese traspaso no tiene diferencias para resolver'; end if;
  select * into v_i from transferencias_items where transferencia_id = p_id and producto_id = p_producto for update;
  if not found then raise exception 'Ese producto no está en el traspaso'; end if;
  if v_i.resolucion is not null then raise exception 'Esa diferencia ya se resolvió'; end if;
  v_dif := coalesce(v_i.cantidad_recibida, 0) - coalesce(v_i.cantidad, 0);
  if v_dif = 0 then raise exception 'Ese producto no tiene diferencia'; end if;
  if v_dif < 0 and p_resolucion not in ('vuelve_origen', 'merma') then raise exception 'Si faltó, vuelve al origen o es merma'; end if;
  if v_dif > 0 and p_resolucion not in ('descontar_origen', 'queda') then raise exception 'Si sobró, se descuenta del origen o queda'; end if;
  if p_resolucion = 'vuelve_origen' then
    perform registrar_movimiento(p_producto, v_t.sucursal_origen_id, 'transferencia_entrada', -v_dif,
      'Traspaso #' || v_t.numero || ': no llegó, vuelve al origen', 'transferencia', p_id::text, p_usuario);
  elsif p_resolucion = 'descontar_origen' then
    perform registrar_movimiento(p_producto, v_t.sucursal_origen_id, 'ajuste', -v_dif,
      'Traspaso #' || v_t.numero || ': salió de más', 'transferencia', p_id::text, p_usuario);
  end if;
  update transferencias_items set resolucion = p_resolucion, resuelta_por = p_usuario, resuelta_en = now()
  where transferencia_id = p_id and producto_id = p_producto;
  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'traspaso_diferencia', 'transferencia', p_id::text,
          jsonb_build_object('producto_id', p_producto, 'diferencia', v_dif, 'resolucion', p_resolucion, 'costo', v_i.costo_unitario));
  select count(*) into v_pend from transferencias_items
  where transferencia_id = p_id and coalesce(cantidad_recibida, 0) <> coalesce(cantidad, 0) and resolucion is null;
  if v_pend = 0 then update transferencias set estado = 'recibida', cerrada_en = now() where id = p_id; return 'recibida'; end if;
  return 'con_diferencias';
end $$;

-- ---- anular: un pedido que no se va a mandar, o un envío que no salió -----
create or replace function public.traspaso_anular(p_id uuid, p_usuario uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_t transferencias%rowtype; v_item record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Falta el motivo'; end if;
  select * into v_t from transferencias where id = p_id for update;
  if not found then raise exception 'No existe ese traspaso'; end if;
  if v_t.estado not in ('pedido', 'en_transito') then raise exception 'Ese traspaso está %: no se puede anular', v_t.estado; end if;
  if v_t.estado = 'en_transito' then
    for v_item in select producto_id, cantidad from transferencias_items where transferencia_id = p_id and cantidad > 0 loop
      perform registrar_movimiento(v_item.producto_id, v_t.sucursal_origen_id, 'transferencia_entrada', v_item.cantidad,
        'Traspaso #' || v_t.numero || ' anulado: ' || p_motivo, 'transferencia_anulada', p_id::text, p_usuario);
    end loop;
  end if;
  update transferencias set estado = 'anulada', anulada_por = p_usuario, anulada_en = now(), motivo_anulacion = p_motivo where id = p_id;
  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
  values (p_usuario, 'anular_traspaso', 'transferencia', p_id::text, jsonb_build_object('motivo', p_motivo, 'estaba', v_t.estado));
end $$;

revoke all on function public.traspaso_pedir(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.traspaso_enviar(uuid, uuid, uuid, jsonb, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.traspaso_entregar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.traspaso_recibir(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.traspaso_resolver(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.traspaso_anular(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.traspaso_pedir(uuid, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.traspaso_enviar(uuid, uuid, uuid, jsonb, uuid, uuid, text) to service_role;
grant execute on function public.traspaso_entregar(uuid, uuid) to service_role;
grant execute on function public.traspaso_recibir(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.traspaso_resolver(uuid, uuid, text, uuid) to service_role;
grant execute on function public.traspaso_anular(uuid, uuid, text) to service_role;

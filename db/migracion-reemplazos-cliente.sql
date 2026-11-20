-- ============================================================
-- ODB — «Tengo parecido» y la consulta al cliente (20/11/2026)
--
-- Leandro y Jaqui: «cuando está armando el pedido, si un producto no está, que
-- quien arma tenga para poner "tengo parecido" y elija una opción. Una vez
-- terminado, que diga "consultar al cliente cambios". Al cliente le manda un
-- mensaje: "Manteca La Serenísima por 200 no hay, reemplazamos por Manteca La
-- Serenísima por 100. Responder sí o no". Y así con cada producto. Una vez
-- finalizado, que le devuelva al empleado la notificación con los cambios
-- confirmados».
--
-- Cada cambio propuesto es una fila de pedidos_reemplazos. El pedido NO se toca
-- hasta que el cliente contesta (o quien arma anota lo que le dijo por teléfono):
--   propuesto   lo cargó quien arma («Tengo parecido»), todavía sin consultar
--   en_cola     se tocó «Consultar al cliente»: sale de a uno, en orden
--   preguntado  el WhatsApp salió y se espera el sí o el no
--   aceptado    dijo que sí: se aplicó con resolver_falta_armado (sale lo que
--               falta, entra el parecido con su precio)
--   rechazado   dijo que no: sale lo que falta (queda lo que había)
--   anulado     quien arma se arrepintió antes de consultar
-- Una «tanda» es lo consultado y todavía no cerrado (consultado_en con
-- cerrado_en vacío): al contestar la última, al cliente le llega cómo queda el
-- pedido y a quien arma, un WhatsApp con lo que se confirmó.
-- ============================================================

create table if not exists public.pedidos_reemplazos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  -- lo que falta
  producto_id uuid not null references public.productos(id),
  nombre_falta text not null,
  pide numeric not null,
  hay numeric not null default 0,
  precio_falta numeric,
  -- lo que se ofrece en su lugar
  reemplazo_id uuid not null references public.productos(id),
  nombre_reemplazo text not null,
  cantidad numeric not null check (cantidad > 0),
  precio numeric,
  estado text not null default 'propuesto'
    check (estado in ('propuesto', 'en_cola', 'preguntado', 'aceptado', 'rechazado', 'anulado')),
  orden int,
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  -- la consulta por WhatsApp
  consultado_por uuid references public.usuarios(id),
  consultado_en timestamptz,
  chat text,          -- a dónde se manda: «549…» o «<id>@lid»
  chat_clave text,    -- la clave de la charla en bot_conversaciones (solo dígitos)
  telefono text,      -- últimos 10 dígitos del teléfono del cliente (para reconocer la respuesta)
  linea text,
  sesion text,
  preguntado_en timestamptz,
  waha_id text,
  intentos int not null default 0,
  proximo_intento timestamptz,
  ultimo_error text,
  -- lo que escribió el cliente que no era ni sí ni no (lo ve quien arma)
  otra_respuesta text,
  otra_respuesta_en timestamptz,
  -- la respuesta
  respondido_en timestamptz,
  respuesta text,
  decidido_por uuid references public.usuarios(id),  -- null: lo contestó el cliente por WhatsApp
  resultado jsonb,
  error text,
  cerrado_en timestamptz
);

-- un solo cambio abierto por producto y pedido
create unique index if not exists pedidos_reemplazos_abierto
  on public.pedidos_reemplazos (pedido_id, producto_id) where estado in ('propuesto', 'en_cola', 'preguntado');
create index if not exists pedidos_reemplazos_pedido on public.pedidos_reemplazos (pedido_id);
create index if not exists pedidos_reemplazos_esperando on public.pedidos_reemplazos (estado, linea) where estado in ('en_cola', 'preguntado');

alter table public.pedidos_reemplazos enable row level security;
revoke all on public.pedidos_reemplazos from anon, authenticated;

-- El precio de un producto PARA ESTE PEDIDO: el mismo criterio que
-- resolver_falta_armado (segmento del cliente, Mercado Pago o PedidosYa).
create or replace function public.precios_en_pedido(p_pedido uuid, p_productos uuid[])
 returns table(producto_id uuid, precio numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_segmento tipo_cliente; v_verificado boolean := false; v_medio text;
begin
  select * into v_pedido from pedidos where id = p_pedido;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.cliente_id is not null then
    select tipo, verificado into v_segmento, v_verificado from clientes where id = v_pedido.cliente_id;
  end if;
  v_medio := case when v_pedido.qr_retiro like 'PY-%' then 'pedidosya'
                  when v_pedido.pagado_en is not null then 'mercadopago' end;
  return query
    select x.id, (select pv.precio_final from precio_vigente(x.id, now(), v_segmento, v_medio, coalesce(v_verificado, false), false) pv)
      from unnest(p_productos) as x(id);
end;
$function$;

-- «Tengo parecido»: queda propuesto, el pedido no cambia todavía.
create or replace function public.proponer_reemplazo(
  p_pedido uuid, p_producto uuid, p_hay numeric, p_reemplazo uuid, p_cantidad numeric default null, p_usuario uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_pedido pedidos%rowtype;
  v_nombre text; v_pide numeric; v_precio_viejo numeric;
  v_nuevo productos%rowtype; v_cant numeric; v_precio numeric; v_id uuid;
begin
  select * into v_pedido from pedidos where id = p_pedido for update;
  if not found then raise exception 'No existe el pedido'; end if;
  if v_pedido.estado in ('entregado', 'cancelado') or v_pedido.venta_id is not null then
    raise exception 'El pedido ya está %: no se le pueden cambiar los productos', v_pedido.estado;
  end if;
  select pr.nombre, i.cantidad, i.precio_unitario into v_nombre, v_pide, v_precio_viejo
    from pedidos_items i join productos pr on pr.id = i.producto_id
   where i.pedido_id = p_pedido and i.producto_id = p_producto;
  if not found then raise exception 'Ese producto ya no está en el pedido: actualizá la pantalla'; end if;
  if coalesce(p_hay, 0) < 0 then raise exception 'Lo que hay no puede ser menos de 0'; end if;
  if coalesce(p_hay, 0) >= v_pide then raise exception 'Si hay % o más, no falta nada de %', trim_scale(v_pide), v_nombre; end if;
  if p_reemplazo is null or p_reemplazo = p_producto then raise exception 'Elegí otro producto para ofrecerle'; end if;
  select * into v_nuevo from productos where id = p_reemplazo;
  if not found or v_nuevo.activo is false then raise exception 'Ese producto no existe o está dado de baja'; end if;
  v_cant := coalesce(p_cantidad, v_pide - coalesce(p_hay, 0));
  if v_cant <= 0 then raise exception 'La cantidad tiene que ser mayor que 0'; end if;
  select pe.precio into v_precio from precios_en_pedido(p_pedido, array[p_reemplazo]) pe;
  if v_precio is null then raise exception '% no tiene precio cargado: elegí otro', v_nuevo.nombre; end if;
  if v_precio_viejo is null then
    select pe.precio into v_precio_viejo from precios_en_pedido(p_pedido, array[p_producto]) pe;
  end if;
  if exists (select 1 from pedidos_reemplazos where pedido_id = p_pedido and producto_id = p_producto and estado = 'preguntado') then
    raise exception 'Ya le preguntamos al cliente por %: esperá la respuesta', v_nombre;
  end if;
  -- si ya había otro propuesto para lo mismo, lo reemplaza
  update pedidos_reemplazos set estado = 'anulado'
   where pedido_id = p_pedido and producto_id = p_producto and estado in ('propuesto', 'en_cola');
  insert into pedidos_reemplazos (pedido_id, producto_id, nombre_falta, pide, hay, precio_falta,
    reemplazo_id, nombre_reemplazo, cantidad, precio, creado_por)
  values (p_pedido, p_producto, v_nombre, v_pide, coalesce(p_hay, 0), v_precio_viejo,
    p_reemplazo, v_nuevo.nombre, v_cant, round(v_precio, 2), p_usuario)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'falta', v_nombre, 'reemplazo', v_nuevo.nombre, 'cantidad', v_cant, 'precio', round(v_precio, 2));
end;
$function$;

-- La respuesta (del cliente por WhatsApp, o la que anota quien arma): aplica el
-- cambio al pedido. Si no se puede aplicar (el pedido cambió, se quedaría sin
-- productos), la respuesta queda igual y el error se le muestra a quien arma.
create or replace function public.decidir_reemplazo(p_id uuid, p_acepta boolean, p_respuesta text default null, p_usuario uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  r pedidos_reemplazos%rowtype;
  v_resultado jsonb; v_error text;
begin
  select * into r from pedidos_reemplazos where id = p_id for update;
  if not found then raise exception 'No existe ese cambio'; end if;
  if r.estado not in ('propuesto', 'en_cola', 'preguntado') then
    return jsonb_build_object('estado', r.estado, 'yaEstaba', true);
  end if;
  begin
    v_resultado := resolver_falta_armado(r.pedido_id, r.producto_id, r.hay,
      case when p_acepta then r.reemplazo_id end, case when p_acepta then r.cantidad end, coalesce(p_usuario, r.consultado_por, r.creado_por));
  exception when others then
    v_error := sqlerrm;
  end;
  update pedidos_reemplazos set
    estado = case when p_acepta then 'aceptado' else 'rechazado' end,
    respondido_en = now(), respuesta = left(p_respuesta, 500), decidido_por = p_usuario,
    resultado = v_resultado, error = v_error
  where id = p_id;
  insert into pedidos_historial(pedido_id, evento, estado_despues, usuario_id, detalle)
  select r.pedido_id, 'reemplazo', p.estado::text, p_usuario, jsonb_build_object(
      'acepta', p_acepta, 'falta', r.nombre_falta, 'reemplazo', r.nombre_reemplazo, 'cantidad', r.cantidad,
      'por_whatsapp', p_usuario is null, 'respuesta', left(p_respuesta, 200), 'error', v_error)
    from pedidos p where p.id = r.pedido_id;
  return jsonb_build_object('estado', case when p_acepta then 'aceptado' else 'rechazado' end, 'resultado', v_resultado, 'error', v_error);
end;
$function$;

revoke all on function public.precios_en_pedido(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.proponer_reemplazo(uuid, uuid, numeric, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.decidir_reemplazo(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.precios_en_pedido(uuid, uuid[]) to service_role;
grant execute on function public.proponer_reemplazo(uuid, uuid, numeric, uuid, numeric, uuid) to service_role;
grant execute on function public.decidir_reemplazo(uuid, boolean, text, uuid) to service_role;

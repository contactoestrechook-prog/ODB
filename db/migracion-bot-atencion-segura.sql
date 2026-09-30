-- Aplicar antes del backend nuevo. Aditiva: no cambia catálogo ni cierra consultas históricas.
begin;
create table if not exists public.bot_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  linea text not null check (linea in ('pedidos','proveedores')),
  telefono text not null,
  cliente_id uuid references public.clientes(id),
  sucursal_id uuid not null references public.sucursales(id),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  total numeric(16,2) not null check (total > 0),
  tipo text not null check (tipo in ('pickup','domicilio')),
  direccion text,
  nombre text,
  notas text,
  entrega_fecha date,
  entrega_franja text,
  resumen text not null,
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null default now() + interval '30 minutes',
  pedido_id uuid references public.pedidos(id),
  confirmacion text,
  confirmada_en timestamptz
);
create index if not exists bot_cotizaciones_chat on public.bot_cotizaciones(linea, telefono, creada_en desc);
alter table public.bot_cotizaciones enable row level security;
revoke all on public.bot_cotizaciones from anon, authenticated;
grant all on public.bot_cotizaciones to service_role;
alter table public.bot_conversaciones add column if not exists importes_verificados jsonb not null default '[]';

create or replace function public.catalogo_precios_bot(p_ids uuid[], p_cliente_id uuid default null)
returns table(producto_id uuid, precio_lista numeric, precio_final numeric, descuento_nombre text, descuento_comunidad boolean)
language sql stable security definer set search_path = public as $$
 select p.id, pv.precio_lista, pv.precio_final, pv.descuento_nombre, pv.descuento_comunidad
 from unnest(p_ids) u(id) join productos p on p.id=u.id
 left join clientes c on c.id=p_cliente_id
 cross join lateral precio_vigente(p.id, now(), c.tipo, null, coalesce(c.verificado,false), coalesce(c.mayorista,false)) pv;
$$;
revoke all on function public.catalogo_precios_bot(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.catalogo_precios_bot(uuid[],uuid) to service_role;

-- Una transacción: dueño, aceptación, precio, presentación, stock y reserva.
-- La fila de cotización bloqueada hace idempotentes los reintentos concurrentes.
create or replace function public.confirmar_cotizacion_bot(p_id uuid, p_telefono text, p_linea text, p_confirmacion text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
 q bot_cotizaciones%rowtype; item jsonb; prod productos%rowtype;
 actual numeric; importe numeric := 0; cantidad numeric; pedido uuid; cliente uuid;
begin
 select * into q from bot_cotizaciones where id=p_id and telefono=p_telefono and linea=p_linea for update;
 if not found then raise exception 'Cotizacion no encontrada para este chat'; end if;
 if p_confirmacion is null or p_confirmacion !~* '^\s*(sí|si|dale|ok|listo|confirmo|confirmalo|confirmame|de acuerdo|hacelo|armalo|cerralo|perfecto)(\M|[,.!])'
    or p_confirmacion ~* '\m(no|par[aá]|espera|todav[ií]a|despu[eé]s|pero|cambia\w*|agrega\w*|saca\w*|quita\w*|mejor|otra?\w*|cancel\w*)\M'
 then raise exception 'Falta confirmacion inequivoca'; end if;
 if q.pedido_id is not null then return q.pedido_id; end if;
 if q.vence_en < now() then raise exception 'La cotizacion vencio: volver a cotizar'; end if;
 if q.tipo='domicilio' and (coalesce(trim(q.nombre),'')='' or coalesce(q.direccion,'') !~ '[0-9]') then raise exception 'Faltan datos de entrega'; end if;
 if not exists(select 1 from sucursales where id=q.sucursal_id and activa and pickup) then raise exception 'Sucursal de preparacion no disponible'; end if;
 if q.entrega_fecha is not null and q.entrega_fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'La fecha de entrega ya paso'; end if;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
   select * into prod from productos where id=(item->>'producto_id')::uuid for share;
   if not found or not prod.activo or prod.sku is distinct from item->>'sku' then raise exception 'Producto no disponible'; end if;
   cantidad := (item->>'cantidad')::numeric;
   if cantidad is null or cantidad <= 0 or cantidad > 60 or (not coalesce(prod.vendido_por_peso,false) and cantidad<>trunc(cantidad)) then raise exception 'Cantidad invalida'; end if;
   if prod.unidades_pack is distinct from (item->>'unidades_pack')::integer or coalesce(prod.vendido_por_peso,false) is distinct from (item->>'vendidoPorPeso')::boolean then raise exception 'La presentacion cambio: volver a cotizar'; end if;
   select precio_final into actual from catalogo_precios_bot(array[prod.id],q.cliente_id);
   if actual is null or actual<=0 or round(actual,2) is distinct from round((item->>'precioUnitario')::numeric,2) then raise exception 'El precio cambio: volver a cotizar'; end if;
   importe := importe + round(cantidad * actual,2);
 end loop;
 if importe is distinct from q.total then raise exception 'Total de cotizacion inconsistente'; end if;
 cliente := q.cliente_id;
 if cliente is null then
   perform pg_advisory_xact_lock(hashtextextended('bot-cliente/' || p_telefono,0));
   select id into cliente from clientes where regexp_replace(telefono,'[^0-9]','','g')=p_telefono limit 1;
   if cliente is null then insert into clientes(telefono,nombre) values(p_telefono,q.nombre) returning id into cliente; end if;
 end if;
 insert into pedidos(canal,sucursal_id,cliente_id,estado,total,qr_retiro,reserva_stock,destino_direccion,notas,entrega_fecha,entrega_franja)
 values(q.tipo::canal_venta,q.sucursal_id,cliente,'recibido',q.total,
   (case when q.tipo='domicilio' then 'DOM-' else 'PICKUP-' end) || upper(substr(replace(q.id::text,'-',''),1,12)),true,
   q.direccion,q.notas,q.entrega_fecha,q.entrega_franja)
 returning id into pedido;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
   insert into pedidos_items(pedido_id,producto_id,cantidad,precio_unitario)
   values(pedido,(item->>'producto_id')::uuid,(item->>'cantidad')::numeric,(item->>'precioUnitario')::numeric);
   perform registrar_movimiento((item->>'producto_id')::uuid,q.sucursal_id,'reserva',-(item->>'cantidad')::numeric,null,'pedido',pedido::text,null);
 end loop;
 update bot_cotizaciones set pedido_id=pedido,confirmacion=p_confirmacion,confirmada_en=now() where id=q.id;
 return pedido;
end;
$$;
revoke all on function public.confirmar_cotizacion_bot(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.confirmar_cotizacion_bot(uuid,text,text,text) to service_role;

-- Datos del mecanismo existente, necesarios también en instalaciones nuevas.
create table if not exists public.bot_consultas_internas (
 id uuid primary key default gen_random_uuid(), linea text not null, telefono_cliente text not null,
 nombre text, area text, consulta text, direccion text, enviado_a text, waha_msg_id text,
 creado_en timestamptz not null default now(), respuesta_admin text, mensaje_cliente text, respondido_en timestamptz
);
alter table public.bot_consultas_internas add column if not exists gestion_version integer not null default 1;
alter table public.bot_consultas_internas add column if not exists intentos integer not null default 0;
alter table public.bot_consultas_internas add column if not exists ultimo_error text;
alter table public.bot_consultas_internas add column if not exists proximo_intento_en timestamptz;
alter table public.bot_consultas_internas add column if not exists bloqueada_hasta timestamptz;
alter table public.bot_consultas_internas add column if not exists aviso_recordatorio_en timestamptz;
alter table public.bot_consultas_internas add column if not exists envio_iniciado_en timestamptz;
create index if not exists bot_consultas_pendientes on public.bot_consultas_internas(creado_en) where respondido_en is null;
alter table public.bot_consultas_internas enable row level security;
revoke all on public.bot_consultas_internas from anon, authenticated;
grant all on public.bot_consultas_internas to service_role;

-- Claim de entrega: evita dos respuestas al mismo aviso ejecutándose a la vez.
create or replace function public.tomar_entrega_consulta_bot(p_id uuid)
returns setof public.bot_consultas_internas language sql security definer set search_path=public as $$
 update bot_consultas_internas set bloqueada_hasta=now()+interval '2 minutes', intentos=intentos+1
 where id=p_id and respondido_en is null and (bloqueada_hasta is null or bloqueada_hasta<now())
 returning *;
$$;
revoke all on function public.tomar_entrega_consulta_bot(uuid) from public, anon, authenticated;
grant execute on function public.tomar_entrega_consulta_bot(uuid) to service_role;

-- Reserva de notificación de pagos: evita avisos repetidos ante webhooks paralelos.
create table if not exists public.bot_pagos_en_confirmacion (
 id uuid primary key default gen_random_uuid(), linea text not null, telefono_cliente text not null,
 nombre text, monto numeric, waha_msg_id text, creado_en timestamptz not null default now(),
 respuesta_admin text, confirmado_en timestamptz
);
alter table public.bot_pagos_en_confirmacion add column if not exists envio_iniciado_en timestamptz;
alter table public.bot_pagos_en_confirmacion add column if not exists ultimo_error text;
alter table public.bot_pagos_en_confirmacion enable row level security;
revoke all on public.bot_pagos_en_confirmacion from anon, authenticated;
grant all on public.bot_pagos_en_confirmacion to service_role;
create or replace function public.tomar_aviso_pago_bot(p_id uuid)
returns setof public.bot_pagos_en_confirmacion language sql security definer set search_path=public as $$
 update bot_pagos_en_confirmacion set envio_iniciado_en=now()
 where id=p_id and confirmado_en is null and envio_iniciado_en is null returning *;
$$;
revoke all on function public.tomar_aviso_pago_bot(uuid) from public,anon,authenticated;
grant execute on function public.tomar_aviso_pago_bot(uuid) to service_role;

-- Sólo los nuevos adjuntos van aquí. No se vuelve privado el bucket compartido.
insert into storage.buckets(id,name,public) values('bot-adjuntos','bot-adjuntos',false) on conflict(id) do nothing;
commit;

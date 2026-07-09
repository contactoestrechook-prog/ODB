-- ============================================================================
-- Bots de WhatsApp (n8n) — cola de facturas de proveedor. Aplicada 2026-07-02.
--
--   recepciones_bot: el proveedor manda la factura por WhatsApp, la IA la extrae
--   y queda 'pendiente' hasta que un humano la confirma en el panel (recién ahí
--   se mueve stock — nunca automático desde una foto).
-- ============================================================================
create table if not exists public.recepciones_bot (
  id uuid primary key default gen_random_uuid(),
  telefono text,
  proveedor_id uuid references proveedores(id),
  proveedor_detectado text,
  estado text not null default 'pendiente' check (estado in ('pendiente','confirmada','descartada')),
  extraccion jsonb not null,
  con_match integer not null default 0,
  total integer,
  creado_en timestamptz not null default now(),
  confirmada_por uuid references usuarios(id),
  confirmada_en timestamptz,
  oc_id uuid references ordenes_compra(id)
);
create index if not exists recepciones_bot_estado_idx on public.recepciones_bot (estado, creado_en desc);

-- Memoria de conversación del agente (2026-07-05): el cerebro corre server-side
-- (Opus 4.8 + herramientas en /bot/charla); n8n solo transporta mensajes.
create table if not exists public.bot_conversaciones (
  linea text not null check (linea in ('pedidos','proveedores')),
  telefono text not null,
  mensajes jsonb not null default '[]',
  actualizado_en timestamptz not null default now(),
  primary key (linea, telefono)
);

-- Endurecimiento del agente (2026-07-05):
--   bot_mensajes: idempotencia — cada mensaje de WhatsApp (por su wamid) se
--   procesa una sola vez aunque Meta/n8n reintenten; guarda la respuesta.
--   bot_conversaciones.tokens: costo acumulado (tokens Opus) por conversación.
create table if not exists public.bot_mensajes (
  linea text not null,
  mensaje_id text not null,
  telefono text,
  respuesta text,
  creado_en timestamptz not null default now(),
  primary key (linea, mensaje_id)
);
alter table public.bot_conversaciones add column if not exists tokens bigint not null default 0;

-- ============================================================================
-- Fotos de productos por código de barra (2026-07-06). Fuera del bot: es
-- parte del Agente IA (apps/api/src/agente/agente.service.ts, buscarFotos).
-- fotos_intentos: registro de qué producto ya se intentó (evita re-golpear
-- Open Food Facts en vano); candidatos_fotos(limite): candidatos con stock+EAN
-- que faltan intentar, priorizados por stock.
-- ============================================================================
create table if not exists public.fotos_intentos (
  producto_id uuid primary key references productos(id),
  encontrado boolean not null,
  intentado_en timestamptz not null default now()
);

create or replace function public.candidatos_fotos(p_limite integer default 60)
returns table(producto_id uuid, sku text, nombre text, eans text[])
language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.sku, p.nombre, array_agg(distinct cb.codigo)
  from productos p
  join stock s on s.producto_id = p.id and s.cantidad > 0
  join codigos_barras cb on cb.producto_id = p.id
  left join fotos_intentos fi on fi.producto_id = p.id
  where p.activo
    and (fi.producto_id is null or (fi.encontrado = false and fi.intentado_en < now() - interval '30 days'))
  group by p.id, p.sku, p.nombre
  order by (select max(s2.cantidad) from stock s2 where s2.producto_id = p.id) desc
  limit p_limite;
$function$;

-- Nota (2026-07-06): agente.service.ts también gana importarFotosProveedor()
-- (importación masiva de fotos que manda un proveedor, matcheo por SKU/EAN/
-- código propio del proveedor + mismo control de calidad de evaluarFotoProducto,
-- ahora con chequeo de coherencia producto↔imagen). No agrega tablas nuevas
-- (reutiliza codigos_barras, proveedor_productos, fotos_intentos ya versionadas).

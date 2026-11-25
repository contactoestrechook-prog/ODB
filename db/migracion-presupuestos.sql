-- PRESUPUESTOS (25/11/2026). Leandro, por Juan Pablo: «les gustaría que todos puedan hacer
-- presupuestos; por ejemplo llama alguien y dice tengo una fiesta en casa, me gustaría poner
-- vinos, papas fritas, etc., y que los chicos puedan pasarle un presupuesto a raíz de lo que
-- pida el cliente». Decidido: todos los del local; le llega por WhatsApp desde la línea de ODB
-- con la tarjeta y el PDF; el precio vale 48 horas. Si acepta, «Pasar a pedido».
--
-- Los renglones van en `items` (jsonb): productoId, sku, nombre, cantidad y el precio que se le
-- dio. «Vencido» no es un estado: es un borrador o enviado con vence_en en el pasado.
--
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (presupuestos).
create table if not exists public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial unique,
  sucursal_id uuid not null references public.sucursales(id),
  cliente_nombre text check (cliente_nombre is null or length(cliente_nombre) <= 120),
  cliente_telefono text not null check (cliente_telefono ~ '^[0-9]{8,15}$'),
  nota text check (nota is null or length(nota) <= 500),
  items jsonb not null default '[]'::jsonb,
  total numeric(14, 2) not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviado', 'aceptado', 'anulado')),
  vence_en timestamptz not null default (now() + interval '48 hours'),
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id),
  actualizado_en timestamptz,
  enviado_por uuid references public.usuarios(id),
  enviado_en timestamptz,
  envio_error text,
  pedido_id uuid references public.pedidos(id),
  aceptado_por uuid references public.usuarios(id),
  aceptado_en timestamptz,
  anulado_por uuid references public.usuarios(id),
  anulado_en timestamptz
);
create index if not exists presupuestos_creado_en on public.presupuestos (creado_en desc);

alter table public.presupuestos enable row level security;
revoke all on public.presupuestos from anon, authenticated;
revoke all on sequence public.presupuestos_numero_seq from anon, authenticated;

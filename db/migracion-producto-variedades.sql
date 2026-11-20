-- LAS VARIEDADES QUE SE CONOCEN DE CADA PRODUCTO (Leandro, 20/11/2026: «yo
-- entiendo que esté cargado como VARIOS, pero en el momento en el que el
-- empleado que está haciendo el pedido se da cuenta que no hay sabor limón,
-- aclara que hay sabor bebé. O sea que ustedes ya en el sistema tienen que
-- figurar que existe ese sabor»).
--
-- Un producto VARIOS (Aromatizante Saphirus Textil VARIOS) es un solo SKU con un
-- solo stock para todas sus fragancias: el sistema no sabía cuáles hay. Se
-- aprenden del armado: cada variedad que quien arma dice que hay (y la que
-- elige el cliente) queda acá con la última vez que se vio. Las usan:
--   - el armado: «¿Hay de otro sabor?» las sugiere para tocar;
--   - el bot: buscar_productos las devuelve y, si el cliente pide una que no
--     está, le ofrece las que se conocen.
-- `clave` es el nombre en minúsculas y sin tildes (no se repite «Bebé»/«bebe»).
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (producto_variedades).
create table if not exists public.producto_variedades (
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre text not null,
  clave text not null,
  creado_en timestamptz not null default now(),
  visto_en timestamptz not null default now(),
  creado_por uuid references public.usuarios(id),
  primary key (producto_id, clave)
);
alter table public.producto_variedades enable row level security;
revoke all on public.producto_variedades from anon, authenticated;
comment on table public.producto_variedades is 'Variedades (fragancia, sabor, color) que se conocen de un producto VARIOS; se aprenden al armar (20/11/2026)';

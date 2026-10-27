-- Ficha de proveedores (27/10/2026). Pedido de Leandro: «un módulo para que
-- administración vea y pueda cargar bien todos los proveedores actuales con
-- número de teléfono, dirección, CUIT, que puedan subir PDF para catálogo y
-- todo el resto». Hasta hoy el proveedor tenía razón social, CUIT, teléfono,
-- mail, condición y plazo, y se editaba desde una pestaña de Compras: de 326
-- activos, 59 tenían CUIT y 53 teléfono.

-- 1. Los datos que faltaban en la ficha. `telefono` sigue siendo el WhatsApp
--    al que sale el pedido (lo usa pedidos-proveedor); el fijo va aparte.
alter table proveedores
  add column if not exists nombre_fantasia text,
  add column if not exists condicion_iva text
    check (condicion_iva is null or condicion_iva in ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final')),
  add column if not exists direccion text,
  add column if not exists localidad text,
  add column if not exists telefono_fijo text,
  add column if not exists web text,
  add column if not exists banco text,
  add column if not exists cbu text check (cbu is null or cbu ~ '^\d{22}$'),
  add column if not exists alias_cbu text,
  add column if not exists dias_pedido text,
  add column if not exists dias_entrega text,
  add column if not exists pedido_minimo numeric check (pedido_minimo is null or pedido_minimo >= 0),
  add column if not exists notas text,
  add column if not exists actualizado_en timestamptz,
  add column if not exists actualizado_por uuid references usuarios(id);

-- 2. Las personas de cada proveedor: el vendedor, cobranzas, el que reparte.
create table if not exists proveedor_contactos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  rol text not null default 'vendedor' check (rol in ('vendedor', 'cobranzas', 'reparto', 'dueno', 'administracion', 'otro')),
  telefono text,
  email text,
  notas text,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists proveedor_contactos_proveedor on proveedor_contactos (proveedor_id);

-- 3. Los papeles: catálogos, listas de precios, constancia de CUIT, datos
--    bancarios. El archivo vive en el bucket privado `comprobantes`
--    (proveedores/<id>/…) y se abre con un enlace firmado. Borrar es lógico:
--    queda quién y cuándo.
create table if not exists proveedor_documentos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  tipo text not null check (tipo in ('catalogo', 'lista_precios', 'constancia_cuit', 'datos_bancarios', 'contrato', 'otro')),
  nombre text not null,
  ruta text not null,
  tipo_archivo text,
  tamano integer,
  vigencia_hasta date,
  subido_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  borrado_en timestamptz,
  borrado_por uuid references usuarios(id)
);
create index if not exists proveedor_documentos_proveedor on proveedor_documentos (proveedor_id) where borrado_en is null;

alter table proveedor_contactos enable row level security;
alter table proveedor_documentos enable row level security;

-- 4. La lista de la pantalla en una sola consulta (sin el tope de 1.000 filas
--    ni in() con cientos de ids): cuántos productos, última actividad real en
--    ODB (orden, remito, factura o compra leída), deuda y papeles.
create or replace function proveedores_resumen()
returns table (
  proveedor_id uuid,
  productos integer,
  ultima_actividad timestamptz,
  deuda numeric,
  documentos integer,
  contactos integer
)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*)::int from proveedor_productos pp where pp.proveedor_id = p.id),
    greatest(
      (select max(o.creado_en) from ordenes_compra o where o.proveedor_id = p.id),
      (select max(r.creado_en) from remitos r where r.proveedor_id = p.id),
      (select max(f.creado_en) from facturas_proveedor f where f.proveedor_id = p.id),
      (select max(h.creado_en) from compras_historial h where h.proveedor_id = p.id)
    ),
    coalesce((select sum(f.monto - coalesce(f.monto_pagado, 0)) from facturas_proveedor f
               where f.proveedor_id = p.id and f.estado <> 'pagada'), 0),
    (select count(*)::int from proveedor_documentos d where d.proveedor_id = p.id and d.borrado_en is null),
    (select count(*)::int from proveedor_contactos c where c.proveedor_id = p.id)
  from proveedores p;
$$;
revoke all on function proveedores_resumen() from public, anon, authenticated;

-- 5. El logo de la marca (27/10/2026, Leandro: «tratemos de traer los logos de
--    las marcas»). Va en el bucket público `publico` (proveedores/logos/…):
--    se sube a mano o se trae de la web del proveedor.
alter table proveedores add column if not exists logo_url text;

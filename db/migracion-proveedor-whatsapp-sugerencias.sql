-- SUGERENCIAS DE WHATSAPP PARA PROVEEDORES (23/10/2026). Leandro: «si revisás el
-- WhatsApp, ¿no los podés ir asociando?» y «dato clave: no mezclar proveedores».
-- Los contactos guardados en los teléfonos de las líneas cuyo nombre coincide con
-- un proveedor. Los que tenían UN solo contacto claro se cargaron directo; cuando
-- hay varios (vendedor, chofer, cobranzas…) o la coincidencia es dudosa, quedan
-- acá y una persona elige en «Por llegar → WhatsApp de proveedores».
-- Un número que ya es de otro proveedor no se ofrece (lo filtra el API).
create table if not exists proveedor_whatsapp_sugerencias (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  telefono text not null,
  contacto text not null,
  linea text,
  creado_en timestamptz not null default now(),
  unique (proveedor_id, telefono)
);
alter table proveedor_whatsapp_sugerencias enable row level security;

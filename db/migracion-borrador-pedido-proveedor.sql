-- EL PEDIDO A PROVEEDOR SE GUARDA SOLO (Leandro, 4/11/2026): «cargamos un
-- montón de cosas que queríamos pedir y se nos borraron» … «no puede volver a
-- pasar nunca más». Las cantidades vivían solo en el navegador hasta «Enviar a
-- aprobación»: una recarga (por ejemplo, por el cartel de versión nueva) las
-- perdía. Ahora cada cambio queda acá, por proveedor y sucursal, y lo ve
-- cualquiera desde cualquier computadora. Al crear la orden se borra.
create table if not exists public.pedidos_proveedor_borradores (
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  items jsonb not null default '{}'::jsonb, -- { "SKU": cantidad }
  actualizado_por uuid references public.usuarios(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  primary key (proveedor_id, sucursal_id)
);

-- solo la API (clave de servicio) lo lee y escribe
alter table public.pedidos_proveedor_borradores enable row level security;
revoke all on public.pedidos_proveedor_borradores from anon, authenticated;

-- Proveedores para administración, segunda vuelta (3/11/2026). Pedido de
-- Leandro: «¿está bien completo el módulo? investigá qué es lo que no puede
-- faltar y apliquemos». Lo que piden los sistemas de administración y los
-- contadores y que la ficha del 27/10 no tenía:
--   · Ingresos Brutos (número y régimen) y el rubro del proveedor.
--   · El plazo de pago en días, para que la factura sin vencimiento lo calcule.
--   · El titular de la cuenta y el control de cambio de CBU: el fraude más
--     común en pagos a proveedores es que alguien cambie el CBU de un
--     proveedor real. Un CBU nuevo o cambiado queda «sin confirmar» hasta que
--     OTRA persona lo confirma llamando al proveedor, y mientras tanto no se
--     aprueba ni se paga por transferencia.
--   · Lo que dice ARCA del CUIT (estado de la clave y actividad), con la fecha
--     de la consulta.

alter table proveedores
  add column if not exists rubro text,
  add column if not exists iibb_numero text,
  add column if not exists iibb_regimen text
    check (iibb_regimen is null or iibb_regimen in ('local', 'convenio_multilateral', 'exento', 'no_inscripto')),
  add column if not exists plazo_pago_dias integer
    check (plazo_pago_dias is null or plazo_pago_dias between 0 and 180),
  add column if not exists titular_cuenta text,
  -- los datos bancarios que ya estaban (ninguno al 3/11) quedan confirmados;
  -- desde ahora el servicio los marca sin confirmar al cargarlos o cambiarlos
  add column if not exists banco_confirmado boolean not null default true,
  add column if not exists banco_cambiado_por uuid references usuarios(id),
  add column if not exists banco_cambiado_en timestamptz,
  add column if not exists banco_confirmado_por uuid references usuarios(id),
  add column if not exists banco_confirmado_en timestamptz,
  add column if not exists banco_confirmado_como text,
  add column if not exists arca_consultado_en timestamptz,
  add column if not exists arca_estado text,
  add column if not exists arca_actividad text;

-- Historial de cada cambio de datos bancarios: qué había, qué quedó, quién lo
-- cambió y quién lo confirmó. No se borra.
create table if not exists proveedor_cambios_banco (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  antes jsonb,
  despues jsonb not null,
  cambiado_por uuid references usuarios(id),
  cambiado_en timestamptz not null default now(),
  confirmado_por uuid references usuarios(id),
  confirmado_en timestamptz,
  confirmado_como text
);
create index if not exists proveedor_cambios_banco_proveedor on proveedor_cambios_banco (proveedor_id, cambiado_en desc);
alter table proveedor_cambios_banco enable row level security;

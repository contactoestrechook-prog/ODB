-- OP SALÓN (Leandro, 5/11/2026): «un perfil nuevo, op salón: acceso al stock y
-- a la ubicación, ingreso parcial de mercadería por PUERTA TRASERA con remito
-- (administración confirma con la factura y recién ahí entra al stock), y
-- prepara los pedidos: cuando llegan a la caja y se imprime la comanda, se le
-- asigna por sistema; él va sumando con la app lo que mete en el carro y lo
-- medimos en tiempo».
-- Aditiva: sin aplicarla la API no se cae (las pantallas nuevas avisan).

alter type rol_usuario add value if not exists 'op_salon';

-- 1) Dónde está cada producto en cada sucursal (góndola, estante, depósito)
alter table stock add column if not exists ubicacion text;
alter table stock add column if not exists ubicacion_por uuid references usuarios(id);
alter table stock add column if not exists ubicacion_en timestamptz;

-- 2) Ingreso por puerta trasera: lo que bajó con el remito ESPERA a la factura.
--    No toca el stock; administración lo confirma y ahí entra (entrada directa).
create table if not exists ingresos_puerta (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  proveedor_id uuid not null references proveedores(id),
  sucursal_id uuid not null references sucursales(id),
  numero_remito text not null,
  notas text,
  estado text not null default 'espera_factura' check (estado in ('espera_factura', 'ingresado', 'rechazado')),
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  confirmado_por uuid references usuarios(id),
  confirmado_en timestamptz,
  numero_factura text,
  remito_id uuid,
  motivo_rechazo text
);
create index if not exists ingresos_puerta_estado on ingresos_puerta (estado, creado_en desc);

create table if not exists ingresos_puerta_items (
  ingreso_id uuid not null references ingresos_puerta(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad numeric not null check (cantidad > 0),
  cantidad_confirmada numeric,
  lote text,
  vencimiento date,
  primary key (ingreso_id, producto_id)
);

-- 3) Preparación asignada: quién arma el pedido (lo elige la caja al imprimir)
alter table pedidos add column if not exists asignado_a uuid references usuarios(id);
alter table pedidos add column if not exists asignado_en timestamptz;
alter table pedidos add column if not exists asignado_por uuid references usuarios(id);
alter table pedidos add column if not exists armado_terminado_en timestamptz;

-- Cada vez que suma algo al carro: qué, cuánto y a qué hora (la medición)
create table if not exists pedidos_carro (
  id bigserial primary key,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad numeric not null,
  usuario_id uuid references usuarios(id),
  por_codigo boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists pedidos_carro_pedido on pedidos_carro (pedido_id, creado_en);
create index if not exists pedidos_asignado on pedidos (asignado_a) where asignado_a is not null;

alter table ingresos_puerta enable row level security;
alter table ingresos_puerta_items enable row level security;
alter table pedidos_carro enable row level security;
revoke all on ingresos_puerta, ingresos_puerta_items, pedidos_carro from anon, authenticated;
revoke all on sequence ingresos_puerta_numero_seq, pedidos_carro_id_seq from anon, authenticated;

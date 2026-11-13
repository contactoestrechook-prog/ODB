-- NÚCLEO Gastro · Gran Caminito — esquema completo de la base.
--
-- La base original se borró el 3/9/2026 y el respaldo no apareció. Este
-- archivo rehace las 16 tablas a partir de lo que usa el código de la API y
-- suma las del 12/11/2026 (tres monedas, cobro, Pix, derivadores, reservas,
-- cortes, feriados). Se corre una sola vez sobre un proyecto vacío.
--
-- La API entra con la service key, así que todas las tablas quedan con RLS
-- prendido y sin policies: con la clave pública no se lee ni se escribe nada.

create extension if not exists pgcrypto;

-- ───────────────────────── Salón ─────────────────────────

create table mesas (
  id uuid primary key default gen_random_uuid(),
  numero int not null,
  sector text,
  qr_token text not null unique,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table mozos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Quién manda gente: hoteles, guías, agencias, remises.
create table derivadores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'hotel' check (tipo in ('hotel', 'guia', 'agencia', 'remis', 'otro')),
  contacto text,
  telefono text,
  comision_pct numeric(5,2) not null default 0,
  codigo text not null unique,
  activo boolean not null default true,
  notas text,
  creado_en timestamptz not null default now()
);

create table reservas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  personas int not null,
  fecha_hora timestamptz not null,
  idioma text not null default 'es' check (idioma in ('es', 'pt', 'en')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'sentada', 'no_vino', 'cancelada')),
  origen text not null default 'salon' check (origen in ('salon', 'web', 'whatsapp', 'google', 'derivador')),
  derivador_id uuid references derivadores(id),
  mesa_id uuid references mesas(id),
  sena_monto numeric(12,2),
  sena_pagada boolean not null default false,
  notas text,
  recordatorio_en timestamptz,
  creado_en timestamptz not null default now()
);
create index reservas_fecha_idx on reservas (fecha_hora);

-- El reloj de la mesa: un renglón por visita, una columna de hora por estado.
create table mesa_ciclos (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references mesas(id),
  mozo_id uuid references mozos(id),
  derivador_id uuid references derivadores(id),
  reserva_id uuid references reservas(id),
  estado text not null default 'sentada'
    check (estado in ('sentada', 'vio_carta', 'comanda_tomada', 'plato_servido', 'terminando', 'pidio_cuenta', 'pago', 'libre')),
  estado_desde timestamptz not null default now(),
  cubiertos int,
  monto numeric(12,2),
  llamado_mozo_en timestamptz,
  -- cómo dijo el cliente que quiere pagar al pedir la cuenta desde su teléfono
  pago_preferido_metodo text,
  pago_preferido_moneda text,
  sentada_en timestamptz not null default now(),
  vio_carta_en timestamptz,
  comanda_tomada_en timestamptz,
  plato_servido_en timestamptz,
  terminando_en timestamptz,
  pidio_cuenta_en timestamptz,
  pago_en timestamptz,
  libre_en timestamptz
);
-- una sola visita abierta por mesa
create unique index mesa_ciclos_una_abierta on mesa_ciclos (mesa_id) where estado <> 'libre';
create index mesa_ciclos_libre_en_idx on mesa_ciclos (libre_en);
create index mesa_ciclos_derivador_idx on mesa_ciclos (derivador_id);

create table lista_espera (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text not null,
  personas int not null,
  idioma text not null default 'es',
  estado text not null default 'esperando' check (estado in ('esperando', 'avisado', 'sentado', 'abandono')),
  creado_en timestamptz not null default now(),
  avisado_en timestamptz,
  resuelto_en timestamptz
);

-- ───────────────────────── Carta y cocina ─────────────────────────

create table cortes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- de cada kilo comprado, qué parte llega al plato (objetivo de la cocina)
  rinde_objetivo_pct numeric(5,2) not null default 80,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table carta_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_pt text,
  nombre_en text,
  orden int not null default 0
);

create table carta_items (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references carta_categorias(id),
  nombre text not null,
  nombre_pt text,
  nombre_en text,
  descripcion text,
  descripcion_pt text,
  descripcion_en text,
  precio numeric(12,2) not null,
  costo numeric(12,2),
  imagen_url text,
  alergenos text[] not null default '{}',
  etiquetas text[] not null default '{}',
  activo boolean not null default true,
  agotado boolean not null default false,
  orden int not null default 0,
  tiempo_coccion_min int,
  corte_id uuid references cortes(id),
  gramos_porcion int
);

create table comanda_items (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references mesa_ciclos(id),
  item_id uuid references carta_items(id),
  nombre text not null,
  cantidad int not null default 1,
  precio_unitario numeric(12,2) not null default 0,
  tiempo_coccion_min int,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_coccion', 'listo', 'entregado')),
  enviado_en timestamptz not null default now(),
  en_coccion_desde timestamptz,
  listo_en timestamptz,
  entregado_en timestamptz
);
create index comanda_items_ciclo_idx on comanda_items (ciclo_id);
create index comanda_items_enviado_idx on comanda_items (enviado_en);

-- ───────────────────────── Plata ─────────────────────────

-- Cada cobro, en la moneda en que entró y pasado a pesos con el cambio de la casa.
create table pagos (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references mesa_ciclos(id),
  metodo text not null check (metodo in ('pix', 'qr', 'tarjeta', 'efectivo')),
  moneda text not null check (moneda in ('ARS', 'BRL', 'USD')),
  monto numeric(12,2) not null,
  tipo_cambio numeric(12,4) not null default 1,
  monto_ars numeric(12,2) not null,
  estado text not null default 'confirmado' check (estado in ('pendiente', 'confirmado', 'anulado')),
  referencia text,
  cargado_por text,
  creado_en timestamptz not null default now()
);
create index pagos_ciclo_idx on pagos (ciclo_id);
create index pagos_creado_idx on pagos (creado_en);

create table derivador_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  derivador_id uuid not null references derivadores(id),
  mes text not null,               -- 'AAAA-MM'
  monto numeric(12,2) not null,
  pagado_en timestamptz not null default now(),
  nota text,
  unique (derivador_id, mes)
);

create table proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cuit text
);

create table compras (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id),
  numero_comprobante text,
  fecha date not null,
  subtotal numeric(14,2),
  iva_105 numeric(14,2),
  iva_21 numeric(14,2),
  total numeric(14,2) not null,
  creado_en timestamptz not null default now()
);

create table compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references compras(id) on delete cascade,
  descripcion text not null,
  cantidad numeric(12,3),
  precio_unitario numeric(14,2),
  total numeric(14,2),
  corte_id uuid references cortes(id),
  kilos numeric(10,3)
);

-- ───────────────────────── Clientes y reputación ─────────────────────────

create table opiniones (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references mesas(id),
  sentimiento text not null check (sentimiento in ('contento', 'neutral', 'molesto')),
  comentario text,
  creado_en timestamptz not null default now()
);

create table alertas_encargado (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references mesas(id),
  opinion_id uuid references opiniones(id),
  sentimiento text not null,
  atendida boolean not null default false,
  creado_en timestamptz not null default now()
);

create table contactos (
  id uuid primary key default gen_random_uuid(),
  telefono text not null,
  nombre text,
  idioma text not null default 'es',
  mesa_id uuid references mesas(id),
  ciclo_id uuid unique references mesa_ciclos(id),   -- un canje por visita
  post_visita_enviado_en timestamptz,
  creado_en timestamptz not null default now()
);

create table resenas_google (
  id uuid primary key default gen_random_uuid(),
  autor text not null,
  rating int not null check (rating between 1 and 5),
  texto text not null,
  idioma text not null default 'es',
  origen text not null default 'google',
  tema text,
  respuesta_ia text,
  respuesta_estado text not null default 'pendiente'
    check (respuesta_estado in ('pendiente', 'borrador', 'aprobada', 'publicada', 'rechazada')),
  publicado_en timestamptz,
  creado_en timestamptz not null default now()
);

-- ───────────────────────── Configuración ─────────────────────────

create table configuracion (
  id boolean primary key default true check (id),   -- una sola fila
  nombre_restaurante text not null default 'Gran Caminito',
  capacidad_asientos int not null default 300,
  horas_servicio_dia numeric(4,1) not null default 8,
  dos_por_uno_activo boolean not null default false,
  -- tipo de cambio de la casa: cuántos pesos vale un real y un dólar
  cambio_brl numeric(12,2),
  cambio_usd numeric(12,2),
  cambio_actualizado_en timestamptz,
  -- 'terminal' = Pix por el posnet, el mozo marca el cobro · 'api' = QR por mesa
  pix_modo text not null default 'terminal' check (pix_modo in ('terminal', 'api')),
  whatsapp_dueno text,
  -- supuesto del pronóstico: cuánto más se trabaja en un feriado
  factor_feriado numeric(4,2) not null default 1.25,
  actualizado_en timestamptz not null default now()
);
insert into configuracion (id) values (true);

create table feriados (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  pais text not null check (pais in ('AR', 'BR')),
  nombre text not null,
  unique (fecha, pais)
);

create table analista_insights (
  fecha date primary key,
  metricas jsonb not null,
  texto text not null,
  creado_en timestamptz not null default now()
);

-- ───────────────────────── Candado ─────────────────────────

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================
-- ODB — Esquema PostgreSQL
-- Convención: nombres en español, snake_case, ids UUID.
-- El stock NUNCA se edita directo: solo vía movimientos_stock.
-- ============================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- búsqueda por nombre con 13k artículos

-- ------------------------------------------------------------
-- Núcleo: sucursales, usuarios, auditoría
-- ------------------------------------------------------------

create table sucursales (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  direccion    text,
  lat          double precision,
  lng          double precision,
  punto_venta_arca int,                -- numeración de facturación por sucursal
  activa       boolean not null default true
);

create type rol_usuario as enum ('dueno','gerente','comprador','cajero','deposito');

create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  email         text unique not null,
  rol           rol_usuario not null,
  sucursal_id   uuid references sucursales(id),   -- null = todas (dueño/comprador)
  pin_firma     text,                              -- hash del PIN para aprobaciones
  limite_aprobacion numeric(14,2) default 0,       -- monto máximo que puede aprobar
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

create table auditoria (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references usuarios(id),
  accion      text not null,            -- 'ajuste_stock', 'anulacion_venta', etc.
  entidad     text not null,
  entidad_id  text not null,
  datos_antes jsonb,
  datos_despues jsonb,
  creado_en   timestamptz not null default now()
);
create index on auditoria (entidad, entidad_id);

-- ------------------------------------------------------------
-- Catálogo
-- ------------------------------------------------------------

create table categorias (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  padre_id  uuid references categorias(id),
  margen_sugerido numeric(5,2)          -- % para recalcular precio al cambiar costo
);

create table marcas (
  id     uuid primary key default gen_random_uuid(),
  nombre text unique not null
);

create table productos (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique not null,
  nombre        text not null,
  descripcion   text,
  marca_id      uuid references marcas(id),
  categoria_id  uuid references categorias(id),
  volumen_ml    int,
  unidades_pack int not null default 1,     -- 1 = unidad, 6 = pack x6...
  graduacion    numeric(4,1),
  es_alcohol    boolean not null default false,  -- bloquea venta a menores
  costo         numeric(14,2),                   -- último costo conocido
  controla_vencimiento boolean not null default false,
  tiendanube_id bigint,                          -- id del producto en Tienda Nube
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
create index productos_nombre_trgm on productos using gin (nombre gin_trgm_ops);

-- Varios códigos de barras por producto (botella, pack, etc.)
create table codigos_barras (
  codigo      text primary key,
  producto_id uuid not null references productos(id)
);

create table listas_precios (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,                 -- 'Minorista', 'Mayorista'
  activa  boolean not null default true
);

create table precios (
  id            uuid primary key default gen_random_uuid(),
  lista_id      uuid not null references listas_precios(id),
  producto_id   uuid not null references productos(id),
  precio        numeric(14,2) not null,
  vigente_desde timestamptz not null default now(),
  creado_por    uuid references usuarios(id)
);
-- El precio vigente es el de vigente_desde más reciente <= now()
create index on precios (producto_id, lista_id, vigente_desde desc);

create table promociones (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  tipo      text not null,               -- '3x2', 'segunda_al_x', 'combo', 'descuento_categoria_cliente'
  config    jsonb not null,              -- productos/categorías/porcentajes
  desde     timestamptz not null,
  hasta     timestamptz not null,
  activa    boolean not null default true
);

-- Cola de etiquetas de góndola pendientes de imprimir tras cambios de precio
create table etiquetas_pendientes (
  id           bigint generated always as identity primary key,
  producto_id  uuid not null references productos(id),
  sucursal_id  uuid not null references sucursales(id),
  impresa      boolean not null default false,
  creado_en    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Stock (por sucursal; mutación solo vía movimientos)
-- ------------------------------------------------------------

create table stock (
  producto_id      uuid not null references productos(id),
  sucursal_id      uuid not null references sucursales(id),
  cantidad         numeric(12,3) not null default 0,
  stock_minimo     numeric(12,3) not null default 0,
  punto_reposicion numeric(12,3) not null default 0,
  primary key (producto_id, sucursal_id)
);

create type tipo_movimiento as enum (
  'venta','devolucion','compra','ajuste','merma',
  'transferencia_salida','transferencia_entrada','reserva','liberacion_reserva'
);

create table movimientos_stock (
  id              bigint generated always as identity primary key,
  producto_id     uuid not null references productos(id),
  sucursal_id     uuid not null references sucursales(id),
  tipo            tipo_movimiento not null,
  cantidad        numeric(12,3) not null,    -- positiva entra, negativa sale
  motivo          text,                       -- obligatorio para ajuste/merma (validado en API)
  referencia_tipo text,                       -- 'venta','remito','transferencia','conteo'
  referencia_id   text,
  lote            text,
  usuario_id      uuid references usuarios(id),
  creado_en       timestamptz not null default now()
);
create index on movimientos_stock (producto_id, sucursal_id, creado_en desc);

create table lotes (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id),
  sucursal_id  uuid not null references sucursales(id),
  lote         text not null,
  vencimiento  date not null,
  cantidad     numeric(12,3) not null default 0
);
create index on lotes (vencimiento);

create table transferencias (
  id                  uuid primary key default gen_random_uuid(),
  sucursal_origen_id  uuid not null references sucursales(id),
  sucursal_destino_id uuid not null references sucursales(id),
  estado              text not null default 'pendiente',  -- pendiente|en_transito|recibida|cancelada
  creada_por          uuid references usuarios(id),
  recibida_por        uuid references usuarios(id),
  creado_en           timestamptz not null default now()
);

create table transferencias_items (
  transferencia_id uuid not null references transferencias(id),
  producto_id      uuid not null references productos(id),
  cantidad         numeric(12,3) not null,
  primary key (transferencia_id, producto_id)
);

-- Conteos de inventario cíclico
create table conteos (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id),
  sector      text,                      -- góndola/pasillo
  estado      text not null default 'abierto',  -- abierto|cerrado|aplicado
  usuario_id  uuid references usuarios(id),
  creado_en   timestamptz not null default now()
);

create table conteos_items (
  conteo_id        uuid not null references conteos(id),
  producto_id      uuid not null references productos(id),
  cantidad_contada numeric(12,3) not null,
  cantidad_sistema numeric(12,3) not null,   -- snapshot al momento del conteo
  primary key (conteo_id, producto_id)
);

-- ------------------------------------------------------------
-- Proveedores y compras
-- ------------------------------------------------------------

create table proveedores (
  id              uuid primary key default gen_random_uuid(),
  razon_social    text not null,
  cuit            text unique,
  condicion_pago  text,                  -- 'contado', '30 días'...
  lead_time_dias  int not null default 7,
  email           text,
  telefono        text,
  activo          boolean not null default true
);

create table proveedor_productos (
  proveedor_id     uuid not null references proveedores(id),
  producto_id      uuid not null references productos(id),
  codigo_proveedor text,
  ultimo_costo     numeric(14,2),
  actualizado_en   timestamptz,
  primary key (proveedor_id, producto_id)
);

-- Historial de costos para detectar aumentos
create table costos_historial (
  id           bigint generated always as identity primary key,
  proveedor_id uuid not null references proveedores(id),
  producto_id  uuid not null references productos(id),
  costo        numeric(14,2) not null,
  origen       text,                     -- 'lista_pdf','remito','manual'
  creado_en    timestamptz not null default now()
);

-- Archivos de listas de precios subidos (PDF/Excel) y su procesamiento por IA
create table listas_proveedor_archivos (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id),
  archivo_url  text not null,            -- Supabase storage
  estado       text not null default 'pendiente',  -- pendiente|procesado|aplicado|error
  resultado    jsonb,                    -- renglones extraídos + matching propuesto
  subido_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

create type estado_oc as enum (
  'borrador','pendiente_aprobacion','aprobada','enviada',
  'recibida_parcial','recibida','cancelada'
);

create table ordenes_compra (
  id           uuid primary key default gen_random_uuid(),
  numero       bigint generated always as identity,
  proveedor_id uuid not null references proveedores(id),
  sucursal_id  uuid not null references sucursales(id),
  estado       estado_oc not null default 'borrador',
  total        numeric(14,2) not null default 0,
  origen       text not null default 'manual',   -- 'manual' | 'sugerencia'
  creada_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

create table ordenes_compra_items (
  oc_id             uuid not null references ordenes_compra(id),
  producto_id       uuid not null references productos(id),
  cantidad          numeric(12,3) not null,
  costo_unitario    numeric(14,2) not null,
  cantidad_recibida numeric(12,3) not null default 0,
  primary key (oc_id, producto_id)
);

-- Firmas de aprobación (OC y órdenes de pago)
create table aprobaciones (
  id            uuid primary key default gen_random_uuid(),
  entidad       text not null,           -- 'orden_compra' | 'orden_pago'
  entidad_id    uuid not null,
  usuario_id    uuid not null references usuarios(id),
  hash_documento text not null,          -- hash del contenido aprobado (inmutabilidad)
  metodo        text not null default 'pin',  -- 'pin' | 'biometria'
  creado_en     timestamptz not null default now()
);

-- Remitos de ingreso de mercadería (procesados por IA, confirmados por humano)
create table remitos (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id),
  oc_id        uuid references ordenes_compra(id),
  sucursal_id  uuid not null references sucursales(id),
  numero       text,
  archivo_url  text,
  estado       text not null default 'pendiente',  -- pendiente|procesado|confirmado
  resultado_ia jsonb,
  confirmado_por uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

create table remitos_items (
  remito_id   uuid not null references remitos(id),
  producto_id uuid not null references productos(id),
  cantidad    numeric(12,3) not null,
  lote        text,
  vencimiento date,
  primary key (remito_id, producto_id)
);

create table facturas_proveedor (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id),
  numero       text not null,
  monto        numeric(14,2) not null,
  vencimiento  date,
  estado       text not null default 'pendiente',  -- pendiente|en_orden_pago|pagada
  remito_id    uuid references remitos(id),
  creado_en    timestamptz not null default now()
);

create table ordenes_pago (
  id          uuid primary key default gen_random_uuid(),
  numero      bigint generated always as identity,
  proveedor_id uuid not null references proveedores(id),
  estado      text not null default 'pendiente_aprobacion',  -- pendiente_aprobacion|aprobada|pagada|anulada
  total       numeric(14,2) not null,
  medio_pago  text,                      -- transferencia|cheque|efectivo
  creada_por  uuid references usuarios(id),
  pagada_en   timestamptz,
  creado_en   timestamptz not null default now()
);

create table ordenes_pago_items (
  orden_pago_id uuid not null references ordenes_pago(id),
  factura_id    uuid not null references facturas_proveedor(id),
  monto         numeric(14,2) not null,
  primary key (orden_pago_id, factura_id)
);

-- ------------------------------------------------------------
-- Clientes
-- ------------------------------------------------------------

create type tipo_cliente as enum ('nuevo','ocasional','frecuente','mayorista','vip');

create table clientes (
  id                uuid primary key default gen_random_uuid(),
  dni               text unique,
  cuit              text,
  nombre            text,
  email             text,
  telefono          text,
  fecha_nacimiento  date,
  tipo              tipo_cliente not null default 'nuevo',
  -- Verificación biométrica (Didit): guardamos solo el veredicto
  verificado        boolean not null default false,
  verificacion_id   text,
  verificado_en     timestamptz,
  consentimiento_datos timestamptz,      -- aceptación Ley 25.326
  limite_cta_cte    numeric(14,2) not null default 0,
  saldo_cta_cte     numeric(14,2) not null default 0,
  puntos            int not null default 0,
  tiendanube_customer_id bigint,
  creado_en         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Ventas y caja
-- ------------------------------------------------------------

create table cajas (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id),
  nombre      text not null
);

create table sesiones_caja (
  id            uuid primary key default gen_random_uuid(),
  caja_id       uuid not null references cajas(id),
  usuario_id    uuid not null references usuarios(id),
  monto_inicial numeric(14,2) not null,
  monto_cierre  numeric(14,2),
  diferencia    numeric(14,2),
  abierta_en    timestamptz not null default now(),
  cerrada_en    timestamptz
);

create type canal_venta as enum ('mostrador','self_checkout','web','whatsapp','pickup');

create table ventas (
  id            uuid primary key,        -- UUID generado en el POS (idempotencia offline)
  sucursal_id   uuid not null references sucursales(id),
  sesion_caja_id uuid references sesiones_caja(id),
  cliente_id    uuid references clientes(id),
  canal         canal_venta not null default 'mostrador',
  estado        text not null default 'completada',  -- completada|anulada
  subtotal      numeric(14,2) not null,
  descuento     numeric(14,2) not null default 0,
  total         numeric(14,2) not null,
  pedido_id     uuid,                    -- si nació de un pedido online
  vendida_en    timestamptz not null default now(),
  sincronizada_en timestamptz            -- cuándo llegó del POS offline
);
create index on ventas (sucursal_id, vendida_en desc);
create index on ventas (cliente_id, vendida_en desc);

create table ventas_items (
  venta_id        uuid not null references ventas(id),
  producto_id     uuid not null references productos(id),
  cantidad        numeric(12,3) not null,
  precio_unitario numeric(14,2) not null,
  costo_unitario  numeric(14,2),          -- snapshot para margen
  promocion_id    uuid references promociones(id),
  primary key (venta_id, producto_id)
);

create table pagos (
  id            uuid primary key default gen_random_uuid(),
  venta_id      uuid not null references ventas(id),
  medio         text not null,           -- efectivo|mercadopago|tarjeta|cta_cte
  monto         numeric(14,2) not null,
  mp_payment_id text,
  creado_en     timestamptz not null default now()
);

create table comprobantes_arca (
  id             uuid primary key default gen_random_uuid(),
  venta_id       uuid not null references ventas(id),
  tipo           text not null,          -- FA|FB|FC|NCA|NCB|NCC
  punto_venta    int not null,
  numero         bigint,
  cae            text,
  cae_vencimiento date,
  estado         text not null default 'pendiente',  -- pendiente|emitido|error (cola de contingencia)
  pdf_url        text,
  creado_en      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Pedidos (web / whatsapp / pickup / self-checkout)
-- ------------------------------------------------------------

create type estado_pedido as enum (
  'recibido','pagado','en_preparacion','listo','entregado','cancelado'
);

create table pedidos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid references clientes(id),
  canal         canal_venta not null,
  sucursal_id   uuid not null references sucursales(id),
  estado        estado_pedido not null default 'recibido',
  total         numeric(14,2) not null,
  -- Pick-up con geolocalización
  eta_minutos   int,
  preparar_desde timestamptz,            -- disparado cuando ETA < umbral
  qr_retiro     text,                    -- token validado en mostrador
  tiendanube_order_id bigint,
  creado_en     timestamptz not null default now(),
  listo_en      timestamptz,
  entregado_en  timestamptz
);
create index on pedidos (sucursal_id, estado);

create table pedidos_items (
  pedido_id       uuid not null references pedidos(id),
  producto_id     uuid not null references productos(id),
  cantidad        numeric(12,3) not null,
  precio_unitario numeric(14,2) not null,
  primary key (pedido_id, producto_id)
);

-- ------------------------------------------------------------
-- Integraciones: log de webhooks/sync para depurar
-- ------------------------------------------------------------

create table integraciones_log (
  id        bigint generated always as identity primary key,
  servicio  text not null,               -- tiendanube|mercadopago|arca|whatsapp|didit
  direccion text not null,               -- entrada|salida
  evento    text,
  payload   jsonb,
  exito     boolean,
  error     text,
  creado_en timestamptz not null default now()
);
create index on integraciones_log (servicio, creado_en desc);

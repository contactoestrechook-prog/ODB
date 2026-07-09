-- =============================================================
-- ODB — Esquema real: tablas
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-01
-- 74 tablas del schema public. Columnas reconstruidas desde pg_attribute
-- (format_type + defaults + identity), PK/UNIQUE/CHECK desde pg_constraint
-- (pg_get_constraintdef). Las FK van como ALTER TABLE al final para no
-- depender del orden de creación.
-- Requiere: 01-tipos.sql (enums) y extensiones pg_trgm, unaccent, pgcrypto.
-- Nota: productos.nombre_normalizado depende de la función quitar_tildes()
-- (ver 04-funciones.sql); si se corre desde cero, crear esa función antes.
-- =============================================================

-- Secuencia standalone (repartos.numero no es identity, usa nextval)
create sequence if not exists repartos_numero_seq;

create table public.acreditaciones (
  id uuid default gen_random_uuid() not null,
  pago_id uuid not null,
  venta_id uuid,
  medio text not null,
  bruto numeric(14,2) not null,
  comision_estimada numeric(14,2) default 0 not null,
  neto_estimado numeric(14,2) not null,
  fecha_estimada date,
  estado text default 'pendiente'::text not null,
  neto_real numeric(14,2),
  comision_real numeric(14,2),
  fecha_real date,
  mp_payment_id text,
  nota text,
  conciliado_en timestamp with time zone,
  conciliado_por uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.acreditaciones add constraint acreditaciones_pkey PRIMARY KEY (id);
alter table public.acreditaciones add constraint acreditaciones_pago_id_key UNIQUE (pago_id);

create table public.agente_auditoria (
  id bigint generated always as identity not null,
  tarea_id bigint,
  herramienta text not null,
  argumentos jsonb,
  resultado jsonb,
  ok boolean default true not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.agente_auditoria add constraint agente_auditoria_pkey PRIMARY KEY (id);

create table public.agente_tareas (
  id bigint generated always as identity not null,
  descripcion text not null,
  tipo text default 'general'::text not null,
  estado text default 'pendiente'::text not null,
  resultado text,
  confianza numeric,
  motivo_escalamiento text,
  origen text default 'manual'::text,
  resuelta_por uuid,
  creado_en timestamp with time zone default now() not null,
  procesado_en timestamp with time zone
);
alter table public.agente_tareas add constraint agente_tareas_pkey PRIMARY KEY (id);
alter table public.agente_tareas add constraint agente_tareas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'procesando'::text, 'completada'::text, 'escalada'::text, 'error'::text])));

create table public.aprobaciones (
  id uuid default gen_random_uuid() not null,
  entidad text not null,
  entidad_id uuid not null,
  usuario_id uuid not null,
  hash_documento text not null,
  metodo text default 'pin'::text not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.aprobaciones add constraint aprobaciones_pkey PRIMARY KEY (id);

create table public.auditoria (
  id bigint generated always as identity not null,
  usuario_id uuid,
  accion text not null,
  entidad text not null,
  entidad_id text not null,
  datos_antes jsonb,
  datos_despues jsonb,
  creado_en timestamp with time zone default now() not null
);
alter table public.auditoria add constraint auditoria_pkey PRIMARY KEY (id);

create table public.avisos_reposicion (
  id bigint generated always as identity not null,
  cliente_id uuid not null,
  producto_id uuid not null,
  creado_en timestamp with time zone default now() not null,
  notificado_en timestamp with time zone
);
alter table public.avisos_reposicion add constraint avisos_reposicion_pkey PRIMARY KEY (id);

create table public.cajas (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid not null,
  nombre text not null
);
alter table public.cajas add constraint cajas_pkey PRIMARY KEY (id);

create table public.caja_movimientos (
  id bigint generated always as identity not null,
  sesion_id uuid not null,
  tipo text not null,
  monto numeric not null,
  motivo text not null,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.caja_movimientos add constraint caja_movimientos_pkey PRIMARY KEY (id);
alter table public.caja_movimientos add constraint caja_movimientos_monto_check CHECK ((monto > (0)::numeric));
alter table public.caja_movimientos add constraint caja_movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['ingreso'::text, 'egreso'::text])));

-- Token de un solo uso emitido por /caja/autorizar (PIN de supervisor); ver
-- caja.service.ts#consumirAutorizacion.
create table public.autorizaciones_caja (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  rol text not null,
  creado_en timestamp with time zone default now() not null,
  expira_en timestamp with time zone default (now() + interval '3 minutes') not null,
  usado_en timestamp with time zone
);
alter table public.autorizaciones_caja add constraint autorizaciones_caja_pkey PRIMARY KEY (id);
alter table public.autorizaciones_caja add constraint autorizaciones_caja_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);

create table public.canjes (
  id uuid default gen_random_uuid() not null,
  cliente_id uuid not null,
  recompensa text not null,
  puntos integer not null,
  codigo text not null,
  estado text default 'pendiente'::text not null,
  creado_en timestamp with time zone default now() not null,
  entregado_en timestamp with time zone
);
alter table public.canjes add constraint canjes_pkey PRIMARY KEY (id);

create table public.categorias (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  padre_id uuid,
  margen_sugerido numeric(5,2),
  margen_mayorista numeric(5,2)
);
alter table public.categorias add constraint categorias_pkey PRIMARY KEY (id);

create table public.cheques (
  id uuid default gen_random_uuid() not null,
  tipo text not null,
  numero text not null,
  banco text,
  titular text,
  cuit_librador text,
  importe numeric not null,
  fecha_emision date,
  fecha_cobro date,
  es_diferido boolean default false not null,
  estado text default 'cartera'::text not null,
  cliente_id uuid,
  proveedor_id uuid,
  recibo_id uuid,
  orden_pago_id uuid,
  banco_deposito text,
  motivo_rechazo text,
  observaciones text,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null
);
alter table public.cheques add constraint cheques_pkey PRIMARY KEY (id);
alter table public.cheques add constraint cheques_estado_check CHECK ((estado = ANY (ARRAY['cartera'::text, 'depositado'::text, 'acreditado'::text, 'rechazado'::text, 'aplicado'::text, 'emitido'::text, 'debitado'::text, 'anulado'::text])));
alter table public.cheques add constraint cheques_importe_check CHECK ((importe > (0)::numeric));
alter table public.cheques add constraint cheques_tipo_check CHECK ((tipo = ANY (ARRAY['terceros'::text, 'propio'::text])));

create table public.clientes (
  id uuid default gen_random_uuid() not null,
  dni text,
  cuit text,
  nombre text,
  email text,
  telefono text,
  fecha_nacimiento date,
  tipo tipo_cliente default 'nuevo'::tipo_cliente not null,
  verificado boolean default false not null,
  verificacion_id text,
  verificado_en timestamp with time zone,
  consentimiento_datos timestamp with time zone,
  limite_cta_cte numeric(14,2) default 0 not null,
  saldo_cta_cte numeric(14,2) default 0 not null,
  puntos integer default 0 not null,
  tiendanube_customer_id bigint,
  creado_en timestamp with time zone default now() not null,
  condicion_iva text default 'consumidor_final'::text not null,
  razon_social text,
  domicilio text,
  cta_cte_habilitada boolean default false not null,
  limite_credito numeric(14,2) default 0 not null,
  expo_push_token text,
  acepta_marketing boolean default false not null,
  marketing_optout_en timestamp with time zone,
  referido_por uuid,
  codigo_referido text,
  codigo_legacy text,
  dia_reparto text,
  zona_reparto text,
  vendedor_reparto text,
  barrio text,
  envases jsonb,
  mayorista boolean not null default false
);
alter table public.clientes add constraint clientes_pkey PRIMARY KEY (id);
alter table public.clientes add constraint clientes_codigo_legacy_key UNIQUE (codigo_legacy);
alter table public.clientes add constraint clientes_dni_key UNIQUE (dni);

create table public.codigos_barras (
  codigo text not null,
  producto_id uuid not null
);
alter table public.codigos_barras add constraint codigos_barras_pkey PRIMARY KEY (codigo);

create table public.comisiones_medios (
  medio text not null,
  comision_pct numeric(5,2) default 0 not null,
  dias_acreditacion integer default 0 not null,
  actualizado_en timestamp with time zone default now() not null
);
alter table public.comisiones_medios add constraint comisiones_medios_pkey PRIMARY KEY (medio);

create table public.compra_facil_pendientes (
  id uuid default gen_random_uuid() not null,
  cliente_dni text not null,
  sucursal_id uuid not null,
  items jsonb not null,
  total numeric not null,
  estado text default 'pendiente'::text not null,
  venta_id uuid,
  codigo text,
  creado_en timestamp with time zone default now() not null,
  error_detalle text
);
alter table public.compra_facil_pendientes add constraint compra_facil_pendientes_pkey PRIMARY KEY (id);

create table public.comprobantes (
  id uuid default gen_random_uuid() not null,
  tipo tipo_comprobante not null,
  punto_venta integer not null,
  numero bigint not null,
  emitido_en timestamp with time zone default now() not null,
  cliente_id uuid,
  receptor jsonb default '{}'::jsonb not null,
  venta_id uuid,
  referencia_id uuid,
  items jsonb default '[]'::jsonb not null,
  neto numeric(14,2) default 0 not null,
  iva numeric(14,2) default 0 not null,
  iva_detalle jsonb default '[]'::jsonb not null,
  total numeric(14,2) not null,
  observaciones text,
  condicion_pago text default 'contado'::text not null,
  estado text default 'emitido'::text not null,
  cae text,
  cae_vencimiento date,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.comprobantes add constraint comprobantes_pkey PRIMARY KEY (id);
alter table public.comprobantes add constraint comprobantes_tipo_punto_venta_numero_key UNIQUE (tipo, punto_venta, numero);

create table public.comprobantes_arca (
  id uuid default gen_random_uuid() not null,
  venta_id uuid not null,
  tipo text not null,
  punto_venta integer not null,
  numero bigint,
  cae text,
  cae_vencimiento date,
  estado text default 'pendiente'::text not null,
  pdf_url text,
  creado_en timestamp with time zone default now() not null
);
alter table public.comprobantes_arca add constraint comprobantes_arca_pkey PRIMARY KEY (id);

create table public.conteos (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid not null,
  sector text,
  estado text default 'abierto'::text not null,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.conteos add constraint conteos_pkey PRIMARY KEY (id);

create table public.conteos_items (
  conteo_id uuid not null,
  producto_id uuid not null,
  cantidad_contada numeric(12,3) not null,
  cantidad_sistema numeric(12,3) not null
);
alter table public.conteos_items add constraint conteos_items_pkey PRIMARY KEY (conteo_id, producto_id);

create table public.costos_historial (
  id bigint generated always as identity not null,
  proveedor_id uuid not null,
  producto_id uuid not null,
  costo numeric(14,2) not null,
  origen text,
  creado_en timestamp with time zone default now() not null
);
alter table public.costos_historial add constraint costos_historial_pkey PRIMARY KEY (id);

create table public.cuenta_corriente (
  id bigint generated always as identity not null,
  cliente_id uuid not null,
  comprobante_id uuid,
  concepto text not null,
  debe numeric(14,2) default 0 not null,
  haber numeric(14,2) default 0 not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.cuenta_corriente add constraint cuenta_corriente_pkey PRIMARY KEY (id);

create table public.descuentos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  alcance alcance_descuento not null,
  categoria_id uuid,
  marca_id uuid,
  producto_id uuid,
  tipo tipo_descuento not null,
  valor numeric(14,2) not null,
  desde timestamp with time zone not null,
  hasta timestamp with time zone not null,
  segmento tipo_cliente,
  medio_pago text,
  combinable boolean default false not null,
  activo boolean default true not null,
  creado_por uuid,
  creado_en timestamp with time zone default now() not null,
  solo_comunidad boolean default false not null
);
alter table public.descuentos add constraint descuentos_pkey PRIMARY KEY (id);
alter table public.descuentos add constraint descuentos_check CHECK ((hasta > desde));
alter table public.descuentos add constraint descuentos_check1 CHECK ((((alcance = 'global'::alcance_descuento) AND (categoria_id IS NULL) AND (marca_id IS NULL) AND (producto_id IS NULL)) OR ((alcance = 'categoria'::alcance_descuento) AND (categoria_id IS NOT NULL)) OR ((alcance = 'marca'::alcance_descuento) AND (marca_id IS NOT NULL)) OR ((alcance = 'producto'::alcance_descuento) AND (producto_id IS NOT NULL))));
alter table public.descuentos add constraint descuentos_valor_check CHECK ((valor > (0)::numeric));

create table public.difusiones (
  id uuid default gen_random_uuid() not null,
  titulo text not null,
  mensaje text not null,
  canal text default 'whatsapp'::text not null,
  segmento text,
  solo_comunidad boolean default false not null,
  audiencia integer default 0 not null,
  enviados integer default 0 not null,
  estado text default 'pendiente'::text not null,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.difusiones add constraint difusiones_pkey PRIMARY KEY (id);

create table public.estacionamientos (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid not null,
  numero integer not null,
  pedido_id uuid,
  ocupado boolean default false not null,
  asignado_en timestamp with time zone
);
alter table public.estacionamientos add constraint estacionamientos_pkey PRIMARY KEY (id);
alter table public.estacionamientos add constraint estacionamientos_sucursal_id_numero_key UNIQUE (sucursal_id, numero);

create table public.etiquetas_pendientes (
  id bigint generated always as identity not null,
  producto_id uuid not null,
  sucursal_id uuid not null,
  impresa boolean default false not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.etiquetas_pendientes add constraint etiquetas_pendientes_pkey PRIMARY KEY (id);

create table public.eventos (
  id uuid default gen_random_uuid() not null,
  cliente_id uuid,
  tipo tipo_evento default 'otro'::tipo_evento not null,
  nombre text not null,
  fecha date,
  invitados integer,
  estado estado_evento default 'prospecto'::estado_evento not null,
  presupuesto numeric default 0 not null,
  notas text,
  creado_por uuid,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null
);
alter table public.eventos add constraint eventos_pkey PRIMARY KEY (id);

create table public.eventos_items (
  id uuid default gen_random_uuid() not null,
  evento_id uuid not null,
  producto_id uuid,
  descripcion text not null,
  cantidad numeric default 1 not null,
  precio_unitario numeric default 0 not null
);
alter table public.eventos_items add constraint eventos_items_pkey PRIMARY KEY (id);

create table public.facturas_proveedor (
  id uuid default gen_random_uuid() not null,
  proveedor_id uuid not null,
  numero text not null,
  monto numeric(14,2) not null,
  vencimiento date,
  estado text default 'pendiente'::text not null,
  remito_id uuid,
  creado_en timestamp with time zone default now() not null,
  neto numeric,
  iva numeric,
  percepcion_iva numeric(14,2) not null default 0,
  percepcion_iibb numeric(14,2) not null default 0,
  otros_impuestos numeric(14,2) not null default 0,
  oc_id uuid
);
alter table public.facturas_proveedor add constraint facturas_proveedor_pkey PRIMARY KEY (id);

create table public.favoritos (
  cliente_id uuid not null,
  producto_id uuid not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.favoritos add constraint favoritos_pkey PRIMARY KEY (cliente_id, producto_id);

create table public.informes (
  id uuid default gen_random_uuid() not null,
  fecha date not null,
  datos jsonb not null,
  relato text not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.informes add constraint informes_pkey PRIMARY KEY (id);
alter table public.informes add constraint informes_fecha_key UNIQUE (fecha);

create table public.integraciones_log (
  id bigint generated always as identity not null,
  servicio text not null,
  direccion text not null,
  evento text,
  payload jsonb,
  exito boolean,
  error text,
  creado_en timestamp with time zone default now() not null
);
alter table public.integraciones_log add constraint integraciones_log_pkey PRIMARY KEY (id);

create table public.listas_precios (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  activa boolean default true not null
);
alter table public.listas_precios add constraint listas_precios_pkey PRIMARY KEY (id);

create table public.listas_proveedor (
  id uuid default gen_random_uuid() not null,
  proveedor_id uuid not null,
  archivo text,
  vigencia text,
  markup numeric(6,3) default 1.60 not null,
  items_total integer default 0 not null,
  items_match integer default 0 not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.listas_proveedor add constraint listas_proveedor_pkey PRIMARY KEY (id);

create table public.listas_proveedor_archivos (
  id uuid default gen_random_uuid() not null,
  proveedor_id uuid not null,
  archivo_url text not null,
  estado text default 'pendiente'::text not null,
  resultado jsonb,
  subido_por uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.listas_proveedor_archivos add constraint listas_proveedor_archivos_pkey PRIMARY KEY (id);

create table public.listas_proveedor_items (
  id uuid default gen_random_uuid() not null,
  lista_id uuid not null,
  codigo text,
  descripcion text not null,
  presentacion text,
  costo numeric(14,2),
  precio_sugerido numeric(14,2),
  producto_id uuid,
  sku text,
  creado_en timestamp with time zone default now() not null,
  ean text
);
alter table public.listas_proveedor_items add constraint listas_proveedor_items_pkey PRIMARY KEY (id);

create table public.lotes (
  id uuid default gen_random_uuid() not null,
  producto_id uuid not null,
  sucursal_id uuid not null,
  lote text not null,
  vencimiento date not null,
  cantidad numeric(12,3) default 0 not null
);
alter table public.lotes add constraint lotes_pkey PRIMARY KEY (id);

create table public.marcas (
  id uuid default gen_random_uuid() not null,
  nombre text not null
);
alter table public.marcas add constraint marcas_pkey PRIMARY KEY (id);
alter table public.marcas add constraint marcas_nombre_key UNIQUE (nombre);

create table public.movimientos_envase (
  id uuid default gen_random_uuid() not null,
  cliente_id uuid,
  tipo_id uuid not null,
  cantidad integer not null,
  motivo text,
  pedido_id uuid,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.movimientos_envase add constraint movimientos_envase_pkey PRIMARY KEY (id);

create table public.movimientos_stock (
  id bigint generated always as identity not null,
  producto_id uuid not null,
  sucursal_id uuid not null,
  tipo tipo_movimiento not null,
  cantidad numeric(12,3) not null,
  motivo text,
  referencia_tipo text,
  referencia_id text,
  lote text,
  usuario_id uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.movimientos_stock add constraint movimientos_stock_pkey PRIMARY KEY (id);

create table public.notas_cata (
  producto_id uuid not null,
  nota text,
  maridaje text,
  generado_en timestamp with time zone default now() not null
);
alter table public.notas_cata add constraint notas_cata_pkey PRIMARY KEY (producto_id);

create table public.notificaciones (
  id bigint generated always as identity not null,
  cliente_id uuid not null,
  titulo text not null,
  cuerpo text not null,
  leida boolean default false not null,
  creado_en timestamp with time zone default now() not null,
  tipo text default 'general'::text not null
);
alter table public.notificaciones add constraint notificaciones_pkey PRIMARY KEY (id);

create table public.numeradores (
  tipo tipo_comprobante not null,
  punto_venta integer not null,
  ultimo bigint default 0 not null
);
alter table public.numeradores add constraint numeradores_pkey PRIMARY KEY (tipo, punto_venta);

create table public.ordenes_compra (
  id uuid default gen_random_uuid() not null,
  numero bigint generated always as identity not null,
  proveedor_id uuid not null,
  sucursal_id uuid not null,
  estado estado_oc default 'borrador'::estado_oc not null,
  total numeric(14,2) default 0 not null,
  origen text default 'manual'::text not null,
  creada_por uuid,
  creado_en timestamp with time zone default now() not null,
  fecha_entrega date,
  condicion_pago text,
  vencimiento_pago date,
  observaciones text,
  descuento numeric default 0 not null,
  aprobada_por uuid,
  aprobada_en timestamp with time zone,
  rechazo_motivo text
);
alter table public.ordenes_compra add constraint ordenes_compra_pkey PRIMARY KEY (id);

create table public.ordenes_compra_items (
  oc_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12,3) not null,
  costo_unitario numeric(14,2) not null,
  cantidad_recibida numeric(12,3) default 0 not null
);
alter table public.ordenes_compra_items add constraint ordenes_compra_items_pkey PRIMARY KEY (oc_id, producto_id);

create table public.ordenes_pago (
  id uuid default gen_random_uuid() not null,
  numero bigint generated always as identity not null,
  proveedor_id uuid not null,
  estado text default 'pendiente_aprobacion'::text not null,
  total numeric(14,2) not null,
  medio_pago text,
  creada_por uuid,
  pagada_en timestamp with time zone,
  creado_en timestamp with time zone default now() not null,
  vencimiento date,
  fecha_programada date,
  observaciones text,
  aprobada_por uuid,
  aprobada_en timestamp with time zone,
  rechazo_motivo text
);
alter table public.ordenes_pago add constraint ordenes_pago_pkey PRIMARY KEY (id);

create table public.ordenes_pago_items (
  orden_pago_id uuid not null,
  factura_id uuid not null,
  monto numeric(14,2) not null
);
alter table public.ordenes_pago_items add constraint ordenes_pago_items_pkey PRIMARY KEY (orden_pago_id, factura_id);

create table public.pagos (
  id uuid default gen_random_uuid() not null,
  venta_id uuid not null,
  medio text not null,
  monto numeric(14,2) not null,
  mp_payment_id text,
  creado_en timestamp with time zone default now() not null
);
alter table public.pagos add constraint pagos_pkey PRIMARY KEY (id);

create table public.pedidos (
  id uuid default gen_random_uuid() not null,
  cliente_id uuid,
  canal canal_venta not null,
  sucursal_id uuid not null,
  estado estado_pedido default 'recibido'::estado_pedido not null,
  total numeric(14,2) not null,
  eta_minutos integer,
  preparar_desde timestamp with time zone,
  qr_retiro text,
  tiendanube_order_id bigint,
  creado_en timestamp with time zone default now() not null,
  listo_en timestamp with time zone,
  entregado_en timestamp with time zone,
  preparacion_en timestamp with time zone,
  preparado_por uuid,
  entregado_por uuid,
  cliente_lat double precision,
  cliente_lng double precision,
  distancia_m integer,
  estacionamiento integer,
  llego_en timestamp with time zone,
  destino_direccion text,
  destino_lat double precision,
  destino_lng double precision,
  repartidor_id uuid,
  repartidor_lat double precision,
  repartidor_lng double precision,
  repartidor_en timestamp with time zone,
  en_camino_en timestamp with time zone,
  venta_id uuid,
  reserva_stock boolean default true not null
);
alter table public.pedidos add constraint pedidos_pkey PRIMARY KEY (id);
alter table public.pedidos add constraint pedidos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);

create table public.pedidos_items (
  pedido_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12,3) not null,
  precio_unitario numeric(14,2) not null
);
alter table public.pedidos_items add constraint pedidos_items_pkey PRIMARY KEY (pedido_id, producto_id);

create table public.precios (
  id uuid default gen_random_uuid() not null,
  lista_id uuid not null,
  producto_id uuid not null,
  precio numeric(14,2) not null,
  vigente_desde timestamp with time zone default now() not null,
  creado_por uuid
);
alter table public.precios add constraint precios_pkey PRIMARY KEY (id);

create table public.productos (
  id uuid default gen_random_uuid() not null,
  sku text not null,
  nombre text not null,
  descripcion text,
  marca_id uuid,
  categoria_id uuid,
  volumen_ml integer,
  unidades_pack integer default 1 not null,
  graduacion numeric(4,1),
  es_alcohol boolean default false not null,
  costo numeric(14,2),
  controla_vencimiento boolean default false not null,
  tiendanube_id bigint,
  activo boolean default true not null,
  creado_en timestamp with time zone default now() not null,
  nombre_normalizado text generated always as (quitar_tildes(nombre)) stored,
  alicuota_iva numeric(4,2) default 21 not null,
  codigo_legacy text
);
alter table public.productos add constraint productos_pkey PRIMARY KEY (id);
alter table public.productos add constraint productos_codigo_legacy_key UNIQUE (codigo_legacy);
alter table public.productos add constraint productos_sku_key UNIQUE (sku);

create table public.promociones (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  tipo text not null,
  config jsonb not null,
  desde timestamp with time zone not null,
  hasta timestamp with time zone not null,
  activa boolean default true not null
);
alter table public.promociones add constraint promociones_pkey PRIMARY KEY (id);

create table public.proveedor_productos (
  proveedor_id uuid not null,
  producto_id uuid not null,
  codigo_proveedor text,
  ultimo_costo numeric(14,2),
  actualizado_en timestamp with time zone
);
alter table public.proveedor_productos add constraint proveedor_productos_pkey PRIMARY KEY (proveedor_id, producto_id);

create table public.proveedores (
  id uuid default gen_random_uuid() not null,
  razon_social text not null,
  cuit text,
  condicion_pago text,
  lead_time_dias integer default 7 not null,
  email text,
  telefono text,
  activo boolean default true not null,
  descuento_efectivo numeric(5,2) default 0 not null
);
alter table public.proveedores add constraint proveedores_pkey PRIMARY KEY (id);
alter table public.proveedores add constraint proveedores_cuit_key UNIQUE (cuit);

create table public.puntos_movimientos (
  id bigint generated always as identity not null,
  cliente_id uuid not null,
  puntos integer not null,
  concepto text not null,
  referencia text,
  creado_en timestamp with time zone default now() not null
);
alter table public.puntos_movimientos add constraint puntos_movimientos_pkey PRIMARY KEY (id);

create table public.recibo_imputaciones (
  id bigint generated always as identity not null,
  recibo_id uuid not null,
  factura_id uuid not null,
  importe numeric not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.recibo_imputaciones add constraint recibo_imputaciones_pkey PRIMARY KEY (id);
alter table public.recibo_imputaciones add constraint recibo_imputaciones_importe_check CHECK ((importe > (0)::numeric));

create table public.recibo_medios (
  id bigint generated always as identity not null,
  recibo_id uuid not null,
  medio text not null,
  importe numeric not null,
  cheque_id uuid,
  referencia text,
  creado_en timestamp with time zone default now() not null
);
alter table public.recibo_medios add constraint recibo_medios_pkey PRIMARY KEY (id);
alter table public.recibo_medios add constraint recibo_medios_importe_check CHECK ((importe > (0)::numeric));
alter table public.recibo_medios add constraint recibo_medios_medio_check CHECK ((medio = ANY (ARRAY['efectivo'::text, 'transferencia'::text, 'cheque'::text, 'tarjeta'::text, 'deposito'::text, 'retencion'::text, 'nota_credito'::text])));

create table public.referidos (
  id uuid default gen_random_uuid() not null,
  referrer_id uuid not null,
  referido_id uuid not null,
  puntos_referrer integer default 500 not null,
  puntos_referido integer default 300 not null,
  estado text default 'pendiente'::text not null,
  creado_en timestamp with time zone default now() not null,
  acreditado_en timestamp with time zone
);
alter table public.referidos add constraint referidos_pkey PRIMARY KEY (id);
alter table public.referidos add constraint referidos_referido_id_key UNIQUE (referido_id);

create table public.remitos (
  id uuid default gen_random_uuid() not null,
  proveedor_id uuid not null,
  oc_id uuid,
  sucursal_id uuid not null,
  numero text,
  archivo_url text,
  estado text default 'pendiente'::text not null,
  resultado_ia jsonb,
  confirmado_por uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.remitos add constraint remitos_pkey PRIMARY KEY (id);

create table public.remitos_items (
  remito_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12,3) not null,
  lote text,
  vencimiento date
);
alter table public.remitos_items add constraint remitos_items_pkey PRIMARY KEY (remito_id, producto_id);

create table public.repartidor_posicion (
  repartidor_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  reparto_id uuid,
  actualizado_en timestamp with time zone default now() not null
);
alter table public.repartidor_posicion add constraint repartidor_posicion_pkey PRIMARY KEY (repartidor_id);

create table public.repartos (
  id uuid default gen_random_uuid() not null,
  numero bigint default nextval('repartos_numero_seq'::regclass) not null,
  fecha date default CURRENT_DATE not null,
  chofer_id uuid,
  zona text,
  estado text default 'armado'::text not null,
  observaciones text,
  total_estimado numeric default 0 not null,
  total_cobrado numeric default 0 not null,
  efectivo numeric default 0 not null,
  devoluciones numeric default 0 not null,
  creado_por uuid,
  creado_en timestamp with time zone default now() not null,
  salio_en timestamp with time zone,
  rendido_en timestamp with time zone
);
alter table public.repartos add constraint repartos_pkey PRIMARY KEY (id);
alter sequence repartos_numero_seq owned by public.repartos.numero;

create table public.repartos_paradas (
  id uuid default gen_random_uuid() not null,
  reparto_id uuid not null,
  cliente_id uuid,
  cliente_nombre text,
  orden integer default 0 not null,
  estado text default 'pendiente'::text not null,
  monto numeric default 0 not null,
  cobrado numeric default 0 not null,
  medio_pago text,
  observacion text,
  creado_en timestamp with time zone default now() not null
);
alter table public.repartos_paradas add constraint repartos_paradas_pkey PRIMARY KEY (id);

create table public.sesiones_caja (
  id uuid default gen_random_uuid() not null,
  caja_id uuid not null,
  usuario_id uuid not null,
  monto_inicial numeric(14,2) not null,
  monto_cierre numeric(14,2),
  diferencia numeric(14,2),
  abierta_en timestamp with time zone default now() not null,
  cerrada_en timestamp with time zone,
  cerrada_por uuid
);
alter table public.sesiones_caja add constraint sesiones_caja_pkey PRIMARY KEY (id);

create table public.solicitudes (
  id uuid default gen_random_uuid() not null,
  cliente_id uuid not null,
  tipo tipo_solicitud default 'consulta'::tipo_solicitud not null,
  asunto text not null,
  mensaje text not null,
  estado estado_solicitud default 'abierta'::estado_solicitud not null,
  respuesta text,
  respondido_por uuid,
  respondido_en timestamp with time zone,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null
);
alter table public.solicitudes add constraint solicitudes_pkey PRIMARY KEY (id);

create table public.stock (
  producto_id uuid not null,
  sucursal_id uuid not null,
  cantidad numeric(12,3) default 0 not null,
  stock_minimo numeric(12,3) default 0 not null,
  punto_reposicion numeric(12,3) default 0 not null
);
alter table public.stock add constraint stock_pkey PRIMARY KEY (producto_id, sucursal_id);

create table public.sucursales (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  direccion text,
  lat double precision,
  lng double precision,
  punto_venta_arca integer,
  activa boolean default true not null,
  pickup boolean default false not null
);
alter table public.sucursales add constraint sucursales_pkey PRIMARY KEY (id);

create table public.sync_runs (
  id bigint generated always as identity not null,
  corrida_en timestamp with time zone default now() not null,
  duracion_ms integer,
  productos_leidos integer default 0,
  productos_actualizados integer default 0,
  clientes_leidos integer default 0,
  clientes_actualizados integer default 0,
  ok boolean default true not null,
  error text,
  origen text default 'bridge'::text
);
alter table public.sync_runs add constraint sync_runs_pkey PRIMARY KEY (id);

create table public.tipos_envase (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  valor numeric default 0 not null,
  activo boolean default true not null,
  creado_en timestamp with time zone default now() not null
);
alter table public.tipos_envase add constraint tipos_envase_pkey PRIMARY KEY (id);

create table public.transferencias (
  id uuid default gen_random_uuid() not null,
  sucursal_origen_id uuid not null,
  sucursal_destino_id uuid not null,
  estado text default 'pendiente'::text not null,
  creada_por uuid,
  recibida_por uuid,
  creado_en timestamp with time zone default now() not null
);
alter table public.transferencias add constraint transferencias_pkey PRIMARY KEY (id);

create table public.transferencias_items (
  transferencia_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12,3) not null
);
alter table public.transferencias_items add constraint transferencias_items_pkey PRIMARY KEY (transferencia_id, producto_id);

create table public.usuarios (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  email text not null,
  rol rol_usuario not null,
  sucursal_id uuid,
  pin_firma text,
  limite_aprobacion numeric(14,2) default 0,
  activo boolean default true not null,
  creado_en timestamp with time zone default now() not null,
  clave_hash text
);
alter table public.usuarios add constraint usuarios_pkey PRIMARY KEY (id);
alter table public.usuarios add constraint usuarios_email_key UNIQUE (email);

create table public.ventas (
  id uuid not null,
  sucursal_id uuid not null,
  sesion_caja_id uuid,
  cliente_id uuid,
  canal canal_venta default 'mostrador'::canal_venta not null,
  estado text default 'completada'::text not null,
  subtotal numeric(14,2) not null,
  descuento numeric(14,2) default 0 not null,
  total numeric(14,2) not null,
  pedido_id uuid,
  vendida_en timestamp with time zone default now() not null,
  sincronizada_en timestamp with time zone
);
alter table public.ventas add constraint ventas_pkey PRIMARY KEY (id);

create table public.ventas_items (
  venta_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12,3) not null,
  precio_unitario numeric(14,2) not null,
  costo_unitario numeric(14,2),
  promocion_id uuid
);
alter table public.ventas_items add constraint ventas_items_pkey PRIMARY KEY (venta_id, producto_id);

-- =============================================================
-- FOREIGN KEYS (132) — al final para independizar el orden de creación
-- =============================================================

alter table public.acreditaciones add constraint acreditaciones_conciliado_por_fkey FOREIGN KEY (conciliado_por) REFERENCES usuarios(id);
alter table public.acreditaciones add constraint acreditaciones_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE;
alter table public.acreditaciones add constraint acreditaciones_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
alter table public.agente_auditoria add constraint agente_auditoria_tarea_id_fkey FOREIGN KEY (tarea_id) REFERENCES agente_tareas(id) ON DELETE CASCADE;
alter table public.agente_tareas add constraint agente_tareas_resuelta_por_fkey FOREIGN KEY (resuelta_por) REFERENCES usuarios(id);
alter table public.aprobaciones add constraint aprobaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.auditoria add constraint auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.avisos_reposicion add constraint avisos_reposicion_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.avisos_reposicion add constraint avisos_reposicion_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public.cajas add constraint cajas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.caja_movimientos add constraint caja_movimientos_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES sesiones_caja(id);
alter table public.caja_movimientos add constraint caja_movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.canjes add constraint canjes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.categorias add constraint categorias_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES categorias(id);
alter table public.cheques add constraint cheques_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.cheques add constraint cheques_orden_pago_id_fkey FOREIGN KEY (orden_pago_id) REFERENCES ordenes_pago(id);
alter table public.cheques add constraint cheques_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.cheques add constraint cheques_recibo_id_fkey FOREIGN KEY (recibo_id) REFERENCES comprobantes(id);
alter table public.cheques add constraint cheques_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.clientes add constraint clientes_referido_por_fkey FOREIGN KEY (referido_por) REFERENCES clientes(id);
alter table public.codigos_barras add constraint codigos_barras_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.compra_facil_pendientes add constraint compra_facil_pendientes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.comprobantes add constraint comprobantes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.comprobantes add constraint comprobantes_referencia_id_fkey FOREIGN KEY (referencia_id) REFERENCES comprobantes(id);
alter table public.comprobantes add constraint comprobantes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.comprobantes add constraint comprobantes_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
alter table public.comprobantes_arca add constraint comprobantes_arca_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
alter table public.conteos add constraint conteos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.conteos add constraint conteos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.conteos_items add constraint conteos_items_conteo_id_fkey FOREIGN KEY (conteo_id) REFERENCES conteos(id);
alter table public.conteos_items add constraint conteos_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.costos_historial add constraint costos_historial_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.costos_historial add constraint costos_historial_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.cuenta_corriente add constraint cuenta_corriente_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.cuenta_corriente add constraint cuenta_corriente_comprobante_id_fkey FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id);
alter table public.descuentos add constraint descuentos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias(id);
alter table public.descuentos add constraint descuentos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
alter table public.descuentos add constraint descuentos_marca_id_fkey FOREIGN KEY (marca_id) REFERENCES marcas(id);
alter table public.descuentos add constraint descuentos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.difusiones add constraint difusiones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.estacionamientos add constraint estacionamientos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL;
alter table public.estacionamientos add constraint estacionamientos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE;
alter table public.etiquetas_pendientes add constraint etiquetas_pendientes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.etiquetas_pendientes add constraint etiquetas_pendientes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.eventos add constraint eventos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
alter table public.eventos add constraint eventos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
alter table public.eventos_items add constraint eventos_items_evento_id_fkey FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE;
alter table public.eventos_items add constraint eventos_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
alter table public.facturas_proveedor add constraint facturas_proveedor_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id);
alter table public.facturas_proveedor add constraint facturas_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.facturas_proveedor add constraint facturas_proveedor_remito_id_fkey FOREIGN KEY (remito_id) REFERENCES remitos(id);
alter table public.favoritos add constraint favoritos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.favoritos add constraint favoritos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public.listas_proveedor add constraint listas_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
alter table public.listas_proveedor_archivos add constraint listas_proveedor_archivos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.listas_proveedor_archivos add constraint listas_proveedor_archivos_subido_por_fkey FOREIGN KEY (subido_por) REFERENCES usuarios(id);
alter table public.listas_proveedor_items add constraint listas_proveedor_items_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES listas_proveedor(id) ON DELETE CASCADE;
alter table public.listas_proveedor_items add constraint listas_proveedor_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.lotes add constraint lotes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.lotes add constraint lotes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.movimientos_envase add constraint movimientos_envase_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.movimientos_envase add constraint movimientos_envase_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES tipos_envase(id);
alter table public.movimientos_stock add constraint movimientos_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.movimientos_stock add constraint movimientos_stock_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.movimientos_stock add constraint movimientos_stock_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.notas_cata add constraint notas_cata_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public.notificaciones add constraint notificaciones_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.ordenes_compra add constraint ordenes_compra_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES usuarios(id);
alter table public.ordenes_compra add constraint ordenes_compra_creada_por_fkey FOREIGN KEY (creada_por) REFERENCES usuarios(id);
alter table public.ordenes_compra add constraint ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.ordenes_compra add constraint ordenes_compra_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.ordenes_compra_items add constraint ordenes_compra_items_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id);
alter table public.ordenes_compra_items add constraint ordenes_compra_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.ordenes_pago add constraint ordenes_pago_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES usuarios(id);
alter table public.ordenes_pago add constraint ordenes_pago_creada_por_fkey FOREIGN KEY (creada_por) REFERENCES usuarios(id);
alter table public.ordenes_pago add constraint ordenes_pago_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.ordenes_pago_items add constraint ordenes_pago_items_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES facturas_proveedor(id);
alter table public.ordenes_pago_items add constraint ordenes_pago_items_orden_pago_id_fkey FOREIGN KEY (orden_pago_id) REFERENCES ordenes_pago(id);
alter table public.pagos add constraint pagos_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
alter table public.pedidos add constraint pedidos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.pedidos add constraint pedidos_entregado_por_fkey FOREIGN KEY (entregado_por) REFERENCES usuarios(id);
alter table public.pedidos add constraint pedidos_preparado_por_fkey FOREIGN KEY (preparado_por) REFERENCES usuarios(id);
alter table public.pedidos add constraint pedidos_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES usuarios(id);
alter table public.pedidos add constraint pedidos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.pedidos_items add constraint pedidos_items_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
alter table public.pedidos_items add constraint pedidos_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.precios add constraint precios_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
alter table public.precios add constraint precios_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES listas_precios(id);
alter table public.precios add constraint precios_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.productos add constraint productos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias(id);
alter table public.productos add constraint productos_marca_id_fkey FOREIGN KEY (marca_id) REFERENCES marcas(id);
alter table public.proveedor_productos add constraint proveedor_productos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.proveedor_productos add constraint proveedor_productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.puntos_movimientos add constraint puntos_movimientos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.recibo_imputaciones add constraint recibo_imputaciones_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES comprobantes(id);
alter table public.recibo_imputaciones add constraint recibo_imputaciones_recibo_id_fkey FOREIGN KEY (recibo_id) REFERENCES comprobantes(id) ON DELETE CASCADE;
alter table public.recibo_medios add constraint recibo_medios_cheque_id_fkey FOREIGN KEY (cheque_id) REFERENCES cheques(id);
alter table public.recibo_medios add constraint recibo_medios_recibo_id_fkey FOREIGN KEY (recibo_id) REFERENCES comprobantes(id) ON DELETE CASCADE;
alter table public.referidos add constraint referidos_referido_id_fkey FOREIGN KEY (referido_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.referidos add constraint referidos_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.remitos add constraint remitos_confirmado_por_fkey FOREIGN KEY (confirmado_por) REFERENCES usuarios(id);
alter table public.remitos add constraint remitos_oc_id_fkey FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id);
alter table public.remitos add constraint remitos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.remitos add constraint remitos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.remitos_items add constraint remitos_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.remitos_items add constraint remitos_items_remito_id_fkey FOREIGN KEY (remito_id) REFERENCES remitos(id);
alter table public.repartidor_posicion add constraint repartidor_posicion_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES usuarios(id);
alter table public.repartidor_posicion add constraint repartidor_posicion_reparto_id_fkey FOREIGN KEY (reparto_id) REFERENCES repartos(id);
alter table public.repartos add constraint repartos_chofer_id_fkey FOREIGN KEY (chofer_id) REFERENCES usuarios(id);
alter table public.repartos add constraint repartos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
alter table public.repartos_paradas add constraint repartos_paradas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.repartos_paradas add constraint repartos_paradas_reparto_id_fkey FOREIGN KEY (reparto_id) REFERENCES repartos(id) ON DELETE CASCADE;
alter table public.sesiones_caja add constraint sesiones_caja_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES cajas(id);
alter table public.sesiones_caja add constraint sesiones_caja_cerrada_por_fkey FOREIGN KEY (cerrada_por) REFERENCES usuarios(id);
alter table public.sesiones_caja add constraint sesiones_caja_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.solicitudes add constraint solicitudes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
alter table public.solicitudes add constraint solicitudes_respondido_por_fkey FOREIGN KEY (respondido_por) REFERENCES usuarios(id);
alter table public.stock add constraint stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.stock add constraint stock_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.transferencias add constraint transferencias_creada_por_fkey FOREIGN KEY (creada_por) REFERENCES usuarios(id);
alter table public.transferencias add constraint transferencias_recibida_por_fkey FOREIGN KEY (recibida_por) REFERENCES usuarios(id);
alter table public.transferencias add constraint transferencias_sucursal_destino_id_fkey FOREIGN KEY (sucursal_destino_id) REFERENCES sucursales(id);
alter table public.transferencias add constraint transferencias_sucursal_origen_id_fkey FOREIGN KEY (sucursal_origen_id) REFERENCES sucursales(id);
alter table public.transferencias_items add constraint transferencias_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.transferencias_items add constraint transferencias_items_transferencia_id_fkey FOREIGN KEY (transferencia_id) REFERENCES transferencias(id);
alter table public.usuarios add constraint usuarios_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.ventas add constraint ventas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
alter table public.ventas add constraint ventas_sesion_caja_id_fkey FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id);
alter table public.ventas add constraint ventas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.ventas_items add constraint ventas_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.ventas_items add constraint ventas_items_promocion_id_fkey FOREIGN KEY (promocion_id) REFERENCES promociones(id);
alter table public.ventas_items add constraint ventas_items_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);

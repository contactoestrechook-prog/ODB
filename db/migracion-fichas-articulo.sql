-- ============================================================
-- LA FICHA DEL ARTÍCULO DEL PROVEEDOR (11/11/2026)
-- Leandro: «memoria para cada proveedor … para que no falle más».
--
-- Del 5 al 10/11, 64 % de los 285 cambios hechos a una factura antes de
-- registrarla fueron de lo mismo: cómo viene y cómo entra cada producto (cajas,
-- unidades por bulto, sueltas, kilos, «entra como»). Ese dato quedaba escrito
-- en cada factura registrada (compras_historial), pero la factura siguiente no
-- lo iba a buscar: el Danbo en horma de La Serenísima entró el 3/11 como 6
-- unidades y el 5/11 como 21 kilos.
--
-- Una fila por artículo de cada proveedor, con lo último que una persona
-- confirmó al registrar. La carga por foto la aplica sola al abrir la factura,
-- solo si la cuenta del renglón sigue cerrando.
-- ============================================================
create table if not exists proveedor_articulos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id) on delete cascade,
  -- la descripción del papel, normalizada (mayúsculas, sin acentos ni signos)
  clave text not null,
  descripcion text not null,
  codigo_proveedor text,
  producto_id uuid references productos(id) on delete set null,
  -- la columna Cantidad del papel cuenta bultos o unidades sueltas
  cuenta_en text not null check (cuenta_en in ('bultos', 'sueltas')),
  unidades_por_bulto numeric,
  entra_como text not null check (entra_como in ('unidades', 'cajas', 'abiertas', 'peso')),
  -- cajas de N / abiertas de N
  entra_de numeric,
  -- cuánto entra al stock por cada 1 de la columna Cantidad (kilos si va por peso).
  -- null: va por peso y el papel ya trae los kilos, no hay nada que aplicar.
  factor numeric,
  -- cuánto entra por cada unidad del papel (bultos × lo que trae cada uno, o las sueltas)
  por_unidad numeric,
  -- lo que costó cada unidad de stock la última vez, neto: para elegir entre dos
  -- lecturas del mismo papel (1 caja a precio de caja / 36 a precio de unidad)
  costo_neto numeric,
  -- registros seguidos que coinciden en esta presentación
  veces integer not null default 1,
  ultima_factura text,
  ultima_fecha date,
  ultima_lectura uuid,
  origen text not null default 'registro',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (proveedor_id, clave)
);
create index if not exists proveedor_articulos_producto on proveedor_articulos (proveedor_id, producto_id);

-- Solo la API (service role): sin políticas y sin permisos para anon ni authenticated.
alter table proveedor_articulos enable row level security;
revoke all on proveedor_articulos from public, anon, authenticated;

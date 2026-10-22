-- ============================================================
-- HISTORIAL DE VENTAS DEL SISTEMA VIEJO CON PLATA (21/10/2026) — OPCIONAL, NO APLICADA
--
-- Para dejar de usar el sistema viejo sin perder sus informes. ventas_historicas
-- ya existe y alcanza para el sugerido de compra (abastecimiento), estadísticas y
-- el orden de la tienda: guarda UNIDADES por producto, sucursal y período. La
-- exportación del 21/10 trae además el importe y el medio de pago de cada
-- renglón (474.502 renglones, $4.999 M en el año). Esta migración agrega:
--   1) ventas_historicas.importe y .renglones: la plata y la cantidad de
--      renglones de cada producto en el período (nadie los lee todavía: las
--      pantallas siguen con las unidades; quedan para informes);
--   2) ventas_historicas_medios: comprobantes e importe por período y medio de
--      pago (contado, tarjeta, Mercado Pago, cuenta corriente…);
--   3) un índice para que la carga sea idempotente sin recorrer la tabla.
-- Nada de esto toca ventas, ventas_items ni pagos (las ventas reales de ODB).
-- scripts/sistema-viejo/exportacion/aplicar/historial.sql la detecta: si está
-- aplicada guarda importes y medios; si no, solo unidades.
-- ============================================================

alter table public.ventas_historicas
  add column if not exists importe numeric(14,2),
  add column if not exists renglones integer;

create index if not exists ventas_historicas_origen_idx
  on public.ventas_historicas (origen, sucursal_id, codigo_legacy, desde, hasta);

create table if not exists public.ventas_historicas_medios (
  id bigint generated always as identity primary key,
  sucursal_id uuid not null references public.sucursales(id),
  desde date not null,
  hasta date not null,
  medio_pago text not null,
  comprobantes integer not null default 0,
  importe numeric(14,2) not null default 0,
  origen text not null,
  creado_en timestamptz not null default now(),
  unique (origen, sucursal_id, desde, hasta, medio_pago)
);
-- solo la API (service role) la lee
alter table public.ventas_historicas_medios enable row level security;

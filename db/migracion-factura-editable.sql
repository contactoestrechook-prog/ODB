-- ============================================================
-- FACTURA EDITABLE (8/10/2026, pedido de Leandro)
--
-- La carga de facturas por foto muestra la factura como una tabla editable,
-- con la cuenta de cada renglón en vivo y un chat con IA que corrige la tabla.
-- Dos tablas nuevas:
--
-- 1. proveedor_reglas_lectura: lo que administración le explica a la IA sobre
--    un proveedor y sirve para las próximas facturas («en Oxxon, UxB son las
--    unidades por bulto y el precio es por unidad»). Quién la guardó y cuándo;
--    se desactiva, no se borra.
-- 2. compras_revisiones: quién cambió qué en la tabla antes de registrar (la
--    persona o la IA, con el motivo), por lectura. Es la constancia de «quién
--    hizo cada cosa» de la carga.
--
-- Sin políticas de RLS: las lee y escribe solo la API (service role).
-- ============================================================

create table if not exists public.proveedor_reglas_lectura (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  regla text not null check (length(btrim(regla)) between 3 and 300),
  activa boolean not null default true,
  creada_por uuid references public.usuarios(id),
  creada_en timestamptz not null default now(),
  desactivada_por uuid references public.usuarios(id),
  desactivada_en timestamptz
);
create index if not exists proveedor_reglas_lectura_activas
  on public.proveedor_reglas_lectura (proveedor_id, creada_en) where activa;
alter table public.proveedor_reglas_lectura enable row level security;

create table if not exists public.compras_revisiones (
  id uuid primary key default gen_random_uuid(),
  lectura_id uuid references public.lecturas_comprobante(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  numero text,
  usuario_id uuid references public.usuarios(id),
  cambios jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists compras_revisiones_lectura on public.compras_revisiones (lectura_id);
alter table public.compras_revisiones enable row level security;

revoke all on public.proveedor_reglas_lectura from anon, authenticated;
revoke all on public.compras_revisiones from anon, authenticated;

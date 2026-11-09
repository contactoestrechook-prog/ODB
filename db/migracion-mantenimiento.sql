-- ============================================================================
-- MANTENIMIENTO (Leandro, 9/11/2026: «6 horas de programación de mantenimiento
-- mensuales… qué hicimos, sobre qué trabajamos, qué se mejoró, si fueron
-- arreglos, bugs, propuestas o mejoras, quién las pidió, cuándo y todo»).
--
-- Una fila por cada trabajo publicado en producción (un commit de main). La
-- carga scripts/mantenimiento-sync.mjs, que corre solo al final de cada
-- publicación (scripts/publicar.sh): lee el historial de git, saca de cada
-- mensaje quién lo pidió, cuándo y con qué palabras, lo clasifica y estima el
-- tiempo por las sesiones de trabajo de ese día.
--
-- La lee solo la API (service role). Sin políticas: anon y authenticated no ven
-- nada (regla de seguridad del 5/11/2026).
-- ============================================================================

create table if not exists public.mantenimiento_trabajos (
  hash text primary key,                -- el commit (corto en pantalla)
  publicado_en timestamptz not null,    -- cuándo se hizo el commit
  mes text not null,                    -- 'AAAA-MM' (hora argentina), para agrupar
  tipo text not null check (tipo in ('bug', 'arreglo', 'mejora', 'nuevo', 'propuesta')),
  area text not null,                   -- Compras, Caja, Pedidos, Bot de WhatsApp…
  titulo text not null,                 -- corto, para la lista
  que_se_hizo text not null,            -- una o dos frases para el dueño
  para_que text,                        -- qué gana el negocio
  pidio text,                           -- quién lo pidió (null = propuesta de MetoGroup)
  pedido_el date,                       -- la fecha que figura en el pedido
  cita text,                            -- sus palabras, tal cual
  mensaje text not null,                -- el mensaje completo del commit
  minutos integer not null default 0 check (minutos >= 0),
  partes text[] not null default '{}',  -- panel, api, tienda, app, base, servidor
  archivos integer not null default 0,
  lineas integer not null default 0,
  creado_en timestamptz not null default now()
);

create index if not exists mantenimiento_trabajos_mes on public.mantenimiento_trabajos (mes, publicado_en desc);

alter table public.mantenimiento_trabajos enable row level security;
revoke all on public.mantenimiento_trabajos from anon, authenticated;

-- ============================================================================
-- COTIZACIONES de horas extra (Leandro, 9/11/2026: «cuando se pasa las 6 horas,
-- se cotiza aparte y lo tienen que aprobar ellos. Por sistema también»).
-- La automática del mes la crea y la actualiza scripts/mantenimiento-sync.mjs
-- cuando lo publicado pasa el abono; las que se cotizan antes de hacer un
-- trabajo grande se cargan a mano (automatica = false). El dueño las firma en
-- Aprobaciones o en Mantenimiento.
-- ============================================================================
create table if not exists public.mantenimiento_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  mes text not null,                    -- 'AAAA-MM' al que corresponden las horas
  titulo text not null,
  detalle text,
  horas numeric(6,1) not null check (horas > 0),
  precio_hora numeric(14,2),            -- null: se muestra «valor hora a confirmar»
  moneda text not null default 'ARS',
  automatica boolean not null default false,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  creada_en timestamptz not null default now(),
  decidida_por uuid references public.usuarios(id),
  decidida_en timestamptz,
  motivo text
);
create index if not exists mantenimiento_cotizaciones_mes on public.mantenimiento_cotizaciones (mes, creada_en);
-- una sola automática pendiente por mes: si siguen sumándose horas, crece esa
create unique index if not exists mantenimiento_cotizaciones_una_pendiente_auto on public.mantenimiento_cotizaciones (mes) where automatica and estado = 'pendiente';
alter table public.mantenimiento_cotizaciones enable row level security;
revoke all on public.mantenimiento_cotizaciones from anon, authenticated;

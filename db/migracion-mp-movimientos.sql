-- MERCADO PAGO · LA PLATA REAL (Leandro, 5/11/2026: «sí, ok» a sumar a La plata
-- los retiros al banco y los descuentos con el reporte de liberaciones).
-- El reporte de liberaciones de Mercado Pago (release_report) es el extracto de
-- la cuenta: cada peso que se libera, cada retiro (payout), cada pago hecho con
-- la plata de la cuenta, devoluciones, contracargos y el saldo. La API lo pide
-- sola, lo baja y lo guarda acá.
--   - mp_reportes: cada reporte pedido a MP (período, archivo, si ya se leyó).
--   - mp_movimientos: una fila por línea del reporte. El id es una huella de la
--     línea: leer dos reportes que se pisan no duplica nada. «saldo» es el saldo
--     disponible después de la línea (lo da MP o se calcula desde el saldo inicial).
--   - mp_movimientos_dias(): lo de cada día por tipo de movimiento, sin las
--     reservas internas (reserve_for_*), que entran y salen por el mismo monto.
-- Configurado el reporte en Santa Inés el 5/11 (ODB ya lo tenía desde 2021).
-- Solo lectura de Mercado Pago. Aditiva. APLICADA en producción el 5/11/2026
-- (migraciones mp_movimientos y mp_movimientos_orden).

create table if not exists public.mp_reportes (
  id text primary key,                         -- id del reporte en MP
  cuenta text not null,
  desde timestamptz not null,
  hasta timestamptz not null,
  archivo text,
  estado text not null default 'pedido' check (estado in ('pedido', 'leido', 'error')),
  lineas int,
  error text,
  pedido_en timestamptz not null default now(),
  leido_en timestamptz
);
create index if not exists mp_reportes_cuenta on public.mp_reportes (cuenta, hasta desc);

create table if not exists public.mp_movimientos (
  id text primary key,                         -- md5 de cuenta + línea del reporte
  cuenta text not null,
  fecha timestamptz not null,
  source_id text,
  descripcion text not null,                   -- payment, payout, refund, chargeback, initial_available_balance…
  credito numeric(14,2) not null default 0,
  debito numeric(14,2) not null default 0,
  bruto numeric(14,2),
  comision numeric(14,2),
  impuestos numeric(14,2),
  medio text,
  saldo numeric(14,2),
  orden int,                                   -- lugar de la línea en su reporte
  reporte_id text references public.mp_reportes(id),
  guardado_en timestamptz not null default now()
);
create index if not exists mp_movimientos_cuenta_fecha on public.mp_movimientos (cuenta, fecha);
create index if not exists mp_movimientos_descripcion on public.mp_movimientos (descripcion, fecha);

alter table public.mp_reportes enable row level security;
alter table public.mp_movimientos enable row level security;

create or replace function public.mp_movimientos_dias(p_desde date, p_hasta date, p_cuenta text default null)
returns table (dia date, cuenta text, descripcion text, movimientos int, credito numeric, debito numeric, saldo_cierre numeric)
language sql stable as $$
  with g as (
    select (m.fecha at time zone 'America/Argentina/Buenos_Aires')::date dia, m.cuenta, m.descripcion, count(*)::int movimientos,
           round(sum(m.credito), 2) credito, round(sum(m.debito), 2) debito
      from public.mp_movimientos m
     where m.fecha >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and m.fecha < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and m.descripcion not like 'reserve_for_%'
       and m.descripcion not in ('initial_available_balance', 'total')
       and (p_cuenta is null or m.cuenta = p_cuenta)
     group by 1, 2, 3
  )
  select g.dia, g.cuenta, g.descripcion, g.movimientos, g.credito, g.debito,
         (select s.saldo from public.mp_movimientos s
           where s.cuenta = g.cuenta and s.saldo is not null
             and s.fecha < ((g.dia + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
           order by s.fecha desc, s.orden desc nulls last limit 1)
    from g;
$$;

revoke all on function public.mp_movimientos_dias(date, date, text) from public, anon, authenticated;
grant execute on function public.mp_movimientos_dias(date, date, text) to service_role;

-- ============================================================
-- DÍAS DE DEUDA DE CADA CUENTA (2026-10-24)
--
-- Leandro: «necesitamos también los días de deuda y el día de deuda
-- promedio». El Crack exporta ctacte_clientes.csv: cada factura, pago, nota
-- de crédito y ajuste con su fecha y el saldo que dejó. No trae la historia
-- desde el primer día (la suma no da el saldo), así que no se reconstruye la
-- cuenta de cero: se parte del saldo de HOY y se camina hacia atrás por las
-- facturas más nuevas hasta cubrirlo (los pagos cancelan primero lo más
-- viejo). La más vieja que queda abierta dice desde cuándo debe; el promedio
-- es la edad de la deuda pesada por monto.
-- scripts/sistema-viejo/importar-ctacte-clientes.mjs carga el archivo.
-- ============================================================

create table if not exists public.cta_cte_movimientos_crack (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  fecha date not null,
  tipo text not null,            -- VENTA | PAGO | NOTA DE CREDITO | AJUSTE
  comprobante text,
  importe numeric not null,      -- + suma deuda, − la baja
  saldo numeric,                 -- el saldo que dejó, según el Crack
  origen text not null,
  creado_en timestamptz not null default now()
);
create index if not exists cta_cte_movimientos_crack_cliente_idx on public.cta_cte_movimientos_crack (cliente_id, fecha desc);
create index if not exists cta_cte_movimientos_crack_origen_idx on public.cta_cte_movimientos_crack (origen);
alter table public.cta_cte_movimientos_crack enable row level security;

create or replace function public.deuda_antiguedad(p_clientes uuid[])
returns table (
  cliente_id uuid,
  desde date,              -- la factura abierta más vieja
  dias int,                -- hace cuántos días debe
  dias_promedio numeric,   -- edad de la deuda, pesada por monto
  facturas_abiertas int,
  completo boolean         -- false: el saldo es más que todas las facturas conocidas
)
language sql
stable
security definer
set search_path = public
as $$
  with saldos as (
    select id cliente_id, saldo_cta_cte saldo from clientes where id = any(p_clientes) and saldo_cta_cte > 0
  ),
  cargos as (
    -- lo que sumó deuda: facturas y ajustes del Crack, y lo cargado en NÚCLEO
    -- (sin los saldos traídos del Crack, que ya están en las facturas de arriba)
    select m.cliente_id, m.fecha, m.importe monto
      from cta_cte_movimientos_crack m join saldos s using (cliente_id) where m.importe > 0
    union all
    select c.cliente_id, (c.creado_en at time zone 'America/Argentina/Buenos_Aires')::date, c.debe
      from cuenta_corriente c join saldos s using (cliente_id)
     where c.debe > 0 and c.concepto !~* 'sistema anterior'
  ),
  acumulado as (
    select g.cliente_id, g.fecha, g.monto, s.saldo,
           sum(g.monto) over (partition by g.cliente_id order by g.fecha desc, g.monto rows unbounded preceding) acum
      from cargos g join saldos s using (cliente_id)
  ),
  abiertas as (
    select cliente_id, fecha, saldo, greatest(0, least(monto, saldo - (acum - monto))) abierto
      from acumulado
  )
  select a.cliente_id,
         min(a.fecha),
         (current_date - min(a.fecha))::int,
         round(sum(a.abierto * (current_date - a.fecha)) / nullif(sum(a.abierto), 0), 0),
         count(*)::int,
         sum(a.abierto) >= max(a.saldo) - 1
    from abiertas a
   where a.abierto > 0
   group by a.cliente_id;
$$;
revoke all on function public.deuda_antiguedad(uuid[]) from public, anon, authenticated;

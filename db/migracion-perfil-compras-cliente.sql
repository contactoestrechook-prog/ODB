-- ============================================================
-- PERFIL DE COMPRA DE CADA CLIENTE (2026-10-24)
--
-- Leandro, sobre las tarjetas de cuenta corriente: «promedio de compra en
-- tickets de últimos 6 meses, qué productos compra, qué días fuertes son los
-- que compra, armá algo pro».
--
-- En NÚCLEO ninguna venta está atada a un cliente todavía: las compras salen
-- del Crack (ventas.csv exportado el 24/10: un año de Sant Thomas, renglón por
-- renglón, con el nombre del cliente). scripts/sistema-viejo/importar-compras-clientes.mjs
-- las ata a cada ficha (nombre del Crack → código → clientes.codigo_legacy
-- 'st-<código>') y las carga acá. Las ventas nuevas de NÚCLEO con cliente se
-- suman solas en perfil_compras().
-- ============================================================

create table if not exists public.compras_cliente_historico (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  fecha date not null,
  sucursal text,                 -- 'st' | 'si'
  ticket text not null,          -- número de ticket o factura del sistema viejo
  codigo_producto text,          -- productos.codigo_legacy
  cantidad numeric not null,
  precio_unitario numeric not null,
  medio_pago text,
  origen text not null,          -- de qué carga salió (para rehacerla sin duplicar)
  creado_en timestamptz not null default now()
);
create index if not exists compras_cliente_historico_cliente_idx on public.compras_cliente_historico (cliente_id, fecha desc);
create index if not exists compras_cliente_historico_origen_idx on public.compras_cliente_historico (origen);
alter table public.compras_cliente_historico enable row level security;

-- Perfil de compra de varios clientes a la vez (las tarjetas piden todas
-- juntas). Junta lo del sistema viejo y las ventas de NÚCLEO con cliente.
-- Por cliente: tickets y total de los últimos p_meses, ticket promedio,
-- cada cuántos días compra, última compra, compras por día de la semana
-- (0 = domingo), por mes, y los productos que más compra.
create or replace function public.perfil_compras(p_clientes uuid[], p_meses int default 6)
returns table (
  cliente_id uuid,
  tickets int,
  total numeric,
  ticket_promedio numeric,
  primera date,
  ultima date,
  cada_dias numeric,
  por_dia jsonb,
  por_mes jsonb,
  medios jsonb,
  productos jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with renglones as (
    select h.cliente_id, h.fecha, h.ticket, h.codigo_producto, h.cantidad, h.precio_unitario, h.medio_pago
      from compras_cliente_historico h
     where h.cliente_id = any(p_clientes)
       and h.fecha >= (current_date - make_interval(months => p_meses))::date
    union all
    select v.cliente_id, (v.vendida_en at time zone 'America/Argentina/Buenos_Aires')::date, v.id::text,
           p.codigo_legacy, vi.cantidad, vi.precio_unitario, null
      from ventas v
      join ventas_items vi on vi.venta_id = v.id
      left join productos p on p.id = vi.producto_id
     where v.cliente_id = any(p_clientes) and v.estado = 'completada'
       and v.vendida_en >= now() - make_interval(months => p_meses)
  ),
  tickets as (
    select cliente_id, ticket, min(fecha) fecha, sum(cantidad * precio_unitario) total, max(medio_pago) medio
      from renglones group by 1, 2
  ),
  base as (
    select cliente_id, count(*)::int tickets, sum(total) total, min(fecha) primera, max(fecha) ultima
      from tickets group by 1
  ),
  dias as (
    select cliente_id, jsonb_object_agg(d, n) por_dia
      from (select cliente_id, extract(dow from fecha)::int d, count(*) n from tickets group by 1, 2) x group by 1
  ),
  meses as (
    select cliente_id, jsonb_agg(jsonb_build_object('mes', m, 'tickets', n, 'total', round(t)) order by m) por_mes
      from (select cliente_id, to_char(fecha, 'YYYY-MM') m, count(*) n, sum(total) t from tickets group by 1, 2) x group by 1
  ),
  medios as (
    select cliente_id, jsonb_object_agg(coalesce(medio, 'NÚCLEO'), n) medios
      from (select cliente_id, medio, count(*) n from tickets group by 1, 2) x group by 1
  ),
  prods as (
    select cliente_id, jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'unidades', round(unidades, 2), 'total', round(total), 'veces', veces) order by total desc) productos
      from (
        select r.cliente_id, r.codigo_producto codigo, coalesce(p.nombre, 'Código ' || r.codigo_producto) nombre,
               sum(r.cantidad) unidades, sum(r.cantidad * r.precio_unitario) total, count(distinct r.ticket) veces,
               row_number() over (partition by r.cliente_id order by sum(r.cantidad * r.precio_unitario) desc) orden
          from renglones r left join productos p on p.codigo_legacy = r.codigo_producto
         group by 1, 2, 3
      ) x where orden <= 8 group by 1
  )
  select b.cliente_id, b.tickets, round(b.total), round(b.total / nullif(b.tickets, 0)),
         b.primera, b.ultima,
         case when b.tickets > 1 then round((b.ultima - b.primera)::numeric / (b.tickets - 1), 1) end,
         d.por_dia, m.por_mes, md.medios, pr.productos
    from base b
    left join dias d using (cliente_id)
    left join meses m using (cliente_id)
    left join medios md using (cliente_id)
    left join prods pr using (cliente_id);
$$;
revoke all on function public.perfil_compras(uuid[], int) from public, anon, authenticated;

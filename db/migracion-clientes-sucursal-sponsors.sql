-- ============================================================
-- CLIENTES POR SUCURSAL Y SPONSORS DEL WINE FEST (2026-10-24)
--
-- Leandro reordenó el menú: «Clientes» tiene adentro Clientes ST, Clientes
-- SI, Base de datos, Agenda y Sponsor WF. Pidió los clientes por sucursal
-- (todos, no solo los de cuenta corriente) y que los sponsors del Wine Fest
-- sean cuentas corrientes aparte.
-- ============================================================

-- ---- sucursal del cliente: 'st' Sant Thomas, 'si' Santa Inés, null sin dato ----
alter table public.clientes
  add column if not exists sucursal text check (sucursal in ('st', 'si'));
create index if not exists clientes_sucursal_idx on public.clientes (sucursal);

-- Ninguna venta está atada a un cliente y solo 9 pedidos lo están: lo único
-- firme para arrancar es el barrio cargado en la ficha. Solo se llenan los
-- vacíos; el resto se asigna a mano desde el panel.
update public.clientes set sucursal = 'st'
 where sucursal is null and barrio ~* '^\s*(st|saint|sant)\.?\s*thomas';
update public.clientes set sucursal = 'si'
 where sucursal is null and barrio ~* '^\s*santa\s+in[eé]s';

-- De acá en adelante, un cliente sin sucursal toma la del primer pedido o la
-- primera venta que se le asigna. Nunca pisa una que ya tiene.
create or replace function public.clientes_sucursal_de_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cod text;
begin
  if new.cliente_id is null or new.sucursal_id is null then return new; end if;
  select case when nombre ~* 'thomas' then 'st' when nombre ~* 'in[eé]s' then 'si' end
    into v_cod from sucursales where id = new.sucursal_id;
  if v_cod is not null then
    update clientes set sucursal = v_cod where id = new.cliente_id and sucursal is null;
  end if;
  return new;
end $$;

drop trigger if exists pedidos_sucursal_del_cliente on public.pedidos;
create trigger pedidos_sucursal_del_cliente
  after insert or update of cliente_id on public.pedidos
  for each row execute function public.clientes_sucursal_de_compra();

drop trigger if exists ventas_sucursal_del_cliente on public.ventas;
create trigger ventas_sucursal_del_cliente
  after insert or update of cliente_id on public.ventas
  for each row execute function public.clientes_sucursal_de_compra();

-- ---- tipo de cuenta corriente: la de un cliente o la de un sponsor del Wine Fest ----
alter table public.clientes
  add column if not exists cta_cte_tipo text not null default 'cliente'
  check (cta_cte_tipo in ('cliente', 'sponsor_wf'));

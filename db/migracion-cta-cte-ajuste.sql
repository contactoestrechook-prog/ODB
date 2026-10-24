-- ============================================================
-- AJUSTE DE SALDO DE CUENTA CORRIENTE (2026-10-24)
--
-- Leandro: «tenemos que poder modificar todo de las ctas ctes». El saldo no
-- se pisa: se corrige con un movimiento que dice por qué, y el saldo del
-- cliente se mueve en la misma transacción (como aprobar_cobranza y
-- cta_cte_abrir). Lo usa solo el dueño, desde la ficha de la cuenta.
-- p_monto > 0 suma deuda (debe); p_monto < 0 la baja (haber).
-- ============================================================
create or replace function public.cta_cte_ajustar(p_cliente uuid, p_monto numeric, p_motivo text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_c record;
begin
  if coalesce(p_monto, 0) = 0 then raise exception 'El ajuste tiene que ser distinto de cero'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 4 then raise exception 'Falta el motivo del ajuste'; end if;
  select id, cta_cte_habilitada into v_c from clientes where id = p_cliente for update;
  if v_c is null then raise exception 'No existe ese cliente'; end if;
  if not v_c.cta_cte_habilitada then raise exception 'Ese cliente no tiene cuenta corriente'; end if;

  insert into cuenta_corriente (cliente_id, concepto, debe, haber)
  values (p_cliente, 'Ajuste: ' || trim(p_motivo), greatest(p_monto, 0), greatest(-p_monto, 0));
  update clientes set saldo_cta_cte = coalesce(saldo_cta_cte, 0) + p_monto where id = p_cliente;

  return (select saldo_cta_cte from clientes where id = p_cliente);
end $$;
revoke all on function public.cta_cte_ajustar(uuid, numeric, text) from public, anon, authenticated;

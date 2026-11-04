-- LO DEVUELTO SE PAGA RECIÉN CON LA NOTA DE CRÉDITO (Leandro, 4/11/2026).
-- «Se recibió la mercadería, ingresó la factura, ingresó el stock sin las
-- devoluciones, la factura sigue su curso en administración y esperamos la
-- nota de crédito para firmar y procesar el pago.»
--
-- La traba vive en la base, no en la pantalla: ningún camino (pago directo,
-- orden de pago, aprobación, pago de la OP) puede pagar una factura que espera
-- su nota de crédito. Se libera sola cuando se carga una nota de crédito del
-- mismo proveedor (la más vieja que espera queda vinculada a esa NC).

alter table facturas_proveedor
  add column if not exists espera_nc boolean not null default false,
  add column if not exists espera_nc_motivo text,
  add column if not exists nc_id uuid references facturas_proveedor(id),
  -- en la NC: la factura que libera (la que el lector encontró)
  add column if not exists nc_para uuid references facturas_proveedor(id);

create index if not exists facturas_proveedor_espera_nc_idx
  on facturas_proveedor (proveedor_id, creado_en) where espera_nc;

-- 1) no se paga ni entra en una orden de pago
create or replace function trabar_pago_sin_nc() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f record;
begin
  select numero, espera_nc into f from facturas_proveedor where id = new.factura_id;
  if f.espera_nc then
    raise exception 'La factura % espera la nota de crédito por la mercadería devuelta: no se puede pagar hasta cargarla.', f.numero;
  end if;
  return new;
end $$;

drop trigger if exists trabar_pago_sin_nc on facturas_proveedor_pagos;
create trigger trabar_pago_sin_nc before insert on facturas_proveedor_pagos
  for each row execute function trabar_pago_sin_nc();

drop trigger if exists trabar_op_sin_nc on ordenes_pago_items;
create trigger trabar_op_sin_nc before insert on ordenes_pago_items
  for each row execute function trabar_pago_sin_nc();

-- 2) tampoco se marca pagada o en pago por otro lado
create or replace function trabar_estado_sin_nc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.espera_nc and new.estado in ('pagada', 'en_pago', 'parcial') and new.estado is distinct from old.estado then
    raise exception 'La factura % espera la nota de crédito por la mercadería devuelta: no se puede pagar hasta cargarla.', new.numero;
  end if;
  return new;
end $$;

drop trigger if exists trabar_estado_sin_nc on facturas_proveedor;
create trigger trabar_estado_sin_nc before update of estado on facturas_proveedor
  for each row execute function trabar_estado_sin_nc();

-- 3) llega la nota de crédito del proveedor → se libera la factura que la esperaba
create or replace function liberar_con_nc() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fid uuid;
begin
  if new.tipo <> 'nota_credito' or new.estado = 'anulada' then return new; end if;
  -- la que la NC nombra; si no nombra ninguna (o ya no espera), la más vieja que espera
  select id into fid from facturas_proveedor
   where proveedor_id = new.proveedor_id and espera_nc and tipo = 'factura' and estado <> 'anulada'
   order by (id = new.nc_para) desc, creado_en limit 1;
  if fid is not null then
    update facturas_proveedor set espera_nc = false, nc_id = new.id where id = fid;
  end if;
  return new;
end $$;

drop trigger if exists liberar_con_nc on facturas_proveedor;
create trigger liberar_con_nc after insert on facturas_proveedor
  for each row execute function liberar_con_nc();

revoke all on function trabar_pago_sin_nc() from public, anon, authenticated;
revoke all on function trabar_estado_sin_nc() from public, anon, authenticated;
revoke all on function liberar_con_nc() from public, anon, authenticated;

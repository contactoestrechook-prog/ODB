-- QUIÉNES COMPRAN A UNA CUENTA CORRIENTE (26/11/2026). Leandro: «necesito que el sistema
-- reconozca las personas que tengan cuenta corriente así el bot puede gestionar el pedido».
-- El caso: Cristina (St Thomas 470) pidió por WhatsApp pagar con cuenta corriente y el bot dijo
-- que no figuraba. La cuenta existe, pero es de la casa: «St Thomas 470 (Salvador)» (CUIT
-- 33707495729, sin teléfono); Cristina, Salvador y Andrea escriben desde sus celulares y cada
-- uno es otra ficha, sin unir a esa cuenta.
--
-- clientes.cuenta_corriente_de: la ficha de la cuenta a la que compra esta persona. El bot la
-- reconoce (BotService.identificarCliente) y el pedido va a nombre del titular. Se maneja desde
-- la ficha de la cuenta corriente («Quiénes compran a esta cuenta»).
--
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (cuenta_corriente_de).
alter table public.clientes add column if not exists cuenta_corriente_de uuid references public.clientes(id) on delete set null;
create index if not exists clientes_cuenta_corriente_de on public.clientes (cuenta_corriente_de) where cuenta_corriente_de is not null;
do $$ begin
  alter table public.clientes add constraint clientes_cuenta_corriente_de_no_propia check (cuenta_corriente_de is null or cuenta_corriente_de <> id);
exception when duplicate_object then null; end $$;
comment on column public.clientes.cuenta_corriente_de is 'La cuenta corriente (otra ficha) a la que compra esta persona: el bot la reconoce y el pedido va a nombre del titular (26/11/2026)';

-- St Thomas 470: Cristina (sus dos fichas) y Salvador compran a la cuenta de la casa. Andrea
-- (la hija) queda para que lo decida el local desde la ficha de la cuenta.
update public.clientes set cuenta_corriente_de = 'e0e17401-d77e-44ff-a8ea-25e5d4ec7b77'
 where id in ('ca63baff-628b-4e58-9423-6ecbffc191e2', '338ea683-84ba-4050-a76b-fae4740c743c', 'ded18fc2-3d6f-4355-a5d4-8c19901de882')
   and cuenta_corriente_de is null;

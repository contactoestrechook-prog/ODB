-- ============================================================
-- RESUMEN DE CUENTA CORRIENTE POR WHATSAPP (2026-10-24)
--
-- Pedido de Leandro: «un nuevo módulo para las cuentas corrientes, con
-- automatizaciones de mensajería cada 15 días enviándoles su saldo».
-- Decidido con él: sale por la línea general (WAHA), los días 1 y 16 a las
-- 10:00, a todos los que deben. Se puede apagar cliente por cliente.
--
-- Nace PAUSADO (activo = false): hasta que el dueño lo prende desde el panel,
-- después de una prueba real a su propio número, no le sale nada a nadie.
--
-- Cada envío queda anotado una sola vez por tanda (unique tanda + cliente):
-- si el servidor se reinicia a mitad de camino, o hay dos instancias, nadie
-- recibe el resumen dos veces.
-- ============================================================

-- ---- apagar el resumen de un cliente puntual ----
alter table public.clientes
  add column if not exists cta_cte_resumen boolean not null default true;

-- ---- configuración (una sola fila) ----
create table if not exists public.cta_cte_resumenes_config (
  id smallint primary key default 1 check (id = 1),
  activo boolean not null default false,
  dias smallint[] not null default '{1,16}',
  hora smallint not null default 10 check (hora between 7 and 21),
  piso numeric not null default 0,
  plantilla text not null default
    'Hola {nombre} 👋 Te escribimos de O.D.B.' || chr(10) || chr(10) ||
    'Al {fecha}, el saldo de tu cuenta corriente es de *{saldo}*.' || chr(10) ||
    '{movimientos}' || chr(10) ||
    'Podés pagar por transferencia al alias *{alias}* ({titular}) o en el local.' || chr(10) ||
    'Si ya pagaste, no tengas en cuenta este mensaje. Cualquier duda, respondé por acá 🍷',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
insert into public.cta_cte_resumenes_config (id) values (1) on conflict (id) do nothing;

-- ---- un renglón por cliente y por tanda ----
create table if not exists public.cta_cte_resumenes (
  id uuid primary key default gen_random_uuid(),
  tanda date not null,                 -- el día del resumen (1 o 16, o el día del envío manual)
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  telefono text,
  saldo numeric not null,
  texto text,
  -- pendiente → enviando → enviado | error ; sin_telefono y omitido no se mandan
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'error', 'sin_telefono', 'omitido')),
  motivo text,
  waha_id text,
  manual boolean not null default false,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz,
  unique (tanda, cliente_id)
);
create index if not exists cta_cte_resumenes_cliente_idx on public.cta_cte_resumenes (cliente_id, tanda desc);
create index if not exists cta_cte_resumenes_tanda_idx on public.cta_cte_resumenes (tanda desc, estado);

-- solo el backend (service role) las toca
alter table public.cta_cte_resumenes_config enable row level security;
alter table public.cta_cte_resumenes enable row level security;

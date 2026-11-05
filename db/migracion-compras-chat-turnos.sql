-- EL CHAT DE LA FACTURA · CADA CHARLA QUEDA GUARDADA (Leandro, 5/11/2026:
-- «empecemos a trabajar en que cada vez sea el chat más inteligente»).
-- Una fila por mensaje de la persona: qué pidió, qué contestó la IA, qué cambios
-- mandó y cuáles no se pudieron aplicar. Con esto se ve con qué se equivoca, en
-- vez de enterarse por una captura. Solo la escribe y la lee la API.
-- Aditiva. APLICADA en producción el 5/11/2026 (migración compras_chat_turnos).

create table if not exists public.compras_chat_turnos (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  lectura_id uuid,
  proveedor_id uuid,
  usuario_id uuid,
  mensaje text not null,
  respuesta text,
  cambios jsonb not null default '[]'::jsonb,
  cambios_pie jsonb not null default '[]'::jsonb,
  descartados jsonb not null default '[]'::jsonb,
  regla_propuesta text,
  vueltas int,
  segundos numeric
);
create index if not exists compras_chat_turnos_creado on public.compras_chat_turnos (creado_en desc);
create index if not exists compras_chat_turnos_lectura on public.compras_chat_turnos (lectura_id);
alter table public.compras_chat_turnos enable row level security;

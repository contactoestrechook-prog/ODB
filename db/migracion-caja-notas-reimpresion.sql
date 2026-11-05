-- ============================================================
-- NOTAS Y REIMPRESIONES EN CADA OPERACIÓN DE CAJA (Leandro, 5/11/2026)
--
-- «En caja necesitan en cada operación un espacio de notas en donde puedan
-- anotar algo o enviar un audio explicando algo; también un botón de volver a
-- imprimir el ticket por si falla la impresora.»
--
-- · ventas_notas: lo que la cajera anota sobre un ticket ya cobrado, escrito o
--   en audio. El audio va al depósito privado «comprobantes» (carpeta
--   caja-notas/<venta>/) y, si hay clave de transcripción, se guarda también
--   el texto para leerlo sin escuchar. Quién y cuándo, siempre.
-- · ventas_reimpresiones: cada vez que se vuelve a imprimir un ticket. El
--   ticket impreso sale marcado «REIMPRESIÓN»; acá queda quién y cuándo.
--
-- Aditiva: dos tablas nuevas, nada se toca. Mientras no esté aplicada, la API
-- sigue andando: las notas y reimpresiones simplemente no se guardan.
-- ============================================================

create table if not exists public.ventas_notas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  sesion_caja_id uuid references public.sesiones_caja(id),
  usuario_id uuid references public.usuarios(id),
  texto text,
  audio_ruta text,
  audio_mime text,
  audio_segundos integer,
  transcripcion text,
  creado_en timestamptz not null default now(),
  constraint ventas_notas_con_algo check (texto is not null or audio_ruta is not null)
);
create index if not exists ventas_notas_venta_idx
  on public.ventas_notas (venta_id, creado_en);

create table if not exists public.ventas_reimpresiones (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  sesion_caja_id uuid references public.sesiones_caja(id),
  usuario_id uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists ventas_reimpresiones_venta_idx
  on public.ventas_reimpresiones (venta_id, creado_en);

-- Solo la API (service role) las lee y escribe, como el resto de la base.
alter table public.ventas_notas enable row level security;
alter table public.ventas_reimpresiones enable row level security;
revoke all on public.ventas_notas from anon, authenticated;
revoke all on public.ventas_reimpresiones from anon, authenticated;

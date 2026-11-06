-- AVISOS AL CELULAR (6/11/2026)
-- Leandro: «las notificaciones les lleguen a los celulares, como una aplicación,
-- lo mismo que hicimos para MetoGroup», y «ODB lo mismo» (igual que CarCash).
--
-- Al celular va SOLO lo importante de la campanita (configuracion.avisos_celular.tipos).
-- Elegido por Leandro el 6/11/2026 con los números de la semana anterior:
--   dueños:            pedido sin tomar, pedido cuyo aviso no le llegó a administración,
--                      comprobante o consulta de pago, WhatsApp caído, bot caído (~4 por día)
--   Anabella y Romina: «Completá el proveedor» (0,6 por día)
--   NO van:            consultas del bot a las áreas (ya salen por WhatsApp), clientes
--                      esperando a una persona, proveedores que escriben, notas del bot
-- Se hace con Web Push (el estándar de los navegadores; en el iPhone, con el panel
-- agregado a la pantalla de inicio). Cada uno lo activa en su aparato: quien no lo
-- activa no recibe nada. A quién le llega es lo mismo que la campanita: el aviso con
-- destinatario, a esa persona; el general, a los dueños y gerentes.
--
--   push_suscripciones         cada aparato que aceptó avisos (de quién es y a dónde mandarle)
--   configuracion              qué tipos suenan y el horario de silencio (se cambia sin publicar)
--   alertas_internas.celular_en  cuándo salió ese aviso al celular (se marca ANTES de mandar)
--   celular:* en el Vault      las claves VAPID y el secreto con el que la base llama a la API
--   trg_zz_avisos_celular      cada aviso nuevo de esos tipos llama al instante (pg_net) a
--                              POST /avisos-celular/enviar de la API, que lo manda
--   de 22 a 8 no suena         lo que cae de noche sale a las 8 en un solo aviso por persona
--                              (celular_manana, pg_cron)
--
-- Aditiva. Mientras la API nueva no esté publicada, la llamada de la base da 404 y no
-- pasa nada (el aviso de la campanita se guarda igual: el disparador nunca la frena).

create table if not exists public.push_suscripciones (
  id            bigserial primary key,
  usuario_id    uuid not null references public.usuarios (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  dispositivo   text,
  creada_en     timestamptz not null default now(),
  ultimo_ok_en  timestamptz,
  fallos        int not null default 0
);
create index if not exists push_suscripciones_usuario_idx on public.push_suscripciones (usuario_id);
comment on table public.push_suscripciones is
  'Aparatos que activaron los avisos al celular (Web Push), uno por navegador. Los guarda y los usa solo la API (/avisos-celular). Si el servicio del navegador contesta 404 o 410, la API lo borra. 6/11/2026.';
-- solo la API (service role) la toca
alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;
revoke all on sequence public.push_suscripciones_id_seq from anon, authenticated;

alter table public.alertas_internas add column if not exists celular_en timestamptz;
comment on column public.alertas_internas.celular_en is
  'Cuándo salió este aviso al celular (Web Push). Se marca ANTES de mandar, con update condicionado: si la base llama dos veces, sale una sola. 6/11/2026.';

-- Configuraciones que se cambian sin publicar (empieza con los avisos al celular).
create table if not exists public.configuracion (
  clave          text primary key,
  valor          jsonb not null,
  descripcion    text,
  actualizado_en timestamptz not null default now()
);
alter table public.configuracion enable row level security;
revoke all on public.configuracion from anon, authenticated;

insert into public.configuracion (clave, valor, descripcion) values ('avisos_celular', jsonb_build_object(
  'activo', true,
  'silencio_desde', 22,
  'silencio_hasta', 8,
  'tipos', jsonb_build_array(
    -- dueños
    'pedido_sin_tomar', 'pedido_sin_aviso', 'pago', 'whatsapp_caido', 'bot_caido',
    -- Anabella y Romina
    'proveedor_incompleto'),
  'url', 'https://api.odbpremiummarket.com.ar/avisos-celular/enviar',
  'nota', 'Leandro 6/11/2026: al celular solo lo importante; el resto queda en la campanita'),
  'Avisos al celular (Web Push): qué tipos de la campanita suenan, el horario de silencio y a qué dirección de la API llama la base')
on conflict (clave) do nothing;

-- ── El Vault: claves VAPID (las genera scripts/avisos-claves.mjs) y el secreto del disparador ──
create or replace function public.celular_guardar_claves(p_publica text, p_privada text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if coalesce(p_publica, '') = '' or coalesce(p_privada, '') = '' then raise exception 'Faltan las claves'; end if;
  select id into v_id from vault.secrets where name = 'celular:vapid_publica';
  if v_id is null then perform vault.create_secret(p_publica, 'celular:vapid_publica', 'Avisos al celular: clave pública VAPID');
  else perform vault.update_secret(v_id, p_publica); end if;
  select id into v_id from vault.secrets where name = 'celular:vapid_privada';
  if v_id is null then perform vault.create_secret(p_privada, 'celular:vapid_privada', 'Avisos al celular: clave privada VAPID');
  else perform vault.update_secret(v_id, p_privada); end if;
end $$;

create or replace function public.celular_claves()
returns table (publica text, privada text) language sql stable security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'celular:vapid_publica' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'celular:vapid_privada' limit 1)
$$;

-- El secreto con el que la base se presenta ante la API: lo crea la base y no sale de ella.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'celular:secreto') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'celular:secreto', 'Avisos al celular: la base → POST /avisos-celular/enviar');
  end if;
end $$;

create or replace function public.celular_secreto_ok(p text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(p, '') <> '' and p = (select decrypted_secret from vault.decrypted_secrets where name = 'celular:secreto' limit 1)
$$;

revoke all on function public.celular_guardar_claves(text, text) from public, anon, authenticated;
revoke all on function public.celular_claves() from public, anon, authenticated;
revoke all on function public.celular_secreto_ok(text) from public, anon, authenticated;
grant execute on function public.celular_guardar_claves(text, text) to service_role;
grant execute on function public.celular_claves() to service_role;
grant execute on function public.celular_secreto_ok(text) to service_role;

-- ¿Es hora de silencio en Argentina? (de 22 a 8 por defecto)
create or replace function public.celular_en_silencio(p_cfg jsonb)
returns boolean language sql stable as $$
  with h as (
    select extract(hour from now() at time zone 'America/Argentina/Buenos_Aires')::int as hora,
           coalesce((p_cfg->>'silencio_desde')::int, 22) as desde,
           coalesce((p_cfg->>'silencio_hasta')::int, 8) as hasta
  )
  select case when desde > hasta then hora >= desde or hora < hasta
              else hora >= desde and hora < hasta end
  from h
$$;

create or replace function public.celular_llamar(p_cuerpo jsonb)
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_secreto text; v_url text;
begin
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'celular:secreto' limit 1;
  select valor->>'url' into v_url from configuracion where clave = 'avisos_celular';
  if v_secreto is null or coalesce(v_url, '') = '' then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avisos', v_secreto),
    body := p_cuerpo,
    timeout_milliseconds := 8000
  );
end $$;
revoke all on function public.celular_llamar(jsonb) from public, anon, authenticated;

-- ¿Alguien que recibiría este aviso tiene un aparato con avisos? Mismo criterio que
-- la campanita (NovedadesController.alertas): con destinatario, esa persona; sin
-- destinatario, los dueños y gerentes activos.
create or replace function public.celular_alguien_recibe(p_para uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from push_suscripciones s join usuarios u on u.id = s.usuario_id
    where u.activo and (case when p_para is null then u.rol in ('dueno', 'gerente') else u.id = p_para end)
  )
$$;
revoke all on function public.celular_alguien_recibe(uuid) from public, anon, authenticated;

-- ── El disparador: un aviso importante sale al celular al toque (solo si alguien que lo recibe activó un aparato) ──
create or replace function public.celular_disparar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb;
begin
  select valor into v_cfg from configuracion where clave = 'avisos_celular';
  if v_cfg is null or coalesce((v_cfg->>'activo')::boolean, false) is false then return null; end if;
  if not coalesce((v_cfg->'tipos') ? new.tipo, false) then return null; end if;
  if new.leida_en is not null then return null; end if;
  if not celular_alguien_recibe(new.para_usuario) then return null; end if;
  if celular_en_silencio(v_cfg) then return null; end if;   -- de noche no suena: lo junta celular_manana a las 8
  perform celular_llamar(jsonb_build_object('alerta_id', new.id));
  return null;
exception when others then
  return null;  -- un aviso al celular nunca frena que se guarde el aviso de la campanita
end $$;
revoke all on function public.celular_disparar() from public, anon, authenticated;

drop trigger if exists trg_zz_avisos_celular on public.alertas_internas;
create trigger trg_zz_avisos_celular after insert on public.alertas_internas
  for each row execute function public.celular_disparar();

-- ── A las 8: un solo aviso por persona con lo importante que llegó de noche ──
create or replace function public.celular_manana()
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (valor->>'activo')::boolean from configuracion where clave = 'avisos_celular'), false) is false then return; end if;
  if not exists (select 1 from push_suscripciones) then return; end if;
  perform celular_llamar(jsonb_build_object('modo', 'manana'));
end $$;
revoke all on function public.celular_manana() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'odb-avisos-celular-manana';
select cron.schedule('odb-avisos-celular-manana', '0 11 * * *', 'select public.celular_manana()');   -- 8:00 en Argentina (UTC-3, sin horario de verano)

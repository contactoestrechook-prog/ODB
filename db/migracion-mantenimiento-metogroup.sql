-- MANTENIMIENTO CON METOGROUP ADENTRO DE ODB (Leandro, 26/11/2026: «agregarle también
-- el módulo de mantenimiento como tiene Car Cash, con un contexto agéntico totalmente
-- inteligente con clave ODB, que le tome el reclamo de lo que no hay, que le pueda
-- responder, que intente hacerlo en la sesión, se lo encuentre, se lo solucione y se
-- lo haga»).
--
-- La charla es la pantalla de MetoGroup (la misma que usa Car Cash) en un marco. Acá:
--   · mant_clave_metogroup: la clave con la que la API de ODB firma el pase de quien
--     entra (MetoGroup tiene la misma en su base). Sin políticas: solo el servidor.
--   · manual_publicado: el manual de ODB tal como está publicado (temas y pantallas
--     del menú). Lo escribe la API cada vez que alguien abre Mantenimiento y el manual
--     cambió; lo lee el agente de MetoGroup (solo lectura) antes de decir que algo no
--     existe.
--   · agente_sql_ro deja de poder leer la clave del pase.

create table if not exists public.mant_clave_metogroup (
  id         int primary key default 1 check (id = 1),
  clave      text not null,
  creada_en  timestamptz not null default now()
);
alter table public.mant_clave_metogroup enable row level security;
revoke all on public.mant_clave_metogroup from anon, authenticated;

create table if not exists public.manual_publicado (
  clave      text primary key,                  -- 's:<id de la sección>' o 'p:<href>'
  tipo       text not null check (tipo in ('seccion', 'pantalla')),
  orden      int  not null default 0,
  seccion    text,
  titulo     text,
  area       text,
  pantallas  text[] not null default '{}',
  texto      text,
  href       text,
  nombre     text,
  grupo      text,
  bajada     text,
  version    text not null,
  actualizado timestamptz not null default now()
);
alter table public.manual_publicado enable row level security;
revoke all on public.manual_publicado from anon, authenticated;

create or replace function public.agente_sql_ro(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public, privado, pg_temp
as $function$
declare
  r jsonb;
begin
  if p_sql !~* '^\s*(select|with|explain)\y' then
    raise exception 'solo SELECT/WITH/EXPLAIN';
  end if;
  if p_sql ~* '\y(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\y' then
    raise exception 'consulta no permitida (solo lectura)';
  end if;
  if p_sql ~* '(\y(vault|decrypted_secrets|ia_claves|secretos?|pg_authid|auth\s*\.\s*users)\y|mant_clave|clave_hash|pin_firma)' then
    raise exception 'esa tabla o columna guarda claves: el agente no la lee';
  end if;
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || rtrim(p_sql, '; ') || ' ) t' into r;
  -- un «select *» de usuarios no lleva el hash de la clave ni el PIN de firma a la IA
  select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'clave_hash' - 'pin_firma' else e end), '[]'::jsonb)
    into r from jsonb_array_elements(r) e;
  if length(r::text) > 60000 then
    r := jsonb_build_object('truncado', true, 'muestra', left(r::text, 60000));
  end if;
  return r;
end
$function$;

revoke all on function public.agente_sql_ro(text) from public, anon, authenticated;
grant execute on function public.agente_sql_ro(text) to service_role;

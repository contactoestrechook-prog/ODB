-- Migración de seguridad · 2026-07-20
-- Cierra el acceso de la clave pública (anon) de Supabase, hallazgo P0-01 de la
-- auditoría pre-piloto: anon podía ejecutar TODAS las funciones SECURITY DEFINER
-- (registrar_venta, verificar_pin_supervisor, anular_venta, finalizar_conteo…)
-- porque los REVOKE viejos apuntaban a firmas que ya habían cambiado de aridad,
-- y además tenía DML directo sobre todas las tablas (varias sin RLS).
--
-- Nada del sistema usa la clave anon: apps/api y legacy/bridge usan la service
-- key, y ningún frontend habla con Supabase directo (todo pasa por la API). Por
-- eso se cierra por completo: solo service_role puede tocar datos.
--
-- Idempotente: se puede correr las veces que haga falta.

-- 1) RLS en todas las tablas (sin policies = denegado; service_role lo bypassea)
do $$
declare t record;
begin
  for t in
    select c.oid::regclass as tabla
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table %s enable row level security', t.tabla);
  end loop;
end $$;

-- 2) sin grants de tablas/secuencias para las claves públicas
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 3) EXECUTE de funciones solo para service_role (todas las firmas actuales)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;

-- 4) lo que se cree en el futuro nace cerrado
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ============================================================
-- LA MEDIDA DE LA CARGA DE FACTURAS (11/11/2026)
-- Leandro: «para que no falle más». Hasta hoy se sabía que la carga andaba mal
-- cuando administración avisaba. Esta función dice, semana por semana, cuántas
-- facturas registradas entraron sin que una persona las toque: sin escribirle
-- al chat y sin cambiar nada a mano.
--
-- Lo que acomoda la memoria del artículo («Memoria») y lo que aplican solas las
-- reglas del proveedor no cuenta como tocar: nadie tuvo que hacer nada.
-- Vale desde el 2/11/2026, cuando se empezó a anotar cada cambio
-- (compras_revisiones y compras_chat_turnos).
-- La muestra Administración › Mantenimiento.
-- ============================================================
create or replace function compras_lector_salud(p_desde date default '2026-11-02')
returns table (semana date, registradas integer, sin_tocar integer, mensajes_chat integer, cambios_memoria integer, cambios_chat integer, cambios_persona integer)
language sql stable
set search_path = public
as $$
  with reg as (
    select lc.id, (date_trunc('week', lc.creado_en at time zone 'America/Argentina/Buenos_Aires'))::date as semana
    from lecturas_comprobante lc
    where lc.creado_en >= p_desde and exists (select 1 from compras_historial h where h.lectura_id = lc.id)
  ), ch as (
    select lectura_id, count(*) as n from compras_chat_turnos where mensaje not like '[automático]%' group by lectura_id
  ), rv as (
    select r.lectura_id,
      count(*) filter (where c->>'quien' = 'Memoria') as mem,
      count(*) filter (where c->>'quien' = 'IA') as ia,
      count(*) filter (where coalesce(c->>'quien', '') not in ('IA', 'Memoria')) as per
    from compras_revisiones r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.cambios) = 'array' then r.cambios else '[]'::jsonb end) c
    group by r.lectura_id
  )
  select reg.semana, count(*)::int,
    (count(*) filter (where coalesce(ch.n, 0) = 0 and coalesce(rv.per, 0) = 0))::int,
    coalesce(sum(ch.n), 0)::int, coalesce(sum(rv.mem), 0)::int, coalesce(sum(rv.ia), 0)::int, coalesce(sum(rv.per), 0)::int
  from reg left join ch on ch.lectura_id = reg.id left join rv on rv.lectura_id = reg.id
  group by reg.semana order by reg.semana;
$$;
-- solo la API (service role)
revoke execute on function compras_lector_salud(date) from public, anon, authenticated;
grant execute on function compras_lector_salud(date) to service_role;

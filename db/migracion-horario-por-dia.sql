-- Horario por día (Leandro, 19/10/2026). APLICADA en producción el 19/10/2026.
-- El domingo 18/10 el bot le dijo a un cliente que Santa Inés estaba abierta hasta las 20:30
-- y fue caminando: los domingos cierra a las 14. La base tenía un solo abre/cierra para todos
-- los días. Ahora sucursales.horario_por_dia guarda lo que cambia según el día y
-- estado_atencion() devuelve el horario de HOY y el de la semana (horarios_semana).
alter table public.sucursales add column if not exists horario_por_dia jsonb not null default '{}'::jsonb;
comment on column public.sucursales.horario_por_dia is
  'Lo que cambia según el día: {"0":{"abre":"08:30","cierra":"14:00"}} (0 = domingo … 6 = sábado). El día que no figura usa abre/cierra.';

-- «lunes a sábado 08:30 a 20:30; domingo 08:30 a 14:00»
create or replace function public.horario_semana(p_abre time, p_cierra time, p_dias smallint[], p_por_dia jsonb) returns text
language sql immutable set search_path = public as $$
  with d as (
    select ord, dia, nombre,
      case when dia = any(p_dias) then
        to_char(coalesce((p_por_dia -> dia::text ->> 'abre')::time, p_abre), 'HH24:MI') || ' a ' ||
        to_char(coalesce((p_por_dia -> dia::text ->> 'cierra')::time, p_cierra), 'HH24:MI')
      else 'cerrado' end as h
    from (values (1,1::smallint,'lunes'),(2,2::smallint,'martes'),(3,3::smallint,'miércoles'),(4,4::smallint,'jueves'),(5,5::smallint,'viernes'),(6,6::smallint,'sábado'),(7,0::smallint,'domingo')) v(ord, dia, nombre)
  ), g as (select *, ord - row_number() over (partition by h order by ord) as grp from d),
  t as (select min(ord) o, h, (array_agg(nombre order by ord))[1] primero, (array_agg(nombre order by ord desc))[1] ultimo, count(*) n from g group by h, grp)
  select string_agg(case when n = 1 then primero when n = 2 then primero || ' y ' || ultimo else primero || ' a ' || ultimo end || ' ' || h, '; ' order by o) from t;
$$;

CREATE OR REPLACE FUNCTION public.estado_atencion()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with ahora as (
    select (now() at time zone 'America/Argentina/Buenos_Aires') as t
  ),
  base0 as (
    select s.*, a.t, extract(dow from a.t)::smallint as dia, a.t::time as hora
    from sucursales s cross join ahora a
    where s.activa
  ),
  base as (
    select nombre, direccion, pickup, dias_abierta, delivery_desde, delivery_dias, t, dia, hora,
           -- el horario de HOY: lo del día si figura en horario_por_dia, si no el de siempre
           coalesce((horario_por_dia -> dia::text ->> 'abre')::time, abre) as abre,
           coalesce((horario_por_dia -> dia::text ->> 'cierra')::time, cierra) as cierra,
           horario_semana(abre, cierra, dias_abierta, horario_por_dia) as semana,
           delivery_hasta
    from base0
  ),
  base2 as (
    select *, coalesce(delivery_hasta, (cierra - interval '45 minutes')::time) as delivery_hasta_hoy from base
  )
  select jsonb_build_object(
    'ahora', to_char((select t from ahora), 'YYYY-MM-DD HH24:MI'),
    'dia_semana', case extract(dow from (select t from ahora))
                    when 0 then 'domingo' when 1 then 'lunes' when 2 then 'martes' when 3 then 'miércoles'
                    when 4 then 'jueves' when 5 then 'viernes' else 'sábado' end,
    'saludo', case
                when (select t from ahora)::time < '13:00' then 'Buen día'
                when (select t from ahora)::time < '20:00' then 'Buenas tardes'
                else 'Buenas noches' end,
    'sucursales', (
      select jsonb_agg(jsonb_build_object(
        'nombre', nombre,
        'direccion', direccion,
        'horario', case when dia = any(dias_abierta) then to_char(abre, 'HH24:MI') || ' a ' || to_char(cierra, 'HH24:MI') else 'hoy cerrada' end,
        'horarios_semana', semana,
        'abierta_ahora', dia = any(dias_abierta) and hora >= abre and hora < cierra,
        'cierra_en_minutos', case when dia = any(dias_abierta) and hora >= abre and hora < cierra
                                  then extract(epoch from (cierra - hora))::int / 60 else null end,
        'retiro_de_pedidos', pickup
      ) order by nombre) from base2
    ),
    'retiro', (select 'Los pedidos por WhatsApp se retiran únicamente en ' || nombre || ' (' || direccion || ').' from base2 where pickup limit 1),
    'reparto', (
      select jsonb_build_object(
        'hay_reparto_hoy', dia = any(delivery_dias),
        'desde', to_char(delivery_desde, 'HH24:MI'),
        'hasta', to_char(delivery_hasta_hoy, 'HH24:MI'),
        'disponible_ahora', dia = any(delivery_dias) and hora >= delivery_desde and hora < delivery_hasta_hoy,
        'motivo', case
          when not (dia = any(delivery_dias)) then 'Hoy no hay reparto a domicilio (los domingos no se reparte)'
          when hora < delivery_desde then 'El reparto arranca a las ' || to_char(delivery_desde, 'HH24:MI')
          when hora >= delivery_hasta_hoy then 'El reparto de hoy ya cerró (último envío ' || to_char(delivery_hasta_hoy, 'HH24:MI') || '); se puede coordinar para mañana'
          else 'Hay reparto disponible en este momento, hasta las ' || to_char(delivery_hasta_hoy, 'HH24:MI')
        end
      )
      from base2 where pickup limit 1
    )
  );
$function$;

-- los domingos: Santa Inés hasta las 14 (Leandro) y Saint Thomas hasta las 20 (lo que le dijo el equipo al cliente el 18/10)
update public.sucursales set horario_por_dia = '{"0":{"cierra":"14:00"}}'::jsonb where nombre = 'Suc Santa Ines';
update public.sucursales set horario_por_dia = '{"0":{"cierra":"20:00"}}'::jsonb where nombre = 'Suc Sant Thomas';

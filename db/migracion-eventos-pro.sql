-- ============================================================
-- EVENTOS PROFESIONAL (21/10/2026, pedido de Leandro: la pantalla de Eventos
-- "es basura")
--
-- La pantalla nueva carga eventos para gente que todavía no es cliente
-- (contacto nuevo: nombre + WhatsApp), anota dónde es la fiesta y de qué
-- oportunidad salió (cumpleaños, empresa para fin de año, compra grande o a
-- mano). La tabla `eventos` solo tenía nombre, fecha, invitados y notas.
--
-- Aditiva: cuatro columnas que aceptan null. No se toca nada de lo que hay.
--
--   lugar              salón, quinta, oficina… (sale también en el PDF)
--   contacto_nombre    quién habla por el evento (puede no ser el titular
--   contacto_telefono  del cliente: la novia, la secretaria de la empresa).
--                      El teléfono va solo con dígitos.
--   origen             manual | cumpleanos | fin_de_ano | compra_grande:
--                      para saber qué oportunidades terminan en venta.
--
-- El API funciona igual SIN esta migración: si la base rechaza las columnas
-- nuevas (PGRST204), reintenta y deja el lugar y el contacto escritos en las
-- notas (apps/api/src/eventos/eventos.logica.ts → pasarExtrasANotas).
--
-- Los índices que usa la pantalla ya existen: idx_eventos_estado (estado,
-- fecha) e idx_eventos_cliente (cliente_id).
-- ============================================================

alter table public.eventos add column if not exists lugar text;
alter table public.eventos add column if not exists contacto_nombre text;
alter table public.eventos add column if not exists contacto_telefono text;
alter table public.eventos add column if not exists origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_origen_valido') then
    alter table public.eventos
      add constraint eventos_origen_valido
      check (origen is null or origen in ('manual', 'cumpleanos', 'fin_de_ano', 'compra_grande'));
  end if;
end $$;

comment on column public.eventos.lugar is 'Dónde es el evento (salón, quinta, oficina). Sale en el presupuesto.';
comment on column public.eventos.contacto_nombre is 'Quién habla por el evento, si no es el titular del cliente.';
comment on column public.eventos.contacto_telefono is 'WhatsApp del contacto, solo dígitos.';
comment on column public.eventos.origen is 'De dónde salió: manual, cumpleanos, fin_de_ano o compra_grande.';

-- que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------
-- Cumpleaños: el que cumple HOY (revisión del 21/10/2026)
--
-- cumpleanos_proximos() armaba el próximo cumpleaños con age(), que usa el
-- día de la base (Londres): el día del cumpleaños age() ya da los años justos
-- y el "próximo" saltaba al año siguiente (365 días, fuera de la lista), y
-- desde las 21 h de Buenos Aires pasaba lo mismo con el de mañana. La usa la
-- invitación automática a armar el festejo (mensajes/automaticas.service.ts).
-- La pantalla de Eventos ya no depende de esta función: hace la misma cuenta
-- en el API (eventos.logica.ts → proximoCumple).
--
-- Ahora: el cumpleaños de este año o del que viene, el primero que no pasó,
-- contado desde el día de Buenos Aires. El 29/2 se festeja el 28/2 los años
-- que no son bisiestos.
-- ------------------------------------------------------------------------

create or replace function public.cumpleanos_proximos(p_dias integer default 60)
 returns table(cliente_id uuid, nombre text, dni text, fecha_nacimiento date, dias integer, tiene_evento boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with h as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy),
  calc as (
    select c.id, c.nombre, c.dni, c.fecha_nacimiento, h.hoy,
      (select min(x.d) from (
         select make_date(a, extract(month from c.fecha_nacimiento)::int,
                least(extract(day from c.fecha_nacimiento)::int,
                      extract(day from (make_date(a, extract(month from c.fecha_nacimiento)::int, 1) + interval '1 month - 1 day'))::int)) as d
         from generate_series(extract(year from h.hoy)::int, extract(year from h.hoy)::int + 1) a
       ) x where x.d >= h.hoy) as prox
    from clientes c cross join h
    where c.fecha_nacimiento is not null
  )
  select calc.id, calc.nombre, calc.dni, calc.fecha_nacimiento, (calc.prox - calc.hoy)::int as dias,
    exists(
      select 1 from eventos e
      where e.cliente_id = calc.id and e.tipo = 'cumpleanos'
        and e.fecha between calc.hoy and calc.hoy + 400
    ) as tiene_evento
  from calc
  where (calc.prox - calc.hoy) between 0 and p_dias
  order by dias;
$function$;

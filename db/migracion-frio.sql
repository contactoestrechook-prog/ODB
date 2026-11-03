-- FRÍO: LAS CÁMARAS Y HELADERAS CON LOS SENSORES QBIT (Leandro, 3/11/2026).
-- APLICADA en producción el 3/11/2026 (migración frio_sensores_qbit).
--
-- Bitronic (QBIT) da por API la última medición de cada sensor. ODB la consulta
-- una vez por minuto (el lector de la API, frio.task.ts) y la guarda acá: la
-- historia es nuestra, aunque QBIT no habilite el histórico por fecha.
--   - frio_equipos: cada sensor con su nombre, su rango y el orden en pantalla.
--     Los rangos son los que tiene cada alarma en el panel de QBIT (fotos del 3/11).
--   - frio_mediciones: una fila por medición (equipo + hora de QBIT): volver a
--     guardar la misma medición no la duplica.
--   - frio_serie(): la serie promediada por tramos para la pantalla (1 min a 1 h),
--     en un solo jsonb (PostgREST corta en 1.000 filas).
--   - frio_planilla(): el resumen por día de un mes, para Bromatología.
-- Por ahora SIN avisos por WhatsApp (Leandro, 3/11: «por ahora sin aviso»).
-- Aditiva: mientras no esté aplicada, el lector deja un aviso en el log y la
-- pantalla dice que todavía no hay mediciones.

create table if not exists public.frio_equipos (
  idequipo text primary key,                 -- el id del sensor en QBIT (sensor-panel?id=…)
  codigo text not null,                      -- F-01, F-02…: el número en la pantalla
  nombre text not null,
  sucursal_id uuid references public.sucursales(id),
  minimo numeric(6,2) not null,
  maximo numeric(6,2) not null check (maximo > minimo),
  demora_min int not null default 20,        -- minutos fuera de rango antes de contar como episodio
  orden int not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table public.frio_equipos is
  'Sensores de temperatura QBIT (Bitronic) de cámaras y heladeras: nombre, rango y orden en la pantalla /frio. 3/11/2026.';

create table if not exists public.frio_mediciones (
  idequipo text not null references public.frio_equipos(idequipo),
  medido_en timestamptz not null,            -- datatime de QBIT (hora argentina)
  temperatura numeric(6,2) not null,
  guardado_en timestamptz not null default now(),
  primary key (idequipo, medido_en)
);
create index if not exists frio_mediciones_medido_en on public.frio_mediciones (medido_en);
comment on table public.frio_mediciones is
  'Una medición por fila, tal como la dio QBIT. La guarda el lector de la API una vez por minuto. 3/11/2026.';

alter table public.frio_equipos enable row level security;
alter table public.frio_mediciones enable row level security;

-- Los tres equipos que mandó Leandro el 3/11 (rangos de sus alarmas en QBIT)
insert into public.frio_equipos (idequipo, codigo, nombre, minimo, maximo, demora_min, orden) values
  ('2794', 'F-01', 'Cámara lácteos exterior', -2, 11, 20, 1),
  ('2793', 'F-02', 'Cámara congelados depósito', -21, -1, 20, 2),
  ('2795', 'F-03', 'Heladera congelados frente negro dos puertas', -23, -4, 20, 3)
on conflict (idequipo) do nothing;

-- La serie de cada equipo desde p_desde, promediada por tramos de p_paso minutos:
-- {"2794": [[minuto_epoch, promedio, minimo, maximo], …], …}
create or replace function public.frio_serie(p_desde timestamptz, p_paso int default 1)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(idequipo, puntos), '{}'::jsonb) from (
    select idequipo, jsonb_agg(jsonb_build_array(t, prom, mn, mx) order by t) puntos from (
      select idequipo,
             (floor(extract(epoch from medido_en) / 60 / greatest(p_paso, 1)) * greatest(p_paso, 1))::bigint t,
             round(avg(temperatura), 2) prom, min(temperatura) mn, max(temperatura) mx
        from public.frio_mediciones
       where medido_en >= p_desde
       group by 1, 2
    ) x group by idequipo
  ) y;
$$;

-- El mes de un equipo día por día, para la planilla de Bromatología: mínima,
-- máxima y promedio, cuántas mediciones y cuántas quedaron fuera del rango.
create or replace function public.frio_planilla(p_idequipo text, p_mes date)
returns table (dia date, mediciones int, minima numeric, maxima numeric, promedio numeric, fuera_de_rango int)
language sql stable as $$
  select (m.medido_en at time zone 'America/Argentina/Buenos_Aires')::date dia,
         count(*)::int, min(m.temperatura), max(m.temperatura), round(avg(m.temperatura), 2),
         count(*) filter (where m.temperatura < e.minimo or m.temperatura > e.maximo)::int
    from public.frio_mediciones m join public.frio_equipos e using (idequipo)
   where m.idequipo = p_idequipo
     and m.medido_en >= (date_trunc('month', p_mes)::date)::timestamp at time zone 'America/Argentina/Buenos_Aires'
     and m.medido_en < ((date_trunc('month', p_mes) + interval '1 month')::date)::timestamp at time zone 'America/Argentina/Buenos_Aires'
   group by 1 order by 1;
$$;

revoke all on function public.frio_serie(timestamptz, int) from public, anon, authenticated;
revoke all on function public.frio_planilla(text, date) from public, anon, authenticated;
grant execute on function public.frio_serie(timestamptz, int) to service_role;
grant execute on function public.frio_planilla(text, date) to service_role;

-- MERCADO PAGO MES A MES Y LA PLATA REAL (Leandro, 5/11/2026: «mejoremos muchísimo
-- el módulo Mercado Pago… a otro nivel» y «análisis mes a mes»).
-- El 5/11 se trajo a mp_pagos toda la historia de las dos cuentas (desde el
-- 5/10/2025). Estas funciones la resumen en la base: PostgREST corta en 1.000
-- filas y son decenas de miles de pagos.
--   - mp_mensual(): un renglón por mes, cuenta, tipo de pago y si es
--     transferencia recibida (PSP_TRANSFER: plata que entra a la cuenta, no una
--     venta), con cobros, bruto, comisión y neto. Solo pagos aprobados.
--   - mp_dias(): lo mismo por día, para abrir un mes.
--   - mp_liberaciones(): lo que Mercado Pago libera cada día (fecha de
--     liberación de cada pago y su neto), para el calendario de la plata.
-- Fechas en hora argentina. Solo lectura. Aditiva. APLICADA en producción el 5/11/2026 (migración mp_mes_a_mes).

create index if not exists mp_pagos_creado_en_mp on public.mp_pagos (creado_en_mp);
create index if not exists mp_pagos_liberacion_en on public.mp_pagos (liberacion_en);

create or replace function public.mp_mensual(p_desde date, p_cuenta text default null)
returns table (mes text, cuenta text, tipo text, transferencia boolean, cobros int, bruto numeric, comision numeric, neto numeric, dias int)
language sql stable as $$
  select to_char(date_trunc('month', creado_en_mp at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM'),
         cuenta, coalesce(tipo, 'otro'), coalesce(origen = 'PSP_TRANSFER', false),
         count(*)::int, round(sum(bruto), 2), round(sum(comision), 2), round(sum(neto), 2),
         count(distinct (creado_en_mp at time zone 'America/Argentina/Buenos_Aires')::date)::int
    from public.mp_pagos
   where estado = 'approved'
     and creado_en_mp >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
     and (p_cuenta is null or cuenta = p_cuenta)
   group by 1, 2, 3, 4;
$$;

create or replace function public.mp_dias(p_desde date, p_hasta date, p_cuenta text default null)
returns table (dia date, cuenta text, tipo text, transferencia boolean, cobros int, bruto numeric, comision numeric, neto numeric)
language sql stable as $$
  select (creado_en_mp at time zone 'America/Argentina/Buenos_Aires')::date, cuenta, coalesce(tipo, 'otro'), coalesce(origen = 'PSP_TRANSFER', false),
         count(*)::int, round(sum(bruto), 2), round(sum(comision), 2), round(sum(neto), 2)
    from public.mp_pagos
   where estado = 'approved'
     and creado_en_mp >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
     and creado_en_mp < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
     and (p_cuenta is null or cuenta = p_cuenta)
   group by 1, 2, 3, 4;
$$;

create or replace function public.mp_liberaciones(p_desde date, p_hasta date, p_cuenta text default null)
returns table (dia date, cuenta text, tipo text, pagos int, neto numeric)
language sql stable as $$
  select (liberacion_en at time zone 'America/Argentina/Buenos_Aires')::date, cuenta, coalesce(tipo, 'otro'), count(*)::int, round(sum(neto), 2)
    from public.mp_pagos
   where estado = 'approved' and liberacion_en is not null
     and liberacion_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
     and liberacion_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
     and (p_cuenta is null or cuenta = p_cuenta)
   group by 1, 2, 3;
$$;

revoke all on function public.mp_mensual(date, text) from public, anon, authenticated;
revoke all on function public.mp_dias(date, date, text) from public, anon, authenticated;
revoke all on function public.mp_liberaciones(date, date, text) from public, anon, authenticated;
grant execute on function public.mp_mensual(date, text) to service_role;
grant execute on function public.mp_dias(date, date, text) to service_role;
grant execute on function public.mp_liberaciones(date, date, text) to service_role;

-- EL MOTOR DE ABASTECIMIENTO VUELVE A TARDAR MENOS DE UN SEGUNDO (13/11/2026)
--
-- Qué pasó: el 12/11 a la noche se cargaron 32.369 renglones de ventas del
-- Crack (Santa Inés al día, una fila por día) y abastecimiento() pasó de ~2,5 s
-- a 15–17 s. PostgREST corta a los 8 s: desde esa noche toda lectura completa
-- del motor fallaba (Mesa de compras, el Analista, el informe de las 7,
-- Promociones, Estadísticas y la entrada nueva de Inventario de producto).
--
-- Por qué: «per_suc» (d1 y d2, cuántos días de cada ventana de 28 tienen ventas
-- cargadas) es una cuenta por sucursal (dos filas), pero Postgres metía el CTE
-- adentro de la consulta principal y repetía sus dos subconsultas para cada
-- renglón producto × sucursal: 18.488 veces × 28 días × los 130 períodos. Con
-- «materialized» se calcula una vez. El resultado es idéntico (se comprobó con
-- la huella md5 de las 9.244 filas antes y después).
--
-- Se cambia solo esa palabra sobre la versión viva (como el parche del ritmo de
-- migracion-puesta-al-dia.sql); si el bloque no está donde se espera, falla.
-- Para volver atrás: el mismo reemplazo al revés.
do $parche$
declare
  d text := pg_get_functiondef('public.abastecimiento'::regproc);
begin
  if position(E'\nper_suc as materialized (' in d) > 0 then
    raise notice 'abastecimiento ya calcula per_suc una sola vez: no se toca';
    return;
  end if;
  if (select count(*) from regexp_matches(d, E'\\nper_suc as \\(', 'g')) <> 1 then
    raise exception 'abastecimiento cambió: revisar a mano el bloque per_suc';
  end if;
  execute replace(d, E'\nper_suc as (', E'\nper_suc as materialized (');
end
$parche$;

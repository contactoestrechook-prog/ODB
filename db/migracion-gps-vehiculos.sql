-- ============================================================
-- GPS EN LOS VEHÍCULOS (2026-11-03)
--
-- La ubicación del reparto salía solo del celular de quien maneja (Reparto ›
-- Mis entregas › «Compartir mi ubicación»): si bloqueaba el teléfono o se
-- olvidaba del botón, la camioneta desaparecía del mapa. Ahora el vehículo
-- puede tener su propio equipo GPS. Traccar (o la app Traccar Client) le manda
-- la posición a la API (/gps/traccar, /gps/osmand) y esa posición entra igual
-- que la del celular: el mapa de flota del repartidor y el seguimiento de los
-- envíos en camino.
--
-- gps_id es el identificador con que se presenta el equipo (el IMEI en un
-- Teltonika o un Concox; el «identificador del dispositivo» en Traccar Client).
-- Un equipo no puede estar en dos vehículos activos a la vez.
-- ============================================================

alter table public.vehiculos
  add column if not exists gps_id text,
  add column if not exists gps_lat double precision,
  add column if not exists gps_lng double precision,
  add column if not exists gps_velocidad numeric,  -- km/h
  add column if not exists gps_en timestamptz;     -- hora de la lectura en el equipo

create unique index if not exists vehiculos_gps_id_activo_key
  on public.vehiculos (gps_id) where gps_id is not null and activo;

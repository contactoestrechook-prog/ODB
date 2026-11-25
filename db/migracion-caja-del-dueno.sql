-- CAJA DEL DUEÑO (25/11/2026). Leandro: «juampi quiere tener en el sistema un balance
-- de lo que ingresa y egresa de la caja… no lo que se cobra a los clientes sino el
-- como dueño lleva el control… ahora está usando un Excel»; con la captura del Excel:
-- «armala lo más parecida a su Excel así sigue la misma línea».
--
-- El Excel: cuadros de ingresos por origen (OTROS, REPARTO, CAJA ST THOMAS), cada uno
-- con Fecha · Motivo · Monto y su total; un cuadro de egresos; TOTAL INGRESOS, TOTAL
-- EGRESOS y el Total. Acá, lo mismo:
--   caja_dueno_cuadros      los cuadros de ingresos, en el orden del Excel (él suma más)
--   caja_dueno_movimientos  cada renglón: ingreso (de un cuadro) o egreso
-- Lo ve y lo carga quien tenga el permiso `caja_dueno` en usuarios.permisos (hoy, solo
-- Juan Pablo). Borrar no borra: marca borrado_en (queda quién y cuándo).
--
-- APLICADA por MCP en utemmsmuwocerhmuxrbs (caja_del_dueno).
create table if not exists public.caja_dueno_cuadros (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  orden integer not null default 0,
  activo boolean not null default true,
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);

create table if not exists public.caja_dueno_movimientos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  cuadro_id uuid references public.caja_dueno_cuadros(id),
  fecha date not null,
  motivo text not null default '' check (length(motivo) <= 200),
  monto numeric(14, 2) not null check (monto > 0),
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id),
  actualizado_en timestamptz,
  borrado_por uuid references public.usuarios(id),
  borrado_en timestamptz,
  -- los ingresos van en un cuadro; los egresos, en el cuadro de egresos (sin cuadro)
  constraint caja_dueno_ingreso_con_cuadro check ((tipo = 'ingreso') = (cuadro_id is not null))
);
create index if not exists caja_dueno_movimientos_fecha on public.caja_dueno_movimientos (fecha) where borrado_en is null;

alter table public.caja_dueno_cuadros enable row level security;
alter table public.caja_dueno_movimientos enable row level security;
revoke all on public.caja_dueno_cuadros from anon, authenticated;
revoke all on public.caja_dueno_movimientos from anon, authenticated;

-- los cuadros del Excel, en su orden
insert into public.caja_dueno_cuadros (nombre, orden)
select v.nombre, v.orden from (values ('OTROS', 1), ('REPARTO', 2), ('CAJA ST THOMAS', 3)) as v(nombre, orden)
where not exists (select 1 from public.caja_dueno_cuadros);

-- el permiso: Juan Pablo
update public.usuarios
   set permisos = array(select distinct unnest(permisos || array['caja_dueno']))
 where id = 'f30e4bf1-ea26-4235-916d-6e3bb588ce12' and nombre = 'Juan Pablo Fernandez';

-- LO QUE YA TENÍA EL EXCEL (captura del 25/11/2026), cargado una sola vez por MCP. El
-- «arqueo» de REPARTO no tenía fecha en la planilla: va con el 7/11, como el otro
-- renglón de ese cuadro.
with c as (select id, nombre from public.caja_dueno_cuadros where activo),
filas(tipo, cuadro, fecha, motivo, monto, n) as (values
  ('ingreso','OTROS','2026-11-10','Fruit',10511300,1),
  ('ingreso','OTROS','2026-11-10','Reingreso',11000000,2),
  ('ingreso','REPARTO','2026-11-07','arqueo',62000,3),
  ('ingreso','REPARTO','2026-11-07','Romina Escribana',91000,4),
  ('ingreso','CAJA ST THOMAS','2026-11-06','Inicio',1123000,5),
  ('ingreso','CAJA ST THOMAS','2026-11-07','Retiro',5100000,6),
  ('egreso',null,'2026-11-07','CCU',686000,7),
  ('egreso',null,'2026-11-07','Leo',756000,8),
  ('egreso',null,'2026-11-07','Retiro',4000000,9))
insert into public.caja_dueno_movimientos (tipo, cuadro_id, fecha, motivo, monto, creado_en)
select f.tipo, c.id, f.fecha::date, f.motivo, f.monto, now() + (f.n || ' milliseconds')::interval
from filas f left join c on c.nombre = f.cuadro
where not exists (select 1 from public.caja_dueno_movimientos);

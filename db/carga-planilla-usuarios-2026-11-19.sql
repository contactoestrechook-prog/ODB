-- Permisos de la planilla de St Thomas y Santa Inés (Leandro, 19/11/2026).
-- Va DESPUÉS de publicar d034cb8 (con la versión anterior, Fiambrería no
-- quedaba encerrada en Salón). Cada cambio queda en auditoria con el antes.
--
-- No figuran en la planilla y NO se tocan: Leandro (dueño), «Melina Orsi»
-- (dueño) y «Orsi Melina» (op salón St Thomas).

begin;

create temp table planilla (email text, roles rol_usuario[], sucursal text) on commit drop;
insert into planilla values
  -- St Thomas
  ('alexis.al872@gmail.com',          '{cajero,op_salon}',            'Suc Sant Thomas'),
  ('pedrozacarias16@gmail.com',       '{deposito}',                   'Suc Sant Thomas'),
  ('bartacovich@gmail.com',           '{cajero,repartidor,op_salon}', 'Suc Sant Thomas'),
  ('lukavillarrealmoyano@gmail.com',  '{deposito}',                   'Suc Sant Thomas'),
  ('marugr2002@hotmail.com',          '{cajero}',                     'Suc Sant Thomas'),
  ('yesica.cordova20@gmail.com',      '{fiambreria}',                 'Suc Sant Thomas'),
  ('avalospfederico@gmail.com',       '{deposito,repartidor}',        'Suc Sant Thomas'),
  ('torresguadalupetg@gmail.com',     '{cajero}',                     'Suc Sant Thomas'),
  ('milig200e3@gmail.com',            '{fiambreria}',                 'Suc Sant Thomas'),
  ('yanetmolicami@gmail.com',         '{fiambreria}',                 'Suc Sant Thomas'),
  -- las dos sucursales
  ('romina.grp@live.com.ar',          '{administrativo,cajero}',      null),
  ('anabellaromani@gmail.com',        '{administrativo,cajero}',      null),
  ('jpfernandez82@gmail.com',         '{dueno}',                      null),
  ('jaqueline.cuadrado@gmail.com',    '{dueno}',                      null),
  -- Santa Inés
  ('calabreseailin5@gmail.com',       '{cajero}',                     'Suc Santa Ines');

-- auditoría: el antes y el después de cada uno que cambia
insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
select (select id from usuarios where email = 'leandro@odb.com.ar'), 'editar_usuario', 'usuario', u.id::text,
       jsonb_build_object('rol', u.rol, 'roles', u.roles, 'sucursal_id', u.sucursal_id),
       jsonb_build_object('rol', p.roles[1], 'roles', p.roles, 'sucursal_id', s.id, 'motivo', 'planilla de permisos 19/11/2026')
from planilla p
join usuarios u on u.email = p.email
left join sucursales s on s.nombre = p.sucursal
where u.roles is distinct from p.roles or u.sucursal_id is distinct from s.id;

update usuarios u
   set rol = p.roles[1], roles = p.roles, sucursal_id = s.id
  from planilla p
  left join sucursales s on s.nombre = p.sucursal
 where u.email = p.email
   and (u.roles is distinct from p.roles or u.sucursal_id is distinct from s.id);

-- los 4 que faltan: con sus permisos, inactivos hasta que administración les
-- ponga email, WhatsApp y clave (sin clave no entra nadie: verificar_login)
insert into usuarios (nombre, email, rol, roles, sucursal_id, activo, alta_pendiente, debe_cambiar_clave)
select v.nombre, v.email, v.roles[1], v.roles, s.id, false, true, true
from (values
  ('Bárbara Ángeles Bartacovich', 'barbara.bartacovich@pendiente.odb.interno', '{fiambreria}'::rol_usuario[],          'Suc Sant Thomas'),
  ('María Belén Avalos',          'mariabelen.avalos@pendiente.odb.interno',  '{fiambreria}'::rol_usuario[],          'Suc Sant Thomas'),
  ('Agustín Martínez',            'agustin.martinez@pendiente.odb.interno',   '{deposito,repartidor}'::rol_usuario[], 'Suc Santa Ines'),
  ('Karen Daiana Moreno',         'karen.moreno@pendiente.odb.interno',       '{cajero}'::rol_usuario[],              'Suc Santa Ines')
) as v(nombre, email, roles, sucursal)
join sucursales s on s.nombre = v.sucursal
on conflict (email) do nothing;

insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)
select (select id from usuarios where email = 'leandro@odb.com.ar'), 'crear_usuario', 'usuario', u.id::text,
       jsonb_build_object('rol', u.rol, 'roles', u.roles, 'sucursal_id', u.sucursal_id, 'alta_pendiente', true, 'motivo', 'planilla de permisos 19/11/2026')
from usuarios u
where u.email like '%@pendiente.odb.interno'
  and not exists (select 1 from auditoria a where a.entidad = 'usuario' and a.entidad_id = u.id::text and a.accion = 'crear_usuario');

-- el aviso a Romina (campanita): se cierra solo cuando completa el último
insert into alertas_internas (para_usuario, tipo, titulo, detalle, referencia)
select r.id, 'usuarios_para_completar',
       'Completá ' || count(p.*) || ' usuarios nuevos',
       'Ya tienen sus permisos. Falta el email, el WhatsApp y la clave de: ' || string_agg(p.nombre, ', ' order by p.nombre) || '. Con eso quedan activos y les mandás los accesos.',
       jsonb_build_object('link', '/usuarios')
from usuarios r, usuarios p
where r.email = 'romina.grp@live.com.ar' and p.alta_pendiente
  and not exists (select 1 from alertas_internas a where a.tipo = 'usuarios_para_completar' and a.leida_en is null)
group by r.id;

commit;

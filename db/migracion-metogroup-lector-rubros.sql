-- MetoGroup lee de acá, una vez por día, los proveedores de ODB que son
-- BODEGAS o DISTRIBUIDORES DE ALIMENTOS, con su contacto.
--
-- El rubro sale de lo que cada proveedor le vende a ODB (proveedor_productos →
-- categoría raíz): la mitad o más en vinos y espumantes = Bodegas; seis de cada
-- diez o más en alimentos = Distribuidores de alimentos. Lo que es bebida, limpieza,
-- perfumería, bazar, etc. no sale.
--
-- Sale el nombre, CUIT, dirección, web, mail, teléfono y los WhatsApp de la gente
-- del proveedor que le escribe a ODB. NO salen precios, condiciones, banco, CBU,
-- facturas ni pedidos.
--
-- Lo lee el usuario metogroup_lector, que sólo puede ver esta vista. La clave se
-- pone aparte (alter role … password) y NO va en este archivo.

create schema if not exists metogroup;
revoke all on schema metogroup from public;
revoke all on schema metogroup from anon, authenticated;

create or replace view metogroup.rubros as
with recursive cat as (
  select id, nombre::text as raiz from public.categorias where padre_id is null
  union all
  select x.id, cat.raiz from public.categorias x join cat on cat.id = x.padre_id
),
v as (
  select pp.proveedor_id, lower(c.raiz) as r
  from public.proveedor_productos pp
  join public.productos p on p.id = pp.producto_id
  join cat c on c.id = p.categoria_id
),
k as (
  select proveedor_id,
         count(*) filter (where r ~ '(vino|espumante|añada|cavas)') as vino,
         count(*) filter (where r ~ '(gin|whisk|licor|aperitiv|vodka|ron$|tequila|destilad|cervez|agua|gaseosa|jugo|energiz|bebida|sidra|estucher|bazar|perfum|higiene|limpi|papel|tabaco|cristal|pilas|deco|adhesiv|accesorio|leña|parrilla|repelente|insectic|algod|alcohol|aerosol|jab[oó]n|lavandin|rejilla|esponja|bolsa|depila|shampoo|antitransp|lavavaj|desinfect|mascota|varios|combos|navidad|halloween|regaler|previas|barr)') as otro,
         count(*) as total
  from v group by 1
),
c as (
  select p.*,
         coalesce(k.vino, 0) as n_vino,
         coalesce(k.total, 0) - coalesce(k.vino, 0) - coalesce(k.otro, 0) as n_alim,
         coalesce(k.total, 0) as n_total,
         case
           when p.razon_social || ' ' || coalesce(p.nombre_fantasia, '') ~* '(bodega|wines?\M|vinos|finca|viñedo|vinedo|vitivin|schroeder|zuccardi|escorihuela)'
             or (coalesce(k.total, 0) > 0 and k.vino::numeric / k.total >= 0.5) then 'Bodegas'
           when coalesce(k.total, 0) > 0
             and (k.total - k.vino - k.otro)::numeric / k.total >= 0.6 then 'Distribuidores de alimentos'
         end as rubro_mg
  from public.proveedores p
  left join k on k.proveedor_id = p.id
  where p.activo
    -- proveedores comodín y lo propio de ODB
    and p.razon_social !~* '^(proveedores varios.*|golosinas importadas|importados|panaderia|carniceria|congelados|huevos|frutos secos|vinotecas|ml)$'
    and p.razon_social !~* '(^lista |\(lista|odb)'
),
wa as (
  select s.proveedor_id,
         (array_agg(s.telefono order by s.creado_en))[1] as tel,
         (array_agg(s.contacto order by s.creado_en))[1] as nombre,
         string_agg(distinct coalesce(nullif(s.contacto, ''), 'Sin nombre') || ': ' || s.telefono, ' · ') as todos,
         count(*) as n
  from public.proveedor_whatsapp_sugerencias s
  group by 1
)
select
  'odb:' || c.id                                                         as origen_id,
  null::text                                                             as place_id,
  c.rubro_mg                                                             as rubro,
  case c.rubro_mg
    when 'Bodegas' then 'le vende vinos a ODB'
    else 'le vende alimentos a ODB'
  end || case when c.n_total > 0 then ' (' || case c.rubro_mg when 'Bodegas' then c.n_vino else c.n_alim end
                                       || ' de ' || c.n_total || ' productos)' else '' end as tipo,
  coalesce(nullif(c.nombre_fantasia, ''), c.razon_social)                 as empresa,
  nullif(c.direccion, '')                                                as direccion,
  nullif(c.localidad, '')                                                as localidad,
  coalesce(nullif(c.telefono, ''), nullif(c.telefono_fijo, ''), wa.tel)   as telefono,
  coalesce(wa.tel, nullif(c.telefono, ''))                               as whatsapp,
  nullif(c.email, '')                                                    as email,
  nullif(c.web, '')                                                      as web,
  null::text                                                             as instagram,
  null::text                                                             as facebook,
  null::text                                                             as maps_url,
  null::numeric                                                          as calificacion,
  null::integer                                                          as resenas,
  nullif(wa.nombre, '')                                                  as contacto,
  nullif(c.cuit, '')                                                     as cuit,
  case when wa.n > 1 or nullif(c.telefono_fijo, '') is not null then
    concat_ws(' · ', case when wa.n > 1 then wa.todos end,
                     case when nullif(c.telefono_fijo, '') is not null then 'Fijo: ' || c.telefono_fijo end)
  end                                                                    as otros_contactos,
  case when nullif(c.razon_social, '') is distinct from nullif(c.nombre_fantasia, '')
        and nullif(c.nombre_fantasia, '') is not null then 'Razón social: ' || c.razon_social end as detalle,
  false                                                                  as de_google
from c
left join wa on wa.proveedor_id = c.id
where c.rubro_mg is not null;

revoke all on metogroup.rubros from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'metogroup_lector') then
    create role metogroup_lector login noinherit connection limit 3;
  end if;
end $$;
alter role metogroup_lector set statement_timeout = '60s';
grant usage on schema metogroup to metogroup_lector;
grant select on metogroup.rubros to metogroup_lector;

comment on view metogroup.rubros is
  'La lee MetoGroup una vez por día (base de datos por rubro): bodegas y distribuidores de alimentos con su contacto.';

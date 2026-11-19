-- Varios roles por persona + Fiambrería + altas para completar
-- (Leandro, 19/11/2026, con la planilla de St Thomas y Santa Inés: «todos los
-- usuarios que tienen que tener los permisos de cada uno, hay que crear los que
-- faltan y que le salte alerta a Romina para que termine de crearlos con
-- teléfonos y contraseñas»).
--
-- La planilla le da a una misma persona varias áreas (Caja + Op salón + Reparto,
-- Administrativo + Caja, Reparto + Depósito). Hasta hoy un usuario tenía UN rol.
--
--   usuarios.rol    sigue siendo el rol principal: adónde entra al loguearse y
--                   lo que mira todo el código que ya compara un solo rol.
--   usuarios.roles  TODOS sus roles, con el principal primero. La API deja pasar
--                   si alguno sirve, y en cada pedido actúa con el rol que le
--                   abrió la puerta (auth/roles.ts): una administrativa que
--                   también es cajera, en la caja, es una cajera.
--
-- PARTE 1 (va sola: un valor nuevo de enum no se puede usar en la misma
-- transacción en la que se agrega).
alter type rol_usuario add value if not exists 'fiambreria';

-- PARTE 2
alter table usuarios add column if not exists roles rol_usuario[] not null default '{}';
-- alta para completar: la cargó un dueño desde la planilla y administración le
-- pone email, WhatsApp y clave. Mientras tanto queda inactiva (no puede entrar).
alter table usuarios add column if not exists alta_pendiente boolean not null default false;

update usuarios set roles = array[rol] where cardinality(roles) = 0;

-- roles siempre incluye al principal, primero y sin repetidos. Si el código viejo
-- cambia solo `rol`, el principal anterior se reemplaza (no queda como extra).
create or replace function usuarios_roles_coherentes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.rol is distinct from old.rol and new.roles is not distinct from old.roles then
    new.roles := array_replace(new.roles, old.rol, new.rol);
  end if;
  if new.roles is null or cardinality(new.roles) = 0 then
    new.roles := array[new.rol];
  end if;
  new.roles := array(
    select r from (
      select r, min(i) as i from unnest(array[new.rol] || new.roles) with ordinality as t(r, i) group by r
    ) x order by i
  );
  return new;
end $$;

drop trigger if exists trg_usuarios_roles on usuarios;
create trigger trg_usuarios_roles before insert or update of rol, roles on usuarios
  for each row execute function usuarios_roles_coherentes();

create index if not exists usuarios_roles_gin on usuarios using gin (roles);

-- verificar_login: con clave_hash vacío la comparación daba NULL y `if not v_ok`
-- no frenaba (NULL no es falso): entraba con cualquier clave. Hoy no hay ningún
-- usuario sin clave, pero las altas para completar nacen sin una que sepa nadie.
create or replace function public.verificar_login(p_email text, p_clave text)
 returns table(id uuid, nombre text, rol rol_usuario, sucursal_id uuid, debe_cambiar_clave boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  u record;
  v_ok boolean;
  v_limite constant integer := 5;
  v_espera constant interval := interval '15 minutes';
begin
  select * into u from usuarios where email = lower(trim(p_email)) and activo for update;
  if not found then
    return;
  end if;

  if u.bloqueado_hasta is not null and u.bloqueado_hasta > now() then
    raise exception 'Cuenta bloqueada por intentos fallidos. Probá de nuevo en % minutos.',
      greatest(1, ceil(extract(epoch from (u.bloqueado_hasta - now())) / 60))
      using errcode = 'P0001';
  end if;

  v_ok := case
    when u.clave_hash is null then false
    when u.clave_hash like '$2%' then u.clave_hash = crypt(p_clave, u.clave_hash)
    else u.clave_hash = encode(digest(p_clave, 'sha256'), 'hex')
  end;

  if v_ok is not true then
    update usuarios
      set intentos_fallidos = intentos_fallidos + 1,
          bloqueado_hasta = case when intentos_fallidos + 1 >= v_limite then now() + v_espera else bloqueado_hasta end
      where usuarios.id = u.id;
    return;
  end if;

  if u.intentos_fallidos <> 0 or u.bloqueado_hasta is not null then
    update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where usuarios.id = u.id;
  end if;

  return query select u.id, u.nombre, u.rol, u.sucursal_id, u.debe_cambiar_clave;
end $function$;

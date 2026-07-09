-- ============================================================================
-- Migración de seguridad — hashing de credenciales a bcrypt (modo dual)
-- Aplicada en Supabase (proyecto ODB) el 2026-07-01.
--
-- Contexto: verificar_login y aprobar_orden_compra guardaban/comparaban las
-- credenciales con SHA256 sin salt (encode(digest(x,'sha256'),'hex')), débil
-- ante fuerza bruta si se filtra la base. La API ahora crea usuarios con bcrypt
-- (bcryptjs, coste 10 → hashes de 60 chars que empiezan con $2). Estas funciones
-- aceptan AMBOS formatos durante la transición:
--   · hash de 60 chars  → bcrypt, se compara con crypt()
--   · hash de 64 chars  → SHA256 hex legacy (usuarios previos a la migración)
--
-- crypt()/gen_salt()/digest() viven en el esquema `extensions` (pgcrypto); por eso
-- ambas funciones fijan search_path = public, extensions.
-- ============================================================================

create or replace function public.verificar_login(p_email text, p_clave text)
returns table(id uuid, nombre text, rol rol_usuario, sucursal_id uuid)
language sql
stable security definer
set search_path to 'public','extensions'
as $function$
  select u.id, u.nombre, u.rol, u.sucursal_id
  from usuarios u
  where u.email = lower(trim(p_email))
    and u.activo
    and case
      when u.clave_hash like '$2%' then u.clave_hash = crypt(p_clave, u.clave_hash)
      else u.clave_hash = encode(digest(p_clave, 'sha256'), 'hex')
    end;
$function$;

create or replace function public.aprobar_orden_compra(p_oc uuid, p_usuario uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_oc ordenes_compra%rowtype;
  v_user usuarios%rowtype;
  v_ok boolean;
begin
  select * into v_oc from ordenes_compra where id = p_oc for update;
  if not found then raise exception 'No existe la orden de compra'; end if;
  if v_oc.estado <> 'pendiente_aprobacion' then
    raise exception 'La OC esta en estado %, no se puede aprobar', v_oc.estado;
  end if;

  select * into v_user from usuarios where id = p_usuario and activo;
  if not found then raise exception 'Usuario inexistente o inactivo'; end if;
  if v_user.pin_firma is null then raise exception 'PIN de firma incorrecto'; end if;
  -- bcrypt = 60 chars; SHA256 hex legacy = 64 chars
  if length(v_user.pin_firma) = 60 then
    v_ok := v_user.pin_firma = crypt(p_pin, v_user.pin_firma);
  else
    v_ok := v_user.pin_firma = encode(digest(p_pin, 'sha256'), 'hex');
  end if;
  if not v_ok then raise exception 'PIN de firma incorrecto'; end if;
  if v_user.limite_aprobacion < v_oc.total then
    raise exception 'El monto % supera el limite de aprobacion de % (%)',
      v_oc.total, v_user.nombre, v_user.limite_aprobacion;
  end if;

  insert into aprobaciones (entidad, entidad_id, usuario_id, hash_documento, metodo)
  values ('orden_compra', p_oc, p_usuario,
          md5(v_oc.id::text || v_oc.total::text || v_oc.proveedor_id::text), 'pin');
  update ordenes_compra set estado = 'aprobada' where id = p_oc;
end $function$;

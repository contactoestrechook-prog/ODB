-- Exportación del sistema viejo · PROVEEDORES (se aplica primero: los costos
-- buscan a los proveedores nuevos por CUIT o razón social).
-- Lee la carga que dejó preparar.mjs en auditoria (entidad 'sistema_viejo:proveedores').
-- Reemplazar __AUDITORIA_ID__ por el id y __ENSAYO__ por true (ensayo: termina con
-- un error que trae los números y la base vuelve atrás) o false (aplica).
-- Un solo bloque: todo o nada. Idempotente: un proveedor que ya existe (mismo
-- CUIT o misma razón social) no se vuelve a crear y solo se completan datos vacíos.
--   altas:     [razon_social, cuit, telefono, email, codigos_viejos] → quedan
--              «incompletos» (sin condición de pago ni plazo confirmado): las
--              órdenes de compra los piden antes de aprobarse, como corresponde.
--   completar: [proveedor_id, cuit, telefono, email] → solo lo que está vacío.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_ref text; v_pasada int; v_res text := ''; v_msg text;
  v_cuit text; v_tel text; v_mail text;
  n_altas int; n_ya int; n_comp int;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:proveedores';
  if a is null then raise exception 'no encuentro la carga % de proveedores', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia';

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_altas := 0; n_ya := 0; n_comp := 0;
    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'altas', '[]')) loop
      if exists (select 1 from proveedores p where (e->>1 is not null and p.cuit = e->>1) or lower(trim(p.razon_social)) = lower(trim(e->>0))) then
        n_ya := n_ya + 1; continue;
      end if;
      insert into proveedores (razon_social, cuit, telefono, email) values (trim(e->>0), e->>1, e->>2, e->>3);
      n_altas := n_altas + 1;
    end loop;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'completar', '[]')) loop
      select case when coalesce(p.cuit, '') = '' and e->>1 is not null and not exists (select 1 from proveedores o where o.cuit = e->>1) then e->>1 else p.cuit end,
             case when coalesce(p.telefono, '') = '' then coalesce(e->>2, p.telefono) else p.telefono end,
             case when coalesce(p.email, '') = '' then coalesce(e->>3, p.email) else p.email end
        into v_cuit, v_tel, v_mail
        from proveedores p where p.id = (e->>0)::uuid;
      update proveedores set cuit = v_cuit, telefono = v_tel, email = v_mail
       where id = (e->>0)::uuid and (cuit, telefono, email) is distinct from (v_cuit, v_tel, v_mail);
      if found then n_comp := n_comp + 1; end if;
    end loop;
    v_res := v_res || format(' | pasada %s: altas=%s ya_existian=%s completados=%s', v_pasada, n_altas, n_ya, n_comp);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK proveedores %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'altas', n_altas, 'ya_existian', n_ya, 'completados', n_comp))
   where id = v_id;
end $$;

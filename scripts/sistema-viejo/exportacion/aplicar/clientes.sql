-- Exportación del sistema viejo · CLIENTES (antes de la cuenta corriente).
-- Lee la carga de auditoria (entidad 'sistema_viejo:clientes'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- El código de cliente del viejo es OTRA numeración que clientes.codigo_legacy:
-- se guarda como 'st-<código>' y nunca se cruza por código (simular.mjs cruza por
-- CUIT, DNI, nombre, teléfono y email; lo dudoso queda a revisión).
--   altas:          [codigo_viejo, nombre, cuit, dni, condicion_iva, razon_social, telefono, email, barrio]
--   vincular:       [cliente_id, codigo_viejo, cuit, dni, telefono, email, condicion_iva, barrio]
--                   → completa SOLO lo vacío (nunca pisa un domicilio, teléfono o
--                   mail de ODB); el código 'st-' se pone si el cliente no tiene
--                   código (los de junio conservan el suyo: decisión del dueño).
--   normalizar_iva: [cliente_id, condicion_iva] → la condición en MAYÚSCULAS de la
--                   carga de junio no sirve para la factura A.
-- El DNI (sacado del CUIT de una persona) se carga solo si nadie lo tiene.
-- Idempotente: el alta se saltea si el código 'st-' ya existe; el resto solo cambia lo distinto.
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_ref text; c record; v_cod text;
  v_cuit text; v_dni text; v_tel text; v_mail text; v_iva text; v_barrio text; v_codigo text;
  v_pasada int; v_res text := ''; v_msg text;
  n_altas int; n_ya int; n_vinc int; n_sin int; n_iva int; n_dni_ocupado int;
  validas constant text[] := array['consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'];
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:clientes';
  if a is null then raise exception 'no encuentro la carga % de clientes', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia';

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_altas := 0; n_ya := 0; n_vinc := 0; n_sin := 0; n_iva := 0; n_dni_ocupado := 0;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'altas', '[]')) loop
      v_cod := 'st-' || (e->>0);
      if exists (select 1 from clientes where codigo_legacy = v_cod) then n_ya := n_ya + 1; continue; end if;
      v_dni := e->>3;
      if v_dni is not null and exists (select 1 from clientes where dni = v_dni) then v_dni := null; n_dni_ocupado := n_dni_ocupado + 1; end if;
      if coalesce(e->>4, 'consumidor_final') <> all (validas) then raise exception 'condición de IVA inválida % (cliente %)', e->>4, e->>0; end if;
      insert into clientes (nombre, cuit, dni, condicion_iva, razon_social, telefono, email, barrio, codigo_legacy)
      values (trim(e->>1), e->>2, v_dni, coalesce(e->>4, 'consumidor_final'), e->>5, e->>6, e->>7, e->>8, v_cod);
      n_altas := n_altas + 1;
    end loop;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'vincular', '[]')) loop
      select * into c from clientes where id = (e->>0)::uuid;
      if not found then n_sin := n_sin + 1; continue; end if;
      v_cod := 'st-' || (e->>1);
      v_codigo := case when c.codigo_legacy is null and not exists (select 1 from clientes o where o.codigo_legacy = v_cod) then v_cod else c.codigo_legacy end;
      v_cuit := case when coalesce(c.cuit, '') = '' then coalesce(e->>2, c.cuit) else c.cuit end;
      v_dni := case when c.dni is null and e->>3 is not null and not exists (select 1 from clientes o where o.dni = e->>3) then e->>3 else c.dni end;
      v_tel := case when coalesce(c.telefono, '') = '' then coalesce(e->>4, c.telefono) else c.telefono end;
      v_mail := case when coalesce(c.email, '') = '' then coalesce(e->>5, c.email) else c.email end;
      v_iva := case when e->>6 is not null and e->>6 = any (validas) and (c.condicion_iva <> all (validas) or c.condicion_iva = 'consumidor_final') then e->>6 else c.condicion_iva end;
      v_barrio := case when coalesce(c.barrio, '') = '' then coalesce(e->>7, c.barrio) else c.barrio end;
      update clientes set codigo_legacy = v_codigo, cuit = v_cuit, dni = v_dni, telefono = v_tel, email = v_mail, condicion_iva = v_iva, barrio = v_barrio
       where id = c.id and (codigo_legacy, cuit, dni, telefono, email, condicion_iva, barrio) is distinct from (v_codigo, v_cuit, v_dni, v_tel, v_mail, v_iva, v_barrio);
      if found then n_vinc := n_vinc + 1; end if;
    end loop;

    update clientes cl set condicion_iva = x->>1
      from jsonb_array_elements(coalesce(a->'secciones'->'normalizar_iva', '[]')) x
     where cl.id = (x->>0)::uuid and cl.condicion_iva <> all (validas) and x->>1 = any (validas);
    get diagnostics n_iva = row_count;

    v_res := v_res || format(' | pasada %s: altas=%s ya_existian=%s vinculados_con_cambios=%s no_encontrados=%s iva_corregida=%s dni_ocupado=%s',
      v_pasada, n_altas, n_ya, n_vinc, n_sin, n_iva, n_dni_ocupado);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK clientes %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'altas', n_altas, 'ya_existian', n_ya,
      'vinculados_con_cambios', n_vinc, 'no_encontrados', n_sin, 'iva_corregida', n_iva, 'dni_ocupado', n_dni_ocupado))
   where id = v_id;
end $$;

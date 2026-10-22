-- Exportación del sistema viejo · CUENTA CORRIENTE (después de clientes).
-- Lee la carga de auditoria (entidad 'sistema_viejo:ctacte'). __AUDITORIA_ID__ y
-- __ENSAYO__ como en los otros: un solo bloque, ensayo con RAISE.
-- Sin inventar facturas ni pagos: por cliente con saldo, UNA línea en
-- cuenta_corriente sin comprobante, con el concepto «Saldo inicial del sistema
-- anterior (corte …)» y la fecha del corte (al DEBE si debe, al HABER si tiene
-- saldo a favor). Después clientes.saldo_cta_cte se iguala al libro
-- (saldo_cuenta) y se habilita la cuenta corriente: el saldo deja de vivir en dos
-- lugares que no coinciden. El historial de movimientos del viejo NO se carga
-- (queda en la exportación y en el informe, como referencia).
--   saldos:            [cliente_id, codigo_viejo, saldo] (cliente_id vacío = cliente
--                      nuevo, se busca por 'st-<código>')
--   igualar:           [cliente_id] → solo los que el dueño aprobó: saldo suelto de
--                      ODB sin libro que el viejo dice que es 0.
--   habilitar_activos: [cliente_id, codigo_viejo] → solo con --incluir habilitar_activos.
-- El saldo anterior de cada cliente queda en auditoria (datos_antes.aplicado.saldos_anteriores).
-- Idempotente: la línea de saldo inicial no se repite (mismo cliente y concepto).
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_ref text; v_concepto text; v_corte timestamptz; v_cli uuid; v_saldo numeric; v_antes numeric;
  v_pasada int; v_res text := ''; v_msg text; v_previos jsonb;
  n_lineas int; n_ya int; n_sin int; n_igual int; n_igualar int; n_hab int; s_debe numeric; s_haber numeric;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:ctacte';
  if a is null then raise exception 'no encuentro la carga % de cuenta corriente', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia'; v_concepto := a->'datos'->>'concepto'; v_corte := (a->'datos'->>'corte')::timestamptz;
  if coalesce(v_concepto, '') = '' or v_corte is null then raise exception 'la carga no trae concepto o fecha de corte'; end if;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_lineas := 0; n_ya := 0; n_sin := 0; n_igual := 0; n_igualar := 0; n_hab := 0; s_debe := 0; s_haber := 0; v_previos := '{}';

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'saldos', '[]')) loop
      v_cli := coalesce(nullif(e->>0, '')::uuid, (select id from clientes where codigo_legacy = 'st-' || (e->>1)));
      if v_cli is null or not exists (select 1 from clientes where id = v_cli) then n_sin := n_sin + 1; continue; end if;
      v_saldo := (e->>2)::numeric;
      if not exists (select 1 from cuenta_corriente where cliente_id = v_cli and concepto = v_concepto) then
        insert into cuenta_corriente (cliente_id, comprobante_id, concepto, debe, haber, creado_en)
        values (v_cli, null, v_concepto, greatest(v_saldo, 0), greatest(-v_saldo, 0), v_corte);
        n_lineas := n_lineas + 1; s_debe := s_debe + greatest(v_saldo, 0); s_haber := s_haber + greatest(-v_saldo, 0);
      else
        n_ya := n_ya + 1;
      end if;
      select saldo_cta_cte into v_antes from clientes where id = v_cli;
      update clientes set saldo_cta_cte = saldo_cuenta(v_cli), cta_cte_habilitada = true
       where id = v_cli and (saldo_cta_cte is distinct from saldo_cuenta(v_cli) or not cta_cte_habilitada);
      if found then n_igual := n_igual + 1; v_previos := v_previos || jsonb_build_object(v_cli::text, v_antes); end if;
    end loop;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'igualar', '[]')) loop
      v_cli := (e->>0)::uuid;
      select saldo_cta_cte into v_antes from clientes where id = v_cli;
      update clientes set saldo_cta_cte = saldo_cuenta(v_cli) where id = v_cli and saldo_cta_cte is distinct from saldo_cuenta(v_cli);
      if found then n_igualar := n_igualar + 1; v_previos := v_previos || jsonb_build_object(v_cli::text, v_antes); end if;
    end loop;

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'habilitar_activos', '[]')) loop
      v_cli := coalesce(nullif(e->>0, '')::uuid, (select id from clientes where codigo_legacy = 'st-' || (e->>1)));
      update clientes set cta_cte_habilitada = true where id = v_cli and not cta_cte_habilitada;
      if found then n_hab := n_hab + 1; end if;
    end loop;

    v_res := v_res || format(' | pasada %s: lineas=%s (debe %s, haber %s) ya_estaban=%s sin_cliente=%s saldos_igualados=%s saldos_sueltos_igualados=%s habilitados=%s',
      v_pasada, n_lineas, s_debe, s_haber, n_ya, n_sin, n_igual, n_igualar, n_hab);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK cuenta corriente %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'lineas', n_lineas, 'debe', s_debe, 'haber', s_haber,
      'ya_estaban', n_ya, 'sin_cliente', n_sin, 'saldos_igualados', n_igual, 'saldos_sueltos_igualados', n_igualar, 'habilitados', n_hab,
      'saldos_anteriores', v_previos))
   where id = v_id;
end $$;

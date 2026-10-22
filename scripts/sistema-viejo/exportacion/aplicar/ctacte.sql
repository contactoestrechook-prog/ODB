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
--   saldos:            [cliente_id, codigo_viejo, monto, tipo, ya_cargado, suelto]
--                      cliente_id vacío = cliente nuevo, se busca por 'st-<código>'.
--                      tipo 'inicial': la línea de saldo inicial; 'ajuste': el cliente
--                      ya tiene líneas de una exportación anterior y va SOLO la
--                      diferencia («Ajuste de saldo del sistema anterior (corte …)»).
--                      ya_cargado: lo que el circuito le había cargado al simular; si al
--                      aplicar es otra cosa (otra carga en el medio), se frena todo.
--                      suelto: solo si el dueño eligió SUMAR el saldo suelto de junio:
--                      va como una línea aparte («Saldo previo de ODB sin movimientos»).
--   igualar:           [cliente_id] → solo los que el dueño aprobó: saldo suelto de
--                      ODB sin libro que el viejo dice que es 0.
--   habilitar_activos: [cliente_id, codigo_viejo] → solo con --incluir habilitar_activos.
-- El saldo anterior de cada cliente queda en auditoria (datos_antes.aplicado.saldos_anteriores).
-- Idempotente POR CLIENTE, no por corte: las líneas del circuito se reconocen por
-- el principio del concepto ('Saldo inicial del sistema anterior%' / 'Ajuste de
-- saldo del sistema anterior%'); un cliente nunca recibe un segundo saldo inicial
-- (el 21/10 una segunda exportación con otro corte lo duplicaba: ≈ $47,5 M).
do $$
declare
  v_ensayo boolean := __ENSAYO__;
  v_id bigint := __AUDITORIA_ID__;
  v_carga_texto text;
  a jsonb; e jsonb; v_ref text; v_concepto text; v_concepto_aj text; v_concepto_su text; v_corte timestamptz; v_cli uuid; v_saldo numeric; v_antes numeric;
  v_tipo text; v_visto numeric; v_aportado numeric; v_con_inicial boolean; v_suelto numeric; v_linea text;
  v_pasada int; v_res text := ''; v_msg text; v_previos jsonb;
  n_lineas int; n_ajustes int; n_sueltos int; n_ya int; n_sin int; n_igual int; n_igualar int; n_hab int; s_debe numeric; s_haber numeric;
begin
  -- __CARGA_ENSAYO__
  select datos_despues into a from auditoria where id = v_id and accion = 'importacion_sistema_viejo' and entidad = 'sistema_viejo:ctacte';
  if a is null then raise exception 'no encuentro la carga % de cuenta corriente', v_id; end if;
  if coalesce((select datos_antes ? 'aplicado' from auditoria where id = v_id), false) then raise exception 'la carga % ya se aplicó', v_id; end if;
  v_ref := a->>'referencia'; v_concepto := a->'datos'->>'concepto'; v_corte := (a->'datos'->>'corte')::timestamptz;
  v_concepto_aj := a->'datos'->>'concepto_ajuste'; v_concepto_su := a->'datos'->>'concepto_suelto';
  if coalesce(v_concepto, '') = '' or coalesce(v_concepto_aj, '') = '' or coalesce(v_concepto_su, '') = '' or v_corte is null then
    raise exception 'la carga no trae los conceptos o la fecha de corte (simular de nuevo)';
  end if;
  if v_concepto not like 'Saldo inicial del sistema anterior%' or v_concepto_aj not like 'Ajuste de saldo del sistema anterior%' then
    raise exception 'conceptos inesperados: % / %', v_concepto, v_concepto_aj;
  end if;

  for v_pasada in 1..(case when v_ensayo then 2 else 1 end) loop
    n_lineas := 0; n_ajustes := 0; n_sueltos := 0; n_ya := 0; n_sin := 0; n_igual := 0; n_igualar := 0; n_hab := 0; s_debe := 0; s_haber := 0; v_previos := '{}';

    for e in select * from jsonb_array_elements(coalesce(a->'secciones'->'saldos', '[]')) loop
      v_cli := coalesce(nullif(e->>0, '')::uuid, (select id from clientes where codigo_legacy = 'st-' || (e->>1)));
      if v_cli is null or not exists (select 1 from clientes where id = v_cli) then n_sin := n_sin + 1; continue; end if;
      v_saldo := (e->>2)::numeric; v_tipo := coalesce(e->>3, 'inicial'); v_visto := coalesce((e->>4)::numeric, 0);
      v_suelto := nullif(e->>5, '')::numeric;
      -- lo que el circuito ya le cargó a este cliente (cualquier exportación)
      select coalesce(sum(debe - haber), 0), coalesce(bool_or(concepto like 'Saldo inicial del sistema anterior%'), false)
        into v_aportado, v_con_inicial
        from cuenta_corriente where cliente_id = v_cli
         and (concepto like 'Saldo inicial del sistema anterior%' or concepto like 'Ajuste de saldo del sistema anterior%');
      if abs(v_aportado - (v_visto + v_saldo)) < 0.01 and (v_con_inicial or v_tipo = 'ajuste') then
        n_ya := n_ya + 1;                                   -- ya está (segunda pasada o carga repetida)
      elsif abs(v_aportado - v_visto) >= 0.01 or (v_tipo = 'inicial' and v_con_inicial) or (v_tipo = 'ajuste' and not v_con_inicial) then
        raise exception 'cliente % (código viejo %): al simular tenía % cargado del sistema anterior y ahora tiene % (¿otra carga en el medio?): volver a simular',
          v_cli, e->>1, v_visto, v_aportado;
      else
        v_linea := case when v_tipo = 'ajuste' then v_concepto_aj else v_concepto end;
        if exists (select 1 from cuenta_corriente where cliente_id = v_cli and concepto = v_linea) then
          raise exception 'cliente % ya tiene una línea «%» y el saldo no coincide: revisar a mano', v_cli, v_linea;
        end if;
        insert into cuenta_corriente (cliente_id, comprobante_id, concepto, debe, haber, creado_en)
        values (v_cli, null, v_linea, greatest(v_saldo, 0), greatest(-v_saldo, 0), v_corte);
        if v_tipo = 'ajuste' then n_ajustes := n_ajustes + 1; else n_lineas := n_lineas + 1; end if;
        s_debe := s_debe + greatest(v_saldo, 0); s_haber := s_haber + greatest(-v_saldo, 0);
      end if;
      -- el saldo suelto de junio, si el dueño eligió SUMARLO: una línea aparte
      if v_suelto is not null and abs(v_suelto) >= 0.01
         and not exists (select 1 from cuenta_corriente where cliente_id = v_cli and concepto = v_concepto_su) then
        insert into cuenta_corriente (cliente_id, comprobante_id, concepto, debe, haber, creado_en)
        values (v_cli, null, v_concepto_su, greatest(v_suelto, 0), greatest(-v_suelto, 0), v_corte - interval '1 second');
        n_sueltos := n_sueltos + 1;
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

    v_res := v_res || format(' | pasada %s: saldos_iniciales=%s ajustes=%s (debe %s, haber %s) sueltos_sumados=%s ya_estaban=%s sin_cliente=%s saldos_igualados=%s saldos_sueltos_igualados=%s habilitados=%s',
      v_pasada, n_lineas, n_ajustes, s_debe, s_haber, n_sueltos, n_ya, n_sin, n_igual, n_igualar, n_hab);
  end loop;

  if v_ensayo then
    v_msg := format('ENSAYO OK cuenta corriente %s (nada quedó escrito)%s', v_ref, v_res);
    raise exception '%', v_msg; -- __FIN_ENSAYO__
  end if;
  update auditoria set datos_antes = jsonb_build_object('aplicado', jsonb_build_object('en', now(), 'lineas', n_lineas, 'ajustes', n_ajustes, 'sueltos_sumados', n_sueltos, 'debe', s_debe, 'haber', s_haber,
      'ya_estaban', n_ya, 'sin_cliente', n_sin, 'saldos_igualados', n_igual, 'saldos_sueltos_igualados', n_igualar, 'habilitados', n_hab,
      'saldos_anteriores', v_previos))
   where id = v_id;
end $$;

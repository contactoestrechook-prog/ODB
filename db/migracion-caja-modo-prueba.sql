-- MODO PRUEBA DE LA CAJA (Leandro, 22/10/2026: «vamos a hacer una prueba por dos días
-- cobrando con dos sistemas, pero el que va a cobrar de verdad es el otro sistema;
-- cuando tocamos cobrar que no esté vinculado con AFIP pero que sí registre como que
-- se cobró para que después podamos hacer arqueos»). Lo usa Melina con perfil dueño.
--
-- Un interruptor POR SUCURSAL (sucursales.caja_modo_prueba). Con el interruptor
-- prendido, cada venta de la caja:
--   · se registra igual (renglones, pagos por medio, sesión de caja → entra al arqueo)
--     y DESCUENTA STOCK (decisión del 22/10: así también se prueba el stock; el día
--     del cambio se carga el stock real del sistema viejo encima). Como el stock de
--     ODB no coincide con el del local y la base no deja stock negativo, si falta se
--     asienta antes un ajuste «faltante detectado» (referencia venta_prueba): la venta
--     nunca se traba y queda la lista de diferencias;
--   · queda marcada ventas.es_prueba = true para siempre;
--   · NO entra en la cola de ARCA (comprobantes_arca) ni emite comprobante;
--   · NO genera acreditaciones esperadas de tarjeta/Mercado Pago (la plata la cobra el
--     otro sistema: la conciliación no tiene que esperarla);
--   · NO lleva cliente (sin puntos, referidos ni deuda de cuenta corriente).
-- Todo en UNA transacción: registrar_venta y las limpiezas pasan juntas o no pasa nada.
--
-- Aditiva. Mientras no esté aplicada, el servidor no ofrece el interruptor (la caja
-- funciona como siempre).

alter table sucursales add column if not exists caja_modo_prueba boolean not null default false;
alter table ventas add column if not exists es_prueba boolean not null default false;
create index if not exists ventas_es_prueba_idx on ventas (vendida_en) where es_prueba;

create or replace function registrar_venta_prueba(
  p_sucursal uuid, p_items jsonb, p_pagos jsonb,
  p_canal canal_venta default 'mostrador',
  p_sesion_caja uuid default null, p_usuario uuid default null, p_venta_id uuid default null,
  p_descuento_extra numeric default 0, p_autorizado_por uuid default null, p_mayorista boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb; v_id uuid := coalesce(p_venta_id, gen_random_uuid()); r record; v_hay numeric;
begin
  if not coalesce((select caja_modo_prueba from sucursales where id = p_sucursal), false) then
    raise exception 'La sucursal no está en modo prueba';
  end if;
  if exists (select 1 from ventas where id = v_id) then
    return jsonb_build_object('venta_id', v_id, 'duplicada', true);
  end if;
  -- registrar_movimiento no deja el stock en negativo, y en la prueba el stock de ODB
  -- no coincide con el del local: si falta, se asienta antes un ajuste visible con lo
  -- que faltaba (queda la lista de diferencias) y la venta pasa. El libro sigue cuadrando.
  for r in select (i->>'producto_id')::uuid producto_id, sum((i->>'cantidad')::numeric) cantidad
           from jsonb_array_elements(p_items) i group by 1
  loop
    select cantidad into v_hay from stock where producto_id = r.producto_id and sucursal_id = p_sucursal for update;
    if r.cantidad > coalesce(v_hay, 0) then
      perform registrar_movimiento(r.producto_id, p_sucursal, 'ajuste', r.cantidad - greatest(coalesce(v_hay, 0), 0),
        'Modo prueba de caja: faltante detectado (ODB tenía menos que lo vendido)', 'venta_prueba', v_id::text, p_usuario);
    end if;
  end loop;
  v := registrar_venta(p_sucursal, p_items, p_pagos, p_canal, null, p_sesion_caja, p_usuario,
                       v_id, p_descuento_extra, p_autorizado_por, p_mayorista);
  update ventas set es_prueba = true where id = v_id;
  delete from comprobantes_arca where venta_id = v_id;
  delete from acreditaciones where venta_id = v_id;
  return v || jsonb_build_object('prueba', true);
end $$;

-- Blindaje de la cola de ARCA: una venta de prueba nunca encola nada, tampoco al
-- anularla (anular_venta encola una NCB) ni al devolverla (devolver_venta_parcial).
-- Es el mismo filtro que ya descarta las sucursales sin facturación electrónica.
create or replace function fn_blindaje_arca_cola()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_pv int; v_prueba boolean;
begin
  select s.punto_venta_arca, coalesce(v.es_prueba, false) into v_pv, v_prueba
  from ventas v join sucursales s on s.id = v.sucursal_id
  where v.id = new.venta_id;
  if v_prueba then
    return null; -- venta de la prueba en paralelo: el comprobante lo hace el otro sistema
  end if;
  if v_pv is null then
    return null; -- sucursal sin facturación electrónica propia: no se encola
  end if;
  new.punto_venta := v_pv;
  return new;
end $$;

revoke all on function registrar_venta_prueba(uuid, jsonb, jsonb, canal_venta, uuid, uuid, uuid, numeric, uuid, boolean) from public, anon, authenticated;
grant execute on function registrar_venta_prueba(uuid, jsonb, jsonb, canal_venta, uuid, uuid, uuid, numeric, uuid, boolean) to service_role;

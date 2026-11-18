-- FACTURAS DE COMPRA: ANULAR DE VERDAD, CORREGIR RENGLONES Y COMPRA EVENTUAL (18/11/2026)
--
-- Leandro, 18/11/2026: «necesitamos poder anular alguna factura cargada y que eso conlleve
-- a retirar del stock, y la factura y en administración, todo lo que se ingresó. […] Y
-- después, modificar algún ítem de esa factura, retirarlo, lo que fuera. […] cuando es por
-- primera vez ese proveedor […] un recuadrito que diga compra eventual. Si le damos clic, que
-- no me cambie ni el costo […] ni el precio al que la vamos a vender».
--
-- Hasta hoy «Anular» (9/11/2026) solo devolvía el stock: el costo y el precio de venta que la
-- factura había puesto seguían, la factura seguía en el libro IVA compras y en la deuda con el
-- proveedor (proveedores_resumen contaba todo lo que no estuviera «pagada»).
--
-- Qué es «de la factura» (sin adivinar):
--  · el stock: los movimientos de su orden de compra DIRECTA (la entrada nació con la factura:
--    entrada + factura). Si la mercadería entró con el remito de la pistola o por un pedido, el
--    stock lo contó el depósito: no se toca, y el remito vuelve a esperar su factura.
--  · el costo: las filas de costos_historial que escribió la entrada (misma transacción que la
--    orden: mismo proveedor y el mismo instante) o una corrección de esta factura
--    (origen 'factura:<id>').
--  · el precio de venta: las vigencias de la lista Minorista que puso la entrada (el mismo
--    instante que la orden) o una corrección de esta factura (sus ids quedan en la auditoría).
-- Lo que alguien cambió DESPUÉS (otra compra, un remarque a mano) no se vuelve atrás: se avisa.
-- El stock nunca queda negativo (registrar_movimiento no lo deja): si ya se vendió, se resta lo
-- que hay y se dice cuánto no se pudo restar.

alter table facturas_proveedor add column if not exists compra_eventual boolean not null default false;
comment on column facturas_proveedor.compra_eventual is
  'Compra eventual (18/11/2026): a un proveedor nuevo, por única vez. La mercadería entra y la factura se paga, pero no cambia el costo ni el precio de venta de los productos.';

-- para encontrar rápido lo que movió una orden y los costos de un producto
create index if not exists movimientos_stock_referencia_idx on movimientos_stock (referencia_id);
create index if not exists costos_historial_producto_idx on costos_historial (producto_id, creado_en desc);

alter table facturas_proveedor_cambios drop constraint if exists facturas_proveedor_cambios_tipo_check;
alter table facturas_proveedor_cambios add constraint facturas_proveedor_cambios_tipo_check
  check (tipo = any (array['editar'::text, 'anular'::text, 'renglones'::text]));

-- ---------- la deuda con el proveedor no cuenta las anuladas ----------
create or replace function public.proveedores_resumen()
 returns table(proveedor_id uuid, productos integer, ultima_actividad timestamp with time zone, deuda numeric, documentos integer, contactos integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id,
    (select count(*)::int from proveedor_productos pp where pp.proveedor_id = p.id),
    greatest(
      (select max(o.creado_en) from ordenes_compra o where o.proveedor_id = p.id),
      (select max(r.creado_en) from remitos r where r.proveedor_id = p.id),
      (select max(f.creado_en) from facturas_proveedor f where f.proveedor_id = p.id),
      (select max(h.creado_en) from compras_historial h where h.proveedor_id = p.id)
    ),
    coalesce((select sum(f.monto - coalesce(f.monto_pagado, 0)) from facturas_proveedor f
               where f.proveedor_id = p.id and f.estado not in ('pagada', 'anulada')), 0),
    (select count(*)::int from proveedor_documentos d where d.proveedor_id = p.id and d.borrado_en is null),
    (select count(*)::int from proveedor_contactos c where c.proveedor_id = p.id)
  from proveedores p;
$function$;

-- ---------- la orden de compra que es SOLO de esta factura (entrada + factura) ----------
create or replace function public._factura_oc_propia(p_factura uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select o.id from facturas_proveedor f join ordenes_compra o on o.id = f.oc_id
   where f.id = p_factura and o.origen = 'directa'
     and not exists (select 1 from facturas_proveedor x where x.oc_id = o.id and x.id <> f.id and x.estado <> 'anulada');
$function$;

-- ---------- vuelve el costo y el precio de un producto a como estaban antes de la factura ----------
-- Solo si lo vigente es lo que puso esta factura. Devuelve qué hizo, para la pantalla y la auditoría.
create or replace function public._revertir_costo_precio_factura(p_factura uuid, p_oc uuid, p_producto uuid, p_usuario uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_oc ordenes_compra%rowtype;
  v_lista uuid;
  v_ult record; v_prev record; v_vig record; v_pprev record;
  v_costo_hoy numeric;
  v_res jsonb := jsonb_build_object('producto_id', p_producto);
  v_precio_ids uuid[];
begin
  select * into v_oc from ordenes_compra where id = p_oc;
  select id into v_lista from listas_precios where nombre = 'Minorista' limit 1;

  -- COSTO
  select * into v_ult from costos_historial c
   where c.producto_id = p_producto
     and ((c.proveedor_id = v_oc.proveedor_id and c.creado_en = v_oc.creado_en) or c.origen = 'factura:' || p_factura)
   order by c.creado_en desc, c.id desc limit 1;
  if v_ult.id is not null then
    select costo into v_costo_hoy from productos where id = p_producto;
    if exists (select 1 from costos_historial c where c.producto_id = p_producto
                 and (c.creado_en, c.id) > (v_ult.creado_en, v_ult.id)
                 and not ((c.proveedor_id = v_oc.proveedor_id and c.creado_en = v_oc.creado_en) or c.origen = 'factura:' || p_factura)) then
      v_res := v_res || jsonb_build_object('costo', 'otra_compra');
    elsif v_costo_hoy is distinct from v_ult.costo then
      v_res := v_res || jsonb_build_object('costo', 'cambiado_a_mano');
    else
      select * into v_prev from costos_historial c
       where c.producto_id = p_producto and c.creado_en < v_oc.creado_en
       order by c.creado_en desc, c.id desc limit 1;
      if v_prev.id is not null then
        update productos set costo = v_prev.costo where id = p_producto;
        v_res := v_res || jsonb_build_object('costo', 'vuelto', 'costo_antes', v_prev.costo, 'costo_factura', v_ult.costo);
      else
        v_res := v_res || jsonb_build_object('costo', 'sin_anterior');
      end if;
    end if;
    -- el último costo de este proveedor
    select * into v_pprev from costos_historial c
     where c.producto_id = p_producto and c.proveedor_id = v_oc.proveedor_id and c.creado_en < v_oc.creado_en
     order by c.creado_en desc, c.id desc limit 1;
    if v_pprev.id is not null then
      update proveedor_productos set ultimo_costo = v_pprev.costo, actualizado_en = now()
       where proveedor_id = v_oc.proveedor_id and producto_id = p_producto and ultimo_costo is not distinct from v_ult.costo;
    end if;
    -- las filas de costo de la factura salen del historial (quedan en la auditoría)
    v_res := v_res || jsonb_build_object('costos_borrados', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from costos_historial c
      where c.producto_id = p_producto and ((c.proveedor_id = v_oc.proveedor_id and c.creado_en = v_oc.creado_en) or c.origen = 'factura:' || p_factura)));
    delete from costos_historial c
     where c.producto_id = p_producto and ((c.proveedor_id = v_oc.proveedor_id and c.creado_en = v_oc.creado_en) or c.origen = 'factura:' || p_factura);
  end if;

  -- PRECIO DE VENTA (nunca se borra una vigencia: se pone una nueva con el precio de antes)
  if v_lista is not null then
    select array_agg(distinct (x)::uuid) into v_precio_ids
      from auditoria a, jsonb_array_elements_text(coalesce(a.datos_despues->'precios_ids', '[]'::jsonb)) x
     where a.accion = 'corregir_renglones_factura' and a.entidad_id = p_factura::text;
    select * into v_vig from precios
     where lista_id = v_lista and producto_id = p_producto and vigente_desde <= now()
     order by vigente_desde desc, id desc limit 1;
    if v_vig.id is not null and (v_vig.vigente_desde = v_oc.creado_en or v_vig.id = any (coalesce(v_precio_ids, '{}'))) then
      select * into v_prev from precios
       where lista_id = v_lista and producto_id = p_producto and vigente_desde < v_oc.creado_en
       order by vigente_desde desc, id desc limit 1;
      if v_prev.id is not null then
        if v_prev.precio <> v_vig.precio then
          insert into precios (lista_id, producto_id, precio, creado_por) values (v_lista, p_producto, v_prev.precio, p_usuario);
        end if;
        v_res := v_res || jsonb_build_object('precio', 'vuelto', 'precio_antes', v_prev.precio, 'precio_factura', v_vig.precio);
      else
        v_res := v_res || jsonb_build_object('precio', 'sin_anterior');
      end if;
    elsif exists (select 1 from precios where lista_id = v_lista and producto_id = p_producto
                    and (vigente_desde = v_oc.creado_en or id = any (coalesce(v_precio_ids, '{}')))) then
      v_res := v_res || jsonb_build_object('precio', 'cambiado_despues');
    end if;
  end if;
  return v_res;
end $function$;

-- ---------- resta del stock lo que se pueda (nunca negativo) ----------
create or replace function public._restar_stock_hasta_cero(p_producto uuid, p_sucursal uuid, p_cantidad numeric, p_motivo text, p_ref_tipo text, p_ref_id text, p_usuario uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_hay numeric; v_resta numeric;
begin
  if p_cantidad <= 0 then return 0; end if;
  select greatest(coalesce(cantidad, 0), 0) into v_hay from stock where producto_id = p_producto and sucursal_id = p_sucursal for update;
  v_resta := round(least(p_cantidad, coalesce(v_hay, 0)), 3);
  if v_resta > 0 then
    perform registrar_movimiento(p_producto, p_sucursal, 'ajuste', -v_resta, p_motivo, p_ref_tipo, p_ref_id, p_usuario);
  end if;
  return v_resta;
end $function$;

-- ---------- ANULAR ----------
create or replace function public.anular_factura_proveedor(p_factura uuid, p_motivo text, p_usuario uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  f facturas_proveedor%rowtype;
  v_oc uuid; v_ocr ordenes_compra%rowtype;
  v_pagado numeric;
  v_mot text;
  m record; v_restado numeric;
  v_restadas jsonb := '[]'::jsonb; v_faltantes jsonb := '[]'::jsonb; v_sumadas jsonb := '[]'::jsonb;
  v_costos jsonb := '[]'::jsonb; v_historial jsonb;
  v_remitos int := 0; v_aviso text := null; p record;
begin
  select * into f from facturas_proveedor where id = p_factura for update;
  if not found then raise exception 'Factura inexistente'; end if;
  if f.estado = 'anulada' then return jsonb_build_object('ya_anulada', true); end if;
  if f.estado = 'en_pago' then raise exception 'Esta factura está en una orden de pago: primero sacala de la orden.'; end if;
  select coalesce(sum(monto), 0) into v_pagado from facturas_proveedor_pagos where factura_id = p_factura;
  if v_pagado > 0 then raise exception 'Tiene pagos cargados por $%: primero anulá el pago.', to_char(v_pagado, 'FM999G999G999G990D00'); end if;
  v_mot := 'Anulación de la factura ' || coalesce(f.numero, 's/n') || case when coalesce(trim(p_motivo), '') <> '' then ': ' || trim(p_motivo) else '' end;

  v_oc := _factura_oc_propia(p_factura);
  if v_oc is not null then
    select * into v_ocr from ordenes_compra where id = v_oc for update;
    -- 1) STOCK: lo que entró con esta factura (y sus correcciones), neto por producto y sucursal
    for m in
      select ms.producto_id, ms.sucursal_id, round(sum(ms.cantidad), 3) neto, max(pr.nombre) nombre
        from movimientos_stock ms join productos pr on pr.id = ms.producto_id
       where ms.referencia_id = v_oc::text
          or (ms.referencia_id = p_factura::text and ms.referencia_tipo = 'correccion_factura')
       group by ms.producto_id, ms.sucursal_id
      having round(sum(ms.cantidad), 3) <> 0
    loop
      if m.neto > 0 then
        v_restado := _restar_stock_hasta_cero(m.producto_id, m.sucursal_id, m.neto, v_mot, 'anulacion_factura', p_factura::text, p_usuario);
        if v_restado > 0 then v_restadas := v_restadas || jsonb_build_object('producto', m.nombre, 'cantidad', v_restado); end if;
        if v_restado < m.neto then
          v_faltantes := v_faltantes || jsonb_build_object('producto', m.nombre, 'entro', m.neto, 'restado', v_restado, 'falta', round(m.neto - v_restado, 3));
        end if;
      else
        -- salió más de lo que entró (lo devuelto al proveedor): vuelve
        perform registrar_movimiento(m.producto_id, m.sucursal_id, 'ajuste', -m.neto, v_mot, 'anulacion_factura', p_factura::text, p_usuario);
        v_sumadas := v_sumadas || jsonb_build_object('producto', m.nombre, 'cantidad', -m.neto);
      end if;
    end loop;

    -- 2) COSTO Y PRECIO de cada producto de la orden (y de los que una corrección sacó)
    for p in
      select distinct producto_id from (
        select producto_id from ordenes_compra_items where oc_id = v_oc
        union select c.producto_id from costos_historial c where c.origen = 'factura:' || p_factura
      ) x
    loop
      v_costos := v_costos || _revertir_costo_precio_factura(p_factura, v_oc, p.producto_id, p_usuario);
    end loop;

    update ordenes_compra set estado = 'cancelada' where id = v_oc;
    update remitos set estado = 'anulado' where oc_id = v_oc and estado = 'confirmado';
  else
    if f.oc_id is not null then
      v_aviso := 'La mercadería entró por una orden de compra que no es solo de esta factura: el stock no se toca; si hace falta, ajustalo desde Stock.';
    end if;
  end if;

  -- 3) los remitos de la pistola cruzados con esta factura vuelven a esperar su factura (el stock lo contó el depósito)
  update remitos set factura_id = null, estado = 'pendiente_conciliar', conciliado_en = null, conciliado_por = null
   where factura_id = p_factura;
  get diagnostics v_remitos = row_count;
  if v_remitos > 0 then
    v_aviso := coalesce(v_aviso || ' ', '') || case when v_remitos = 1 then 'El remito que tenía cruzado' else 'Los ' || v_remitos || ' remitos que tenía cruzados' end
      || ' vuelve' || case when v_remitos = 1 then '' else 'n' end || ' a esperar su factura: esa mercadería la contó el depósito y sigue en el stock.';
  end if;
  if v_oc is null and f.oc_id is null and v_remitos = 0 then
    v_aviso := 'Esta factura no tenía mercadería que entrara con ella: el stock no se toca.';
  end if;

  -- 4) lo que se leyó de esta factura sale del historial de compras (queda en la auditoría)
  select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) into v_historial from compras_historial h where h.factura_id = p_factura;
  delete from compras_historial where factura_id = p_factura;

  -- 5) la factura: anulada (sale de cuentas a pagar, de la deuda y del libro IVA)
  update facturas_proveedor set estado = 'anulada', monto_pagado = 0 where id = p_factura;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
  values (p_usuario, 'anular_factura_proveedor', 'facturas_proveedor', p_factura::text,
    jsonb_build_object('estado', f.estado, 'monto_pagado', f.monto_pagado, 'compras_historial', v_historial),
    jsonb_build_object('motivo', nullif(trim(coalesce(p_motivo, '')), ''), 'oc_id', v_oc,
      'stock', jsonb_build_object('restadas', v_restadas, 'sinRestar', v_faltantes, 'sumadas', v_sumadas, 'aviso', v_aviso),
      'costos', v_costos, 'remitos_liberados', v_remitos));

  return jsonb_build_object('ok', true,
    'stock', jsonb_build_object('restadas', v_restadas, 'sinRestar', v_faltantes, 'sumadas', v_sumadas, 'aviso', v_aviso),
    'costos', v_costos, 'remitosLiberados', v_remitos);
end $function$;

-- ---------- CORREGIR RENGLONES (cambiar cantidad, costo o producto; sacar; agregar) ----------
-- p_renglones: [{producto_id (el de hoy; null = renglón nuevo), producto_nuevo_id (si cambia el
-- producto o es nuevo), cantidad (lo que entró de verdad; 0 = sacar), costo (por unidad), precio
-- (de venta, lo calcula la API con la remarcación de siempre)}]. El total de la factura no
-- cambia: es el del papel. Una compra eventual nunca toca costo ni precio.
create or replace function public.corregir_renglones_factura(p_factura uuid, p_renglones jsonb, p_motivo text, p_usuario uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  f facturas_proveedor%rowtype;
  v_oc uuid; o ordenes_compra%rowtype;
  v_lista uuid; r record; v_item record; v_destino uuid; v_nombre text;
  v_delta numeric; v_restado numeric; v_costo_vigente numeric; v_precio_id uuid;
  v_mot text; v_total numeric; v_n int := 0;
  v_precios uuid[] := '{}'; v_faltantes jsonb := '[]'::jsonb; v_costos jsonb := '[]'::jsonb; v_hechos jsonb := '[]'::jsonb;
  v_antes jsonb;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Contá por qué se corrige (por ejemplo: «eran 6, no 12»)'; end if;
  select * into f from facturas_proveedor where id = p_factura for update;
  if not found then raise exception 'Factura inexistente'; end if;
  if f.estado = 'anulada' then raise exception 'La factura está anulada: no se corrige'; end if;
  v_oc := _factura_oc_propia(p_factura);
  if v_oc is null then raise exception 'Los renglones se corrigen en las facturas que entraron con su mercadería (entrada + factura). Esta entró por un remito o un pedido: el stock se ajusta desde Stock.'; end if;
  select * into o from ordenes_compra where id = v_oc for update;
  select id into v_lista from listas_precios where nombre = 'Minorista' limit 1;
  v_mot := 'Corrección de la factura ' || coalesce(f.numero, 's/n') || ': ' || trim(p_motivo);
  v_antes := jsonb_build_object(
    'oc_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from ordenes_compra_items i where i.oc_id = v_oc),
    'factura_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from facturas_proveedor_items i where i.factura_id = p_factura),
    'total_oc', o.total);

  for r in
    select nullif(x->>'producto_id', '')::uuid producto_id, nullif(x->>'producto_nuevo_id', '')::uuid producto_nuevo_id,
           (x->>'cantidad')::numeric cantidad, (x->>'costo')::numeric costo, nullif(x->>'precio', '')::numeric precio
      from jsonb_array_elements(p_renglones) x
  loop
    if r.cantidad is null or r.cantidad < 0 or r.costo is null or r.costo < 0 then raise exception 'Renglón inválido: la cantidad y el costo tienen que ser números (0 o más)'; end if;
    v_destino := coalesce(r.producto_nuevo_id, r.producto_id);
    if v_destino is null then raise exception 'Falta elegir el producto del renglón nuevo'; end if;

    if r.producto_id is not null then
      select * into v_item from ordenes_compra_items where oc_id = v_oc and producto_id = r.producto_id for update;
      if not found then raise exception 'Ese producto no está en esta factura: volvé a abrirla'; end if;
    end if;

    if r.producto_id is not null and (v_destino <> r.producto_id or r.cantidad = 0) then
      -- SACAR el renglón (o pasarlo a otro producto): sale lo que entró y vuelven costo y precio
      select nombre into v_nombre from productos where id = r.producto_id;
      if coalesce(v_item.cantidad_recibida, 0) > 0 then
        v_restado := _restar_stock_hasta_cero(r.producto_id, o.sucursal_id, v_item.cantidad_recibida, v_mot, 'correccion_factura', v_oc::text, p_usuario);
        if v_restado < v_item.cantidad_recibida then
          v_faltantes := v_faltantes || jsonb_build_object('producto', v_nombre, 'entro', v_item.cantidad_recibida, 'restado', v_restado, 'falta', round(v_item.cantidad_recibida - v_restado, 3));
        end if;
      end if;
      if not f.compra_eventual then
        v_costos := v_costos || _revertir_costo_precio_factura(p_factura, v_oc, r.producto_id, p_usuario);
      end if;
      delete from ordenes_compra_items where oc_id = v_oc and producto_id = r.producto_id;
      if v_destino <> r.producto_id and r.cantidad > 0 then
        update facturas_proveedor_items set producto_id = v_destino where factura_id = p_factura and producto_id = r.producto_id;
        update compras_historial set producto_id = v_destino where factura_id = p_factura and producto_id = r.producto_id;
      else
        delete from facturas_proveedor_items where factura_id = p_factura and producto_id = r.producto_id;
        delete from compras_historial where factura_id = p_factura and producto_id = r.producto_id;
      end if;
      v_hechos := v_hechos || jsonb_build_object('producto', v_nombre, 'hecho', case when v_destino <> r.producto_id then 'cambiado' else 'sacado' end);
    end if;

    if r.producto_id is null or (v_destino <> r.producto_id and r.cantidad > 0) then
      -- AGREGAR (renglón nuevo, o el producto correcto de un renglón cambiado)
      if exists (select 1 from ordenes_compra_items where oc_id = v_oc and producto_id = v_destino) then
        raise exception 'Ese producto ya está en la factura: corregí su renglón';
      end if;
      if r.cantidad <= 0 then raise exception 'El renglón nuevo necesita una cantidad mayor a cero'; end if;
      select nombre into v_nombre from productos where id = v_destino;
      if v_nombre is null then raise exception 'Producto inexistente'; end if;
      insert into ordenes_compra_items (oc_id, producto_id, cantidad, costo_unitario, cantidad_recibida)
      values (v_oc, v_destino, r.cantidad, r.costo, r.cantidad);
      perform registrar_movimiento(v_destino, o.sucursal_id, 'compra', r.cantidad, v_mot, 'correccion_factura', v_oc::text, p_usuario);
      if not f.compra_eventual and r.costo > 0 then
        update productos set costo = r.costo where id = v_destino;
        insert into proveedor_productos (proveedor_id, producto_id, ultimo_costo, actualizado_en)
          values (o.proveedor_id, v_destino, r.costo, now())
          on conflict (proveedor_id, producto_id) do update set ultimo_costo = excluded.ultimo_costo, actualizado_en = now();
        insert into costos_historial (proveedor_id, producto_id, costo, origen) values (o.proveedor_id, v_destino, r.costo, 'factura:' || p_factura);
        if v_lista is not null and r.precio is not null and r.precio > 0 then
          insert into precios (lista_id, producto_id, precio, creado_por) values (v_lista, v_destino, r.precio, p_usuario) returning id into v_precio_id;
          v_precios := v_precios || v_precio_id;
        end if;
      end if;
      if r.producto_id is null then
        insert into facturas_proveedor_items (factura_id, producto_id, descripcion, cantidad, precio) values (p_factura, v_destino, v_nombre, r.cantidad, r.costo);
      end if;
      v_hechos := v_hechos || jsonb_build_object('producto', v_nombre, 'hecho', case when r.producto_id is null then 'agregado' else 'entra_en_su_lugar' end);
    elsif v_destino = r.producto_id and r.cantidad > 0 then
      -- MISMO producto: cantidad y/o costo
      if v_item.cantidad_recibida = r.cantidad and v_item.costo_unitario = r.costo then continue; end if;
      select nombre into v_nombre from productos where id = r.producto_id;
      v_delta := round(r.cantidad - coalesce(v_item.cantidad_recibida, 0), 3);
      if v_delta > 0 then
        perform registrar_movimiento(r.producto_id, o.sucursal_id, 'ajuste', v_delta, v_mot, 'correccion_factura', v_oc::text, p_usuario);
      elsif v_delta < 0 then
        v_restado := _restar_stock_hasta_cero(r.producto_id, o.sucursal_id, -v_delta, v_mot, 'correccion_factura', v_oc::text, p_usuario);
        if v_restado < -v_delta then
          v_faltantes := v_faltantes || jsonb_build_object('producto', v_nombre, 'entro', -v_delta, 'restado', v_restado, 'falta', round(-v_delta - v_restado, 3));
        end if;
      end if;
      if v_item.costo_unitario <> r.costo and not f.compra_eventual then
        select costo into v_costo_vigente from productos where id = r.producto_id;
        if v_costo_vigente is not distinct from v_item.costo_unitario and r.costo > 0 then
          update productos set costo = r.costo where id = r.producto_id;
          update proveedor_productos set ultimo_costo = r.costo, actualizado_en = now() where proveedor_id = o.proveedor_id and producto_id = r.producto_id;
          insert into costos_historial (proveedor_id, producto_id, costo, origen) values (o.proveedor_id, r.producto_id, r.costo, 'factura:' || p_factura);
          if v_lista is not null and r.precio is not null and r.precio > 0 then
            insert into precios (lista_id, producto_id, precio, creado_por) values (v_lista, r.producto_id, r.precio, p_usuario) returning id into v_precio_id;
            v_precios := v_precios || v_precio_id;
          end if;
        else
          v_costos := v_costos || jsonb_build_object('producto_id', r.producto_id, 'costo', 'otra_compra');
        end if;
      end if;
      update ordenes_compra_items set cantidad_recibida = r.cantidad, cantidad = r.cantidad, costo_unitario = r.costo
       where oc_id = v_oc and producto_id = r.producto_id;
      if (select count(*) from facturas_proveedor_items where factura_id = p_factura and producto_id = r.producto_id) = 1 then
        update facturas_proveedor_items set cantidad = r.cantidad where factura_id = p_factura and producto_id = r.producto_id;
      end if;
      v_hechos := v_hechos || jsonb_build_object('producto', v_nombre, 'hecho', 'corregido', 'stock', v_delta);
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'No hay nada para corregir'; end if;
  if not exists (select 1 from ordenes_compra_items where oc_id = v_oc) then
    raise exception 'La factura se quedaría sin renglones: para eso, anulala';
  end if;
  select coalesce(sum(cantidad * costo_unitario), 0) into v_total from ordenes_compra_items where oc_id = v_oc;
  update ordenes_compra set total = v_total where id = v_oc;

  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_antes, datos_despues)
  values (p_usuario, 'corregir_renglones_factura', 'facturas_proveedor', p_factura::text, v_antes,
    jsonb_build_object('motivo', trim(p_motivo), 'renglones', p_renglones, 'hechos', v_hechos, 'precios_ids', to_jsonb(v_precios),
      'costos', v_costos, 'sinRestar', v_faltantes, 'total_oc', v_total));

  return jsonb_build_object('ok', true, 'hechos', v_hechos, 'sinRestar', v_faltantes, 'costos', v_costos, 'totalEntrada', v_total, 'totalFactura', f.monto);
end $function$;

-- solo la API (service role) llama a estas funciones
revoke all on function public.anular_factura_proveedor(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.corregir_renglones_factura(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public._revertir_costo_precio_factura(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._restar_stock_hasta_cero(uuid, uuid, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public._factura_oc_propia(uuid) from public, anon, authenticated;

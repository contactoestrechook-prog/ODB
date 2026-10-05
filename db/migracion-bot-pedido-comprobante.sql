-- EL COMPROBANTE CONFIRMA EL PEDIDO (decisión de Leandro, 5/10/2026).
-- La charla de Pablo: vio el resumen con «¿Lo confirmo?», transfirió justo el
-- total con descuento ($285.390 de $317.100) y mandó el PDF, y el pedido nunca
-- se creó: un pedido solo nacía de un «sí». Ahora, si el cliente manda el
-- comprobante (el archivo) de un resumen que vio y el monto coincide justo con
-- el total de lista o con el total con descuento por efectivo o transferencia,
-- el pedido se crea solo. Si no coincide, no se crea nada (al cliente, «Recibido.»).
--
-- p_modo 'comprobante' (nuevo): lo usa SOLO el servidor, después de sus guardas
-- (bot.service.ts › crearPedido y pago-confirma.ts › pedidoPorComprobante: el
-- archivo vino en ese turno, el cliente vio el resumen, no lo cambió, y el monto
-- del modelo y una lectura aparte del archivo coinciden). Acá se repite el
-- control del monto: p_monto > 0 y a menos de $1 del total de lista o del total
-- en efectivo (suma de coalesce(subtotalEfectivo, subtotal) de los renglones).
-- El envío es sin cargo: el monto esperado nunca suma envío. En este modo el
-- vencimiento de 30 min (vence_en) se reemplaza por 3 h desde creada_en, la
-- misma ventana que usa el servidor: el precio de cada renglón y el total se
-- siguen revalidando igual. En las notas del pedido queda la transferencia «a
-- confirmar por administración» (y, si pagó el total con descuento, que se
-- cobra ese monto y no el de lista); confirmacion = 'comprobante: $X'. No se
-- toca pagado_en: la plata la confirma administración.
--
-- De paso, en el modo 'si' (espejo de comercio.ts › confirmacionInequivoca):
-- el «si» condicional NO es un sí. «Si queres pásame el total y a donde puedo
-- hacerte l transferencia» pasaba como confirmación.
--
-- Los modos 'si' y 'completo' quedan como estaban (salvo el «si» condicional).
-- Compatibilidad: p_modo y p_monto tienen default, así que el código que llama
-- con 4 parámetros (producción) o con p_modo (main) sigue andando igual.
-- NO APLICAR sin revisión: la aplica la sesión principal.

begin;

-- la firma vieja se borra: con dos sobrecargas PostgREST no sabe cuál elegir
drop function if exists public.confirmar_cotizacion_bot(uuid, text, text, text, text);

create or replace function public.confirmar_cotizacion_bot(p_id uuid, p_telefono text, p_linea text, p_confirmacion text, p_modo text default 'si', p_monto numeric default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare q bot_cotizaciones%rowtype; item jsonb; prod productos%rowtype; actual numeric; importe numeric:=0; cantidad numeric; pedido uuid; cliente uuid; resto text;
 v_modo text := coalesce(p_modo,'si'); v_efectivo numeric; v_monto_txt text; v_nota_pago text;
begin
 select * into q from bot_cotizaciones where id=p_id and telefono=p_telefono and linea=p_linea for update;
 if not found then raise exception 'Cotizacion no encontrada para este chat'; end if;
 if v_modo = 'comprobante' then
   -- el comprobante tiene que ser por el total de lista o por el total con
   -- descuento por efectivo o transferencia, con menos de $1 de diferencia
   select coalesce(sum(coalesce((x->>'subtotalEfectivo')::numeric, (x->>'subtotal')::numeric)), 0) into v_efectivo
     from jsonb_array_elements(coalesce(q.items, '[]'::jsonb)) x;
   if p_monto is null or p_monto <= 0
      or not (abs(p_monto - q.total) < 1 or (v_efectivo > 0 and abs(p_monto - v_efectivo) < 1))
   then raise exception 'El monto del comprobante no coincide con el pedido'; end if;
 elsif v_modo = 'completo' then
   -- "no, nada más" cierra: el "no" del principio se saca antes de buscar cambios
   resto := regexp_replace(coalesce(p_confirmacion,''), '^\s*nop?\M[\s,.!]*', '', 'i');
   if p_confirmacion is null or p_confirmacion ~ '\?'
      or resto !~* '^\s*(es todo|eso es todo|eso nom[aá]s|eso nada m[aá]s|eso solo|s[oó]lo eso|nada m[aá]s|por ahora nada m[aá]s|por ahora eso|por ahora es todo|con eso (est[aá]|alcanza|estamos|va|estoy)|ya est[aá]|est[aá] completo|completo|as[ií] est[aá] bien|est[aá] bien as[ií]|as[ií] nom[aá]s|s[ií]\s?s[ií]|s[ií]+|dale|ok|okey|listo|perfecto|genial|b[aá]rbaro|joya|de una|confirmo|confirmalo|👍|👌)(\M|[\s,.!…]|$)'
      or resto ~* '\m(no|falta\w*|pero|tambi[eé]n|sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|mejor|otr[oa]s?|despu[eé]s|todav[ií]a|espera\w*|pienso|veo|cancel\w*)\M|en vez|te (confirmo|aviso)'
   then raise exception 'El cliente no cerro la lista'; end if;
 -- modo 'si': la tercera condición es nueva (5/10/2026): «si querés…», «si
 -- podés…», «si me pasás…» es un si condicional, no un sí
 elsif p_confirmacion is null or p_confirmacion !~* '^\s*(sí|si|dale|ok|listo|confirmo|confirmalo|confirmame|de acuerdo|hacelo|armalo|cerralo|perfecto)(\M|[,.!])'
 or p_confirmacion ~* '\m(no|par[aá]|espera|todav[ií]a|despu[eé]s|pero|cambia\w*|agrega\w*|saca\w*|quita\w*|mejor|otra?\w*|cancel\w*)\M'
 or p_confirmacion ~* '^\s*s[ií]\s+(qui?er\w*|p(o|ue)d\w*|t(e|ie)n\w*|hay|me|te|le|les|sale\w*|es|son|era|fuera|necesit\w*|prefer\w*|vos|usted)\M'
 then raise exception 'Falta confirmacion inequivoca'; end if;
 if q.pedido_id is not null then return q.pedido_id; end if;
 if v_modo = 'comprobante' then
   -- el que pagó no pierde el pedido porque pasaron 30 minutos: 3 h, como el servidor
   if q.creada_en is null or q.creada_en <= now() - interval '3 hours' then raise exception 'La cotizacion vencio: volver a cotizar'; end if;
 elsif q.vence_en<now() then raise exception 'La cotizacion vencio: volver a cotizar'; end if;
 if q.tipo='domicilio' and (coalesce(trim(q.nombre),'')='' or coalesce(q.direccion,'') !~ '[0-9]') then raise exception 'Faltan datos de entrega'; end if;
 if not exists(select 1 from sucursales where id=q.sucursal_id and activa and pickup) then raise exception 'Sucursal de preparacion no disponible'; end if;
 if q.entrega_fecha is not null and q.entrega_fecha<(now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'La fecha de entrega ya paso'; end if;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
  select * into prod from productos where id=(item->>'producto_id')::uuid for share;
  if not found or not prod.activo or prod.sku is distinct from item->>'sku' then raise exception 'Producto no disponible'; end if;
  cantidad:=(item->>'cantidad')::numeric;
  if cantidad is null or cantidad<=0 or cantidad>60 or (not coalesce(prod.vendido_por_peso,false) and cantidad<>trunc(cantidad)) then raise exception 'Cantidad invalida'; end if;
  if prod.unidades_pack is distinct from (item->>'unidades_pack')::integer or coalesce(prod.vendido_por_peso,false) is distinct from (item->>'vendidoPorPeso')::boolean then raise exception 'La presentacion cambio: volver a cotizar'; end if;
  select precio_final into actual from catalogo_precios_bot(array[prod.id],q.cliente_id);
  if actual is null or actual<=0 or round(actual,2) is distinct from round((item->>'precioUnitario')::numeric,2) then raise exception 'El precio cambio: volver a cotizar'; end if;
  importe:=importe+round(cantidad*actual,2);
 end loop;
 if importe is distinct from q.total then raise exception 'Total de cotizacion inconsistente'; end if;
 if v_modo = 'comprobante' then
   -- «$285.390»: miles con punto, como lo lee el local
   v_monto_txt := '$' || replace(to_char(round(p_monto), 'FM999,999,999,990'), ',', '.');
   v_nota_pago := 'Transferencia de ' || v_monto_txt || ' por WhatsApp: a confirmar por administración';
   -- pagó el total con descuento: en el local se cobra eso, no la diferencia con el de lista
   if abs(p_monto - q.total) >= 1 then
     v_nota_pago := v_nota_pago || ' (es el total con descuento por efectivo o transferencia: se cobra ' || v_monto_txt
       || ', no el total de lista $' || replace(to_char(round(q.total), 'FM999,999,999,990'), ',', '.') || ')';
   end if;
 end if;
 cliente:=q.cliente_id;
 if cliente is null then
  perform pg_advisory_xact_lock(hashtextextended('bot-cliente/'||p_telefono,0));
  select id into cliente from clientes where regexp_replace(telefono,'[^0-9]','','g')=p_telefono limit 1;
  if cliente is null then insert into clientes(telefono,nombre) values(p_telefono,q.nombre) returning id into cliente; end if;
 end if;
 insert into pedidos(canal,sucursal_id,cliente_id,estado,total,qr_retiro,reserva_stock,destino_direccion,notas,entrega_fecha,entrega_franja)
 values(q.tipo::canal_venta,q.sucursal_id,cliente,'recibido',q.total,(case when q.tipo='domicilio' then 'DOM-' else 'PICKUP-' end)||upper(substr(replace(q.id::text,'-',''),1,12)),true,q.direccion,
   (case when v_modo='comprobante' then concat_ws(' · ', nullif(trim(q.notas),''), v_nota_pago) else q.notas end),
   q.entrega_fecha,q.entrega_franja) returning id into pedido;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
  insert into pedidos_items(pedido_id,producto_id,cantidad,precio_unitario) values(pedido,(item->>'producto_id')::uuid,(item->>'cantidad')::numeric,(item->>'precioUnitario')::numeric);
  perform registrar_movimiento((item->>'producto_id')::uuid,q.sucursal_id,'reserva',-(item->>'cantidad')::numeric,null,'pedido',pedido::text,null);
 end loop;
 update bot_cotizaciones set pedido_id=pedido,
   confirmacion=(case v_modo when 'completo' then 'completo: '||p_confirmacion when 'comprobante' then 'comprobante: '||v_monto_txt else p_confirmacion end),
   confirmada_en=now() where id=q.id;
 return pedido;
end;
$function$;

-- los mismos permisos que la anterior: solo el servidor (service_role) la
-- ejecuta; una función nueva queda abierta a todos si no se cierra
revoke all on function public.confirmar_cotizacion_bot(uuid, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.confirmar_cotizacion_bot(uuid, text, text, text, text, numeric) to service_role;

commit;

-- que PostgREST vea la firma nueva sin esperar
notify pgrst, 'reload schema';

-- Verificación (después de aplicar):
--   select oid::regprocedure, proacl from pg_proc where proname = 'confirmar_cotizacion_bot';
--   → una sola fila: confirmar_cotizacion_bot(uuid,text,text,text,text,numeric) con {postgres=X/postgres,service_role=X/postgres}

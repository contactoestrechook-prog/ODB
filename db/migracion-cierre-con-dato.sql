-- ============================================================
-- EL DATO QUE FALTABA CONFIRMA EL PEDIDO (9/10/2026, pedido de Leandro)
--
-- confirmar_cotizacion_bot suma el modo 'dato': el cliente vio la lista con
-- el total y contestó con el nombre de quien retira o recibe (o la dirección),
-- que era lo único que faltaba. El servidor lo decide (cierre-con-dato.ts);
-- acá, como segunda barrera, se controla EN POSITIVO (revisión del 9/10):
--   - el mensaje es corto, de una línea, sin pregunta, sin emojis ni símbolos,
--     sin negativas, esperas, condiciones ni cambios;
--   - retiro: cada palabra del mensaje (sacando «a nombre de», «lo retira»…)
--     es una palabra del nombre que quedó en la cotización;
--   - envío: están todos los números de la dirección de la cotización y no
--     hay ninguna palabra que no sea de la dirección o de quien recibe;
--   - la cotización es de los últimos 10 minutos (la del turno).
-- En el modo 'dato', para retiro, quién lo pasa a buscar queda AL FINAL de
-- las notas del pedido («Retira: X»). Los otros modos no cambian en nada
-- (mismas notas que antes, byte por byte).
-- Base: la función de producción del 9/10/2026 (md5 9bee9d84…).
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirmar_cotizacion_bot(p_id uuid, p_telefono text, p_linea text, p_confirmacion text, p_modo text DEFAULT 'si'::text, p_monto numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q bot_cotizaciones%rowtype; item jsonb; prod productos%rowtype; actual numeric; importe numeric:=0; cantidad numeric; pedido uuid; cliente uuid; resto text;
 v_modo text := coalesce(p_modo,'si'); v_efectivo numeric; v_monto_txt text; v_nota_pago text; v_retira text;
 v_txt text; v_pal text[]; v_nom text[]; v_dir text[];
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
 elsif v_modo = 'dato' then
   -- 9/10/2026 (revisada): el dato que faltaba y NADA más, después de ver el total
   v_txt := lower(translate(coalesce(p_confirmacion,''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
   -- un «Sí,» / «Dale,» adelante es parte de la respuesta; un «si» en el medio, no
   v_txt := btrim(regexp_replace(v_txt, '^\s*(hola|buenas|dale|ok|listo|si)[\s,.!]+', ''));
   if v_txt = '' or length(p_confirmacion) > 80 or p_confirmacion ~ '[?\n]'
      or p_confirmacion ~ '[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ[:space:].,''’°º#-]'
      or v_txt ~ '\m(no|pero|tambien|sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|mejor|otr[oa]s?|despues|todavia|espera\w*|cancel\w*|anul\w*|mas|y|sin|menos|quiero|queres|dej\w*|olvid\w*|nah|nop|ni|tampoco|pienso|veo|si|manana|hielo\w*)\M|\mte (aviso|confirmo|digo)\M'
      or q.creada_en is null or q.creada_en <= now() - interval '10 minutes'
   then raise exception 'El dato no confirma el pedido'; end if;
   v_pal := array_remove(regexp_split_to_array(regexp_replace(
              regexp_replace(v_txt, '^(a nombre de|lo (retira|retiro|retiramos|busca)|la retira|retira|soy|me llamo|mi nombre es|es|para)\s+', ''),
              '[^a-z0-9]+', ' ', 'g'), ' '), '');
   v_nom := array_remove(regexp_split_to_array(regexp_replace(lower(translate(coalesce(q.nombre,''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'), ' '), '');
   if coalesce(array_length(v_pal,1),0) = 0 then raise exception 'El dato no confirma el pedido'; end if;
   if q.tipo = 'domicilio' then
     v_dir := array_remove(regexp_split_to_array(regexp_replace(lower(translate(coalesce(q.direccion,''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'), ' '), '');
     if not exists (select 1 from unnest(v_dir) w where w ~ '[0-9]')
        or exists (select 1 from unnest(v_dir) w where w ~ '[0-9]' and not (w = any(v_pal)))
        or not (v_pal <@ (v_dir || v_nom || array['recibe','a','al','en','calle','av','avenida','nro','n','numero','piso','depto','dto','lote','barrio','casa']))
     then raise exception 'El dato no es la direccion de la cotizacion'; end if;
   elsif coalesce(array_length(v_nom,1),0) = 0 or not (v_pal <@ v_nom) then
     raise exception 'El dato no es el nombre de la cotizacion';
   end if;
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
 -- 5/10/2026 (revisión): solo lo de verdad condicional; «si es correcto», «si te
 -- confirmo» o «si son esos» son síes sin tilde (espejo de comercio.ts)
 or p_confirmacion ~* '^\s*s[ií]\s+(qui?er\w*|quisier\w*|p(o|ue)d\w*|t(e|ie)n(es|és|e|en|emos)|hay|sale\w*|necesit\w*|prefer\w*|fuera|era|vos|usted|me\s+(pas\w*|mand\w*|dec\w*|das|dás|dej\w*)|te\s+(parece|sirve|queda|va|viene|conviene))\M'
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
   -- lo primero que se lee en el local: ya transfirió, y qué hacer según administración
   v_nota_pago := 'YA TRANSFIRIÓ ' || v_monto_txt
     || (case when abs(p_monto - q.total) >= 1
          then ' (total con descuento por transferencia; el de lista es $' || replace(to_char(round(q.total), 'FM999,999,999,990'), ',', '.') || ')'
          else '' end)
     || ' por WhatsApp, a confirmar por administración: si está acreditada NO se cobra nada al '
     || (case when q.tipo = 'domicilio' then 'recibir' else 'retirar' end)
     || '; si no, se cobran ' || v_monto_txt;
 end if;
 -- 9/10/2026: en el modo 'dato', para retiro, quién lo pasa a buscar queda a la vista del local
 v_retira := case when v_modo = 'dato' and q.tipo <> 'domicilio' and coalesce(trim(q.nombre),'') <> '' then 'Retira: ' || trim(q.nombre) end;
 cliente:=q.cliente_id;
 if cliente is null then
  perform pg_advisory_xact_lock(hashtextextended('bot-cliente/'||p_telefono,0));
  select id into cliente from clientes where regexp_replace(telefono,'[^0-9]','','g')=p_telefono limit 1;
  if cliente is null then insert into clientes(telefono,nombre) values(p_telefono,q.nombre) returning id into cliente; end if;
 end if;
 insert into pedidos(canal,sucursal_id,cliente_id,estado,total,qr_retiro,reserva_stock,destino_direccion,notas,entrega_fecha,entrega_franja)
 values(q.tipo::canal_venta,q.sucursal_id,cliente,'recibido',q.total,(case when q.tipo='domicilio' then 'DOM-' else 'PICKUP-' end)||upper(substr(replace(q.id::text,'-',''),1,12)),true,q.direccion,
   -- la nota del pago va PRIMERO: el aviso corta las notas a 300 caracteres
   (case when v_modo='comprobante' then concat_ws(' · ', v_nota_pago, nullif(trim(q.notas),''))
         when v_modo='dato' and v_retira is not null then concat_ws(' · ', nullif(trim(q.notas),''), v_retira)
         else q.notas end),
   q.entrega_fecha,q.entrega_franja) returning id into pedido;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
  insert into pedidos_items(pedido_id,producto_id,cantidad,precio_unitario) values(pedido,(item->>'producto_id')::uuid,(item->>'cantidad')::numeric,(item->>'precioUnitario')::numeric);
  perform registrar_movimiento((item->>'producto_id')::uuid,q.sucursal_id,'reserva',-(item->>'cantidad')::numeric,null,'pedido',pedido::text,null);
 end loop;
 update bot_cotizaciones set pedido_id=pedido,
   confirmacion=(case v_modo when 'completo' then 'completo: '||p_confirmacion when 'comprobante' then 'comprobante: '||v_monto_txt when 'dato' then 'dato: '||p_confirmacion else p_confirmacion end),
   confirmada_en=now() where id=q.id;
 return pedido;
end;
$function$;

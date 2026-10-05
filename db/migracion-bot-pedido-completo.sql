-- El "nada más" confirma el pedido (3/10/2026). Pedido de Leandro: "una vez
-- que ya dijo nada más no tiene que preguntar todo el tiempo si lo confirma".
-- Hasta ahora confirmar_cotizacion_bot exigía un "sí" explícito al "¿Lo
-- confirmo?", así que después de "Solo eso…" el bot volvía a preguntar.
--
-- p_modo 'completo': el servidor lo usa SOLO para la cotización que acaba de
-- guardar en el mismo turno en que el cliente cerró la lista (ver
-- bot.service.ts › crearPedido y completo.ts › cierraLaLista). Acá se repite el
-- control: la frase tiene que cerrar la lista y no traer un cambio. Queda
-- registrado como "completo: <lo que dijo>" para poder auditarlo.
-- El modo 'si' (por defecto) no cambia.

drop function if exists public.confirmar_cotizacion_bot(uuid, text, text, text);

create or replace function public.confirmar_cotizacion_bot(p_id uuid, p_telefono text, p_linea text, p_confirmacion text, p_modo text default 'si')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare q bot_cotizaciones%rowtype; item jsonb; prod productos%rowtype; actual numeric; importe numeric:=0; cantidad numeric; pedido uuid; cliente uuid; resto text;
begin
 select * into q from bot_cotizaciones where id=p_id and telefono=p_telefono and linea=p_linea for update;
 if not found then raise exception 'Cotizacion no encontrada para este chat'; end if;
 if coalesce(p_modo,'si') = 'completo' then
   -- "no, nada más" cierra: el "no" del principio se saca antes de buscar cambios
   resto := regexp_replace(coalesce(p_confirmacion,''), '^\s*nop?\M[\s,.!]*', '', 'i');
   if p_confirmacion is null or p_confirmacion ~ '\?'
      or resto !~* '^\s*(es todo|eso es todo|eso nom[aá]s|eso nada m[aá]s|eso solo|s[oó]lo eso|nada m[aá]s|por ahora nada m[aá]s|por ahora eso|por ahora es todo|con eso (est[aá]|alcanza|estamos|va|estoy)|ya est[aá]|est[aá] completo|completo|as[ií] est[aá] bien|est[aá] bien as[ií]|as[ií] nom[aá]s|s[ií]\s?s[ií]|s[ií]+|dale|ok|okey|listo|perfecto|genial|b[aá]rbaro|joya|de una|confirmo|confirmalo|👍|👌)(\M|[\s,.!…]|$)'
      or resto ~* '\m(no|falta\w*|pero|tambi[eé]n|sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|mejor|otr[oa]s?|despu[eé]s|todav[ií]a|espera\w*|pienso|veo|cancel\w*)\M|en vez|te (confirmo|aviso)'
   then raise exception 'El cliente no cerro la lista'; end if;
 elsif p_confirmacion is null or p_confirmacion !~* '^\s*(sí|si|dale|ok|listo|confirmo|confirmalo|confirmame|de acuerdo|hacelo|armalo|cerralo|perfecto)(\M|[,.!])'
 or p_confirmacion ~* '\m(no|par[aá]|espera|todav[ií]a|despu[eé]s|pero|cambia\w*|agrega\w*|saca\w*|quita\w*|mejor|otra?\w*|cancel\w*)\M'
 then raise exception 'Falta confirmacion inequivoca'; end if;
 if q.pedido_id is not null then return q.pedido_id; end if;
 if q.vence_en<now() then raise exception 'La cotizacion vencio: volver a cotizar'; end if;
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
 cliente:=q.cliente_id;
 if cliente is null then
  perform pg_advisory_xact_lock(hashtextextended('bot-cliente/'||p_telefono,0));
  select id into cliente from clientes where regexp_replace(telefono,'[^0-9]','','g')=p_telefono limit 1;
  if cliente is null then insert into clientes(telefono,nombre) values(p_telefono,q.nombre) returning id into cliente; end if;
 end if;
 insert into pedidos(canal,sucursal_id,cliente_id,estado,total,qr_retiro,reserva_stock,destino_direccion,notas,entrega_fecha,entrega_franja)
 values(q.tipo::canal_venta,q.sucursal_id,cliente,'recibido',q.total,(case when q.tipo='domicilio' then 'DOM-' else 'PICKUP-' end)||upper(substr(replace(q.id::text,'-',''),1,12)),true,q.direccion,q.notas,q.entrega_fecha,q.entrega_franja) returning id into pedido;
 for item in select x from jsonb_array_elements(q.items) x order by x->>'producto_id' loop
  insert into pedidos_items(pedido_id,producto_id,cantidad,precio_unitario) values(pedido,(item->>'producto_id')::uuid,(item->>'cantidad')::numeric,(item->>'precioUnitario')::numeric);
  perform registrar_movimiento((item->>'producto_id')::uuid,q.sucursal_id,'reserva',-(item->>'cantidad')::numeric,null,'pedido',pedido::text,null);
 end loop;
 update bot_cotizaciones set pedido_id=pedido,
   confirmacion=(case when coalesce(p_modo,'si')='completo' then 'completo: ' else '' end)||p_confirmacion,
   confirmada_en=now() where id=q.id;
 return pedido;
end;
$function$;

-- los mismos permisos que la anterior: solo el servidor (service_role) la
-- ejecuta; una función nueva queda abierta a todos si no se cierra
revoke all on function public.confirmar_cotizacion_bot(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirmar_cotizacion_bot(uuid, text, text, text, text) to service_role;

-- Productos que se arman a pedido (picadas): el bot pregunta a nombre de quién
-- se retiran. Se marcan las picadas que hay hoy; el dueño puede marcar más.
alter table public.productos add column if not exists se_arma_a_pedido boolean not null default false;
update public.productos set se_arma_a_pedido = true where activo and nombre ~* '\mpicadas?\M';

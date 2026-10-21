-- ENVÍOS PRO · la red de la base para el texto basura (Leandro, 21/10/2026: «misma basura»).
--
-- SIN APLICAR. Se aplica con apply_migration solo con el OK de Leandro. El
-- servidor NO depende de esto: la API ya limpia al guardar y al mostrar
-- (apps/api/src/comun/texto-limpio.ts). Esto cubre a quien escribe directo en
-- la base sin pasar por la API: la función confirmar_cotizacion_bot (copia las
-- notas de la cotización al pedido tal cual) y cualquier escritor futuro.
--
-- El caso: DOM-YD5GNY tiene en notas «WhatsApp: » + un pedazo de la sintaxis
-- de herramientas del bot (el cierre de "notas" y el parámetro "tipo" =
-- domicilio). Envíos lo mostraba como «Indicaciones».
--
-- La regla es la misma de la API y del panel (si cambia, cambia en los tres):
-- - saca invisibles y caracteres de control (deja saltos de línea y el unidor
--   de los emojis compuestos);
-- - CORTA desde la primera apertura de marcado (lo de atrás es otro campo);
-- - en una línea (nombre, dirección) los < > sueltos pasan a espacio;
-- - saca separadores colgando al final («WhatsApp:»);
-- - relleno («null», «N/A») o un rótulo solo («WhatsApp») = NULL.
--
-- NO toca datos existentes: los disparadores actúan solo cuando se escribe
-- esa columna. Lo viejo (DOM-YD5GNY y las tablas internas del bot hasta el
-- 21/9) queda como está hasta que Leandro decida.
--
-- Probado en producción con begin; … ; rollback; (ver el final).

begin;

create or replace function public.texto_sin_marcado(t text, una_linea boolean default false)
returns text
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  v text;
  pos int;
begin
  if t is null then return null; end if;
  -- invisibles y de control
  v := regexp_replace(t, '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2060-\u2064\uFEFF]', '', 'g');
  -- desde la primera apertura de marcado, todo afuera (la barra puede venir escapada)
  pos := regexp_instr(v, '<\s*\\*/?\s*(antml|parameter|invoke|function)|<\\*/\s*[a-z]|<[a-z][[:alnum:]_:.-]*(\s+[[:alnum:]_:.-]+\s*=|\s*/?>)', 1, 1, 0, 'i');
  if pos > 0 then v := substr(v, 1, pos - 1); end if;
  if una_linea then
    v := regexp_replace(regexp_replace(v, '[<>]', ' ', 'g'), '\s+', ' ', 'g');
  else
    v := regexp_replace(v, '\r\n?', E'\n', 'g');
    v := regexp_replace(v, '[ \t]+', ' ', 'g');
    v := regexp_replace(v, ' *\n *', E'\n', 'g');
    v := regexp_replace(v, '\n{3,}', E'\n\n', 'g');
  end if;
  v := btrim(v, E' \t\n');
  v := btrim(regexp_replace(v, '[[:space:]·:;,|–—-]+$', ''), E' \t\n');
  if v ~* '^(null|undefined|none|n/?a|na|vac[ií]o|ningun[ao]|sin (notas|indicaciones|datos|aclaraciones)|-+|—|–|\.+)$'
     or v ~* '^(whatsapp|notas?|indicaciones|observaciones|comentarios?|aclaraci[oó]n(es)?|direcci[oó]n|nombre)$' then
    return null;
  end if;
  return nullif(v, '');
end $$;

comment on function public.texto_sin_marcado(text, boolean) is
  'Saca restos de marcado (sintaxis de herramientas del bot, HTML), invisibles y relleno. Misma regla que apps/api/src/comun/texto-limpio.ts. 21/10/2026.';

-- pedidos: notas, dirección y nombre de contacto. Se llama «pedidos_limpia_textos»
-- a propósito: los BEFORE corren por orden alfabético y este tiene que ir antes
-- de «pedidos_su_cliente_y_pago», que lee las notas para sacar la forma de pago.
create or replace function public.pedidos_limpia_textos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    new.notas := texto_sin_marcado(new.notas);
    new.destino_direccion := texto_sin_marcado(new.destino_direccion, true);
    new.contacto_nombre := texto_sin_marcado(new.contacto_nombre, true);
  exception when others then
    -- un pedido nunca se pierde por la limpieza: entra como vino y queda el aviso
    raise warning 'pedido %: textos sin limpiar: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists pedidos_limpia_textos on public.pedidos;
create trigger pedidos_limpia_textos
  before insert or update of notas, destino_direccion, contacto_nombre on public.pedidos
  for each row execute function public.pedidos_limpia_textos();

-- bot_cotizaciones: lo que preparó el bot antes de confirmar (de acá copia
-- confirmar_cotizacion_bot al pedido).
create or replace function public.bot_cotizaciones_limpia_textos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    new.notas := texto_sin_marcado(new.notas);
    new.nombre := texto_sin_marcado(new.nombre, true);
    new.direccion := texto_sin_marcado(new.direccion, true);
  exception when others then
    raise warning 'cotización %: textos sin limpiar: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists bot_cotizaciones_limpia_textos on public.bot_cotizaciones;
create trigger bot_cotizaciones_limpia_textos
  before insert or update of notas, nombre, direccion on public.bot_cotizaciones
  for each row execute function public.bot_cotizaciones_limpia_textos();

commit;

-- ---------------------------------------------------------------------------
-- Prueba (21/10/2026, en producción, sin dejar nada): se corrió este archivo
-- con «rollback» en lugar de «commit» y, antes del rollback:
--
--   select texto_sin_marcado('WhatsApp: ' || '<' || '/antml name diretipo">domicilio');   → NULL
--   select texto_sin_marcado('Cliente necesita jabón 6M · ' || '<' || '/antml with_this_key/>'); → 'Cliente necesita jabón 6M'
--   select texto_sin_marcado('Lote 95 <casa con portón negro>');            → igual
--   select texto_sin_marcado('Lote 95 <casa con portón negro>', true);      → 'Lote 95 casa con portón negro'
--   select texto_sin_marcado('Pedido > $70.000');                            → igual
--   select texto_sin_marcado('Griller. Paga en efectivo al recibir. Sin factura A, con remito.') → igual
--   update pedidos set notas = notas where qr_retiro = 'DOM-YD5GNY';        → notas NULL (el disparador)
--   update pedidos set notas = notas where qr_retiro = 'DOM-EFB1F49E3E30';  → notas iguales y forma_pago 'efectivo'
-- ---------------------------------------------------------------------------

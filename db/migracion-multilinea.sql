-- VARIAS LÍNEAS DE WHATSAPP CON EL MISMO BOT (6/10/2026) — SIN APLICAR
--
-- Pedido de Leandro: «necesitamos automatizar una nueva línea de ODB, mismo
-- todo pero otra línea» y «comparte todo, está en otro lado de la sucursal».
-- Un segundo número (otro sector de Saint Thomas) atiende con el MISMO bot de
-- pedidos y la MISMA configuración: alias y CBU, a quién se derivan pagos y
-- consultas, notas vigentes (envío sin cargo, eventos) y reglas. Solo cambian
-- el número y la sesión de WAHA.
--
-- El modelo (lo lee apps/api/src/comun/lineas.ts):
--   · lineas_whatsapp.linea sigue siendo el ID de cada número. Es la clave de
--     bot_conversaciones, bot_mensajes, bot_cotizaciones, etc. junto con el
--     teléfono: el mismo cliente en dos líneas son dos charlas, sin tocar
--     ninguna clave primaria. 'pedidos' NO se renombra (al 6/10 tiene 582
--     charlas, 1.028 mensajes, 1.032 notas, 171 consultas y 21 pagos).
--   · tipo dice QUÉ HACE la línea ('pedidos' o 'proveedores'). El código dejó
--     de preguntar «¿es la línea 'pedidos'?»: pregunta por el tipo.
--   · waha_sesion: por qué sesión de WAHA entra y sale todo lo de la línea.
--     NULL = la de la variable WAHA_SESSION (la línea de siempre). El código
--     ya no tiene dos valores por defecto ('odb'/'default'): usa
--     WAHA_SESSION || 'default', el mismo con el que manda todo desde siempre.
--   · nombre: cómo se lee en el panel y en los avisos internos.
--   · comparte_config_de: la línea nueva NO tiene configuración propia; el
--     código lee la de la línea madre en cada mensaje (notas, derivar_pagos_a,
--     avisar_proveedores_a, whatsapp_reparto, whatsapp_compras, alias_pago,
--     titular_pago, banco_pago, cbu_pago). Una copia suelta se desfasaría el
--     día que cambie el CBU o la nota del evento. Para que nadie la cargue «por
--     las dudas» y crea que vale, la fila que comparte tiene esas columnas en
--     NULL (lo exige la regla de la sección 1). Lo propio de cada línea: número,
--     sesión, nombre, activa y bot_activo (el interruptor del panel es por línea).
--
-- ORDEN: esta migración va ANTES del deploy del código multilínea y es
-- compatible con el código de hoy (no borra ni renombra nada; 'pedidos' y
-- 'proveedores' siguen valiendo). El código nuevo también anda con la base
-- vieja mientras haya una sola línea (lee lineas_whatsapp con select('*') y
-- solo escribe una línea con otro nombre cuando esa línea existe), pero la
-- línea nueva NO se puede cargar sin esto: los CHECK de bot_conversaciones y
-- bot_cotizaciones solo aceptan 'pedidos'/'proveedores', y ese upsert falla en
-- silencio (.then(() => null, () => null)): el bot contestaría sin memoria.
--
-- Lo que esta migración NO resuelve: RESPONDE (proyecto smcghyecpzzimadtuern)
-- tiene UN tenant de ODB y guarda los contactos por whatsapp_id, sin línea.
-- Las charlas de las dos líneas se ven ahí y lo que se contesta desde la app
-- sale por la línea de la charla (RespondeAppController), pero un cliente que
-- escribe a los dos números es UN contacto allá, con UN interruptor. Por eso
-- (revisión 6/10/2026) ese interruptor es solo el de la charla de la línea
-- general: la pausa de una línea no pasa a la otra, ni la reactivación. En la
-- línea nueva la pausa vive en ODB (teléfono, panel, acción «bot» de la app
-- embebida); el interruptor directo de la app de RESPONDE no la toca. Separarlo
-- del todo es un tenant por línea en RESPONDE (fase 2).

begin;

-- ---------------------------------------------------------------------------
-- 1. lineas_whatsapp: tipo, sesión de WAHA, nombre y de quién comparte
-- ---------------------------------------------------------------------------
alter table public.lineas_whatsapp
  add column if not exists tipo text,
  add column if not exists waha_sesion text,
  add column if not exists nombre text,
  add column if not exists comparte_config_de text;

-- la fila de hoy es la línea de pedidos de siempre
update public.lineas_whatsapp set tipo = linea where tipo is null and linea in ('pedidos', 'proveedores');
update public.lineas_whatsapp set nombre = 'Línea general' where linea = 'pedidos' and nombre is null;
-- waha_sesion de 'pedidos' queda NULL A PROPÓSITO (= la de WAHA_SESSION). Si
-- alguien confirma el valor (sin pegarlo en un chat), se puede fijar:
--   update public.lineas_whatsapp set waha_sesion = '<el de WAHA_SESSION>' where linea = 'pedidos';
-- Tiene que ser EXACTAMENTE el de WAHA_SESSION: los avisos internos salen por esa variable.

alter table public.lineas_whatsapp alter column tipo set not null;
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_tipo_check;
alter table public.lineas_whatsapp add constraint lineas_whatsapp_tipo_check
  check (tipo in ('pedidos', 'proveedores'));

-- El ID deja de ser una lista cerrada: un nombre corto en minúsculas (va en
-- claves y filtros; 'Pedidos ' mal escrito no abre una línea fantasma). Los
-- dos nombres históricos quedan atados a su tipo.
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_linea_check;
alter table public.lineas_whatsapp add constraint lineas_whatsapp_linea_check
  check (linea ~ '^[a-z][a-z0-9_]{1,29}$' and (linea not in ('pedidos', 'proveedores') or tipo = linea));

-- Una fila por línea: el código hace .eq('linea', x).maybeSingle(), y con dos
-- filas iguales el interruptor apagaría las dos. Y hace falta para la FK de abajo.
-- La FK comparte_config_de depende de esta unique: se borra ANTES, o la segunda
-- corrida de esta migración falla con «cannot drop constraint
-- lineas_whatsapp_linea_key … because other objects depend on it» y se
-- revierte entera (revisión 6/10/2026: se puede correr dos veces).
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_comparte_config_de_fkey;
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_linea_key;
alter table public.lineas_whatsapp add constraint lineas_whatsapp_linea_key unique (linea);

-- La sesión va en la URL de WAHA (/api/{sesion}/…)
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_waha_sesion_check;
alter table public.lineas_whatsapp add constraint lineas_whatsapp_waha_sesion_check
  check (waha_sesion is null or waha_sesion ~ '^[A-Za-z0-9_-]{1,64}$');

-- Dos líneas activas nunca por la misma sesión (contestarían por el número
-- equivocado). NULL cuenta como «la de WAHA_SESSION»: una sola línea activa
-- puede quedar sin sesión propia, la de siempre.
-- OJO (revisión 6/10/2026): con 'pedidos' en NULL, este índice NO frena una
-- fila nueva cargada con waha_sesion = el valor de WAHA_SESSION ('' ≠
-- 'default'). Eso lo ataja el código: la general sin sesión propia se queda con
-- esa sesión, la otra fila no recibe nada y queda una alerta en la campanita
-- (Lineas.enConflictoCon). Ver la sección 4.
drop index if exists public.lineas_whatsapp_waha_sesion_activa;
create unique index lineas_whatsapp_waha_sesion_activa
  on public.lineas_whatsapp ((coalesce(waha_sesion, ''))) where activa;

-- (su drop va arriba, antes de la unique de la que depende)
alter table public.lineas_whatsapp add constraint lineas_whatsapp_comparte_config_de_fkey
  foreign key (comparte_config_de) references public.lineas_whatsapp (linea) on update cascade;

-- La que comparte no tiene configuración propia: se cambia en la línea madre.
alter table public.lineas_whatsapp drop constraint if exists lineas_whatsapp_comparte_config_check;
alter table public.lineas_whatsapp add constraint lineas_whatsapp_comparte_config_check
  check (
    comparte_config_de is null
    or (comparte_config_de <> linea
        and notas is null and derivar_pagos_a is null and avisar_proveedores_a is null
        and whatsapp_reparto is null and whatsapp_compras is null
        and alias_pago is null and titular_pago is null and banco_pago is null and cbu_pago is null)
  );

comment on column public.lineas_whatsapp.linea is
  'ID de la línea (clave en bot_conversaciones y demás junto con el teléfono). ''pedidos'' es la línea general y no se renombra.';
comment on column public.lineas_whatsapp.tipo is
  'Qué hace la línea: pedidos (clientes, el bot de pedidos) o proveedores. El comportamiento depende de esto, no del nombre (6/10/2026).';
comment on column public.lineas_whatsapp.waha_sesion is
  'Sesión de WAHA por la que entra y sale todo lo de esta línea. NULL = la variable WAHA_SESSION (la línea de siempre).';
comment on column public.lineas_whatsapp.nombre is
  'Cómo se llama la línea en el panel y en los avisos internos («Línea general», «Línea local»).';
comment on column public.lineas_whatsapp.comparte_config_de is
  'Si no es NULL, esta línea usa la configuración (notas, pagos, derivaciones, avisos) de esa otra línea, leída en cada mensaje; la suya queda en NULL.';

-- ---------------------------------------------------------------------------
-- 2. Las tablas del bot aceptan cualquier línea con nombre válido
-- ---------------------------------------------------------------------------
-- Sin FK a lineas_whatsapp: hay una charla de la línea 'proveedores' (del
-- simulador), que nunca tuvo fila. El código valida la línea antes de escribir.
alter table public.bot_conversaciones drop constraint if exists bot_conversaciones_linea_check;
alter table public.bot_conversaciones add constraint bot_conversaciones_linea_check
  check (linea ~ '^[a-z][a-z0-9_]{1,29}$');

alter table public.bot_cotizaciones drop constraint if exists bot_cotizaciones_linea_check;
alter table public.bot_cotizaciones add constraint bot_cotizaciones_linea_check
  check (linea ~ '^[a-z][a-z0-9_]{1,29}$');

-- ---------------------------------------------------------------------------
-- 3. Por qué línea entró cada mensaje
-- ---------------------------------------------------------------------------
-- bot_entrantes (el registro del barrido de cada minuto) no sabía la línea.
-- NULL = la principal (así lo escribe el código, y así quedan las de antes).
alter table public.bot_entrantes add column if not exists linea text;
comment on column public.bot_entrantes.linea is
  'Línea (lineas_whatsapp.linea) por la que entró. NULL = la principal (todo lo anterior al 6/10/2026).';

commit;

-- ---------------------------------------------------------------------------
-- 4. LA LÍNEA NUEVA (comentado: falta el número y la sesión)
-- ---------------------------------------------------------------------------
-- Se carga ANTES de vincular el teléfono nuevo en WAHA: el código no contesta
-- los mensajes de una sesión que no es de ninguna línea (los contestaría desde
-- otro número) y deja una alerta en la campanita. Entra con el bot APAGADO: se
-- prueba con «Probar el bot» eligiendo la línea y un teléfono del banco de
-- pruebas (549110000000x), y se prende desde el panel («Encender esta línea»).
-- Mientras el teléfono no esté vinculado, el vigilante avisa «WhatsApp
-- desvinculado: hay que escanear el QR» para esta línea: es lo esperado.
--
-- <SESIÓN> NUNCA puede ser el valor de WAHA_SESSION (ni 'default' si esa
-- variable está vacía): es la sesión de la línea general. Si igual se carga
-- así, el código la ignora (todo sigue siendo de la general), la línea nueva no
-- recibe nada y la campanita avisa «tiene cargada la sesión de WhatsApp de la
-- línea general» (revisión 6/10/2026).
--
-- Al encender la línea desde el panel, ANTES de prender el bot se pausan las
-- charlas que una persona atendió desde ese teléfono en las últimas 24 h
-- («Atendida desde el teléfono»): si el teléfono del otro sector ya se usaba con
-- clientes, el bot no les contesta la bienvenida en medio de la atención. Si
-- WAHA no contesta, la línea NO se prende (revisión 6/10/2026).
--
-- Los números de las dos líneas y los de administración, reparto y compras ya
-- se reconocen solos como de la casa (el bot no les contesta y administración
-- solo «responde avisos» por la línea general). Un número del equipo que
-- escribe con @lid se reconoce por bot_contactos.telefono_real: verificar que
-- el de administración esté aprendido (al 6/10 lo está).
--
-- insert into public.lineas_whatsapp
--   (linea, tipo, nombre, numero_legible, numero_e164, waha_sesion, comparte_config_de, activa, bot_activo)
-- values
--   ('local', 'pedidos', 'Línea local',
--    '<NÚMERO como se lee, ej. 11 5555-1234>',
--    '<NÚMERO>',          -- 549 + área + número, solo dígitos (único en la tabla)
--    '<SESIÓN>',          -- el nombre de la sesión en WAHA (distinto del de WAHA_SESSION)
--    'pedidos', true, false);
--
-- Después de la prueba se prende DESDE EL PANEL («Encender esta línea»), no con
-- un update a mano: el panel primero pausa lo que se venía atendiendo desde ese
-- teléfono, y un update directo se lo saltea (revisión 6/10/2026).

-- ---------------------------------------------------------------------------
-- Si el WAHA de ODB NO admite una segunda sesión (WAHA Core trae solo 'default')
-- ---------------------------------------------------------------------------
-- La línea nueva tendría que ir en OTRA instancia de WAHA, y eso el código de
-- hoy no lo soporta (WAHA_URL y WAHA_API_KEY son una sola): habría que sumar
-- por línea el sufijo de sus variables (WAHA_URL_<X>, WAHA_API_KEY_<X>; las
-- claves nunca en la base) y usarlo en enviarPorWhatsapp, el barrido, el
-- vigilante y la bajada de archivos. Verificar ANTES de pedir el número:
-- GET /api/server/version (Plus o Core) y GET /api/sessions.

-- ---------------------------------------------------------------------------
-- Verificación (solo lectura) después de aplicar
-- ---------------------------------------------------------------------------
-- select linea, tipo, nombre, waha_sesion, comparte_config_de, activa, bot_activo from lineas_whatsapp;
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname like '%linea%' and connamespace = 'public'::regnamespace order by 1;
-- select linea_de_numero('5491122812200');  -- tiene que seguir dando 'pedidos'

-- ---------------------------------------------------------------------------
-- Vuelta atrás (solo si no se cargó ninguna línea nueva)
-- ---------------------------------------------------------------------------
-- begin;
-- alter table public.bot_cotizaciones drop constraint bot_cotizaciones_linea_check;
-- alter table public.bot_cotizaciones add constraint bot_cotizaciones_linea_check check (linea in ('pedidos','proveedores'));
-- alter table public.bot_conversaciones drop constraint bot_conversaciones_linea_check;
-- alter table public.bot_conversaciones add constraint bot_conversaciones_linea_check check (linea in ('pedidos','proveedores'));
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_comparte_config_check;
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_comparte_config_de_fkey;
-- drop index public.lineas_whatsapp_waha_sesion_activa;
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_waha_sesion_check;
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_linea_key;
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_linea_check;
-- alter table public.lineas_whatsapp add constraint lineas_whatsapp_linea_check check (linea in ('pedidos','proveedores'));
-- alter table public.lineas_whatsapp drop constraint lineas_whatsapp_tipo_check;
-- alter table public.lineas_whatsapp drop column comparte_config_de, drop column nombre, drop column waha_sesion, drop column tipo;
-- alter table public.bot_entrantes drop column linea;
-- commit;

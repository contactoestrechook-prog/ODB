-- MEDICIÓN DEL TOPE DE LA BÚSQUEDA DEL BOT (Leandro, 6/10/2026: «sí, arreglalo»)
-- SOLO LECTURA (select). Reproduce BotService.buscarProductos (stock_consulta con
-- tope 40, segunda pasada con comodines, categoría entera si corresponde) y el
-- orden nuevo de tope-busqueda.ts (fija: por defecto / SKU / código / mismo
-- nombre; después palabras en el nombre o la categoría, tamaño pedido, empieza
-- por lo pedido, más vendido). Los casos son los productos que el bot cotizó en
-- los últimos 30 días (bot_cotizaciones + los renglones «• N × producto» de sus
-- respuestas), con la búsqueda que habría hecho: 'esp' con las palabras del
-- cliente, 'nom' con el nombre corto, 'gen' cuando el cliente pidió algo
-- genérico y el bot eligió, y 'corto' (se arma solo) con una sola palabra.
-- Diferencia conocida: la categoría entera se trae con limit 200 sin orden (como
-- en el código), así que en «vino» la muestra puede variar entre corridas.
with params0(id, q, obj, clase) as (values
(1,'smirnoff','L102','esp'),
(2,'coca light','L10886','esp'),
(3,'coca zero','L10952','esp'),
(4,'coca','L10953','esp'),
(5,'sprite zero','L10954','esp'),
(6,'arroz largo fino','L11105','esp'),
(7,'dr pepper','L11171','esp'),
(8,'corona','L112','esp'),
(9,'fideos moños','L11202','nom'),
(10,'fernet 450','L1139','esp'),
(11,'yogur griego','L11569','esp'),
(12,'papel higienico doble hoja','L11693','esp'),
(13,'cafe en grano','L11979','esp'),
(14,'milanesa pane pollo','L12171','esp'),
(15,'rino','L12200','esp'),
(16,'carefree','L12315','nom'),
(17,'budin marmolado','L13111','esp'),
(18,'jabon liquido algabo','L13239','nom'),
(19,'sal gruesa himalaya','L13311','esp'),
(20,'sandwich de miga','L13393','esp'),
(21,'dv catena cabernet','L134','esp'),
(22,'gran enemigo cepillo','L1516','esp'),
(23,'coca zero lata','L1979','esp'),
(24,'sprite zero lata','L2008','esp'),
(25,'carbon','L2144','esp'),
(26,'criollitas','L2417','esp'),
(27,'galletitas traviata','L2418','esp'),
(28,'leche la serenisima entera','L2431','esp'),
(29,'leche la serenisima descremada','L2432','esp'),
(30,'agua villavicencio','L260','esp'),
(31,'villavicencio sin gas 2 litros','L261','esp'),
(32,'azucar ledesma','L2617','nom'),
(33,'fernet','L272','esp'),
(34,'pure de papas','L2722','esp'),
(35,'rollo de cocina','L2746','esp'),
(36,'queso crema casancrem','L2768','esp'),
(37,'villa del sur bidon','L2820','esp'),
(38,'jamon bocatti','L3252','esp'),
(39,'queso rallado','L3303','esp'),
(40,'yerba playadito','L3351','esp'),
(41,'huevos','L3412','esp'),
(42,'rhodesia','L3568','esp'),
(43,'tita','L3569','esp'),
(44,'arroz gallo oro','L3583','esp'),
(45,'picada','L3652','esp'),
(46,'fideos codito','L3734','esp'),
(47,'finlandia light','L3763','esp'),
(48,'vainillas','L3813','esp'),
(49,'carbon','L3859','esp'),
(50,'mayonesa light','L3871','esp'),
(51,'pan','L3931','esp'),
(52,'salchichas vienissima','L4072','esp'),
(53,'cerealitas','L4320','nom'),
(54,'queso danbo la serenisima','L4468','esp'),
(55,'jack daniels','L505','esp'),
(56,'marlboro gold','L5242','esp'),
(57,'sprite zero','L5297','esp'),
(58,'lavandina ayudin','L5603','esp'),
(59,'leche descremada','L5757','esp'),
(60,'citric','L6333','esp'),
(61,'citric','L6415','esp'),
(62,'santa julia tinto','L6588','esp'),
(63,'salentein extra brut','L66','esp'),
(64,'caldo de verdura','L7064','esp'),
(65,'humus','L7066','esp'),
(66,'chandon extra brut','L71','esp'),
(67,'milanesas peceto','L7143','esp'),
(68,'gran enemigo gualtallary','L7177','esp'),
(69,'servilletas','L7192','esp'),
(70,'pan lactal','L7260','esp'),
(71,'judas','L7577','esp'),
(72,'jack daniels','L8038','esp'),
(73,'miranda','L8168','esp'),
(74,'capsulas starbucks colombia','L8311','esp'),
(75,'jack daniels','L933','esp'),
(76,'peroni','L9362','nom'),
(77,'galletitas sonrisas','L9963','esp'),
(78,'rollo de cocina','L9997','esp'),
(79,'lavandina en gel','L2508','esp'),
(80,'poett','L5321','esp'),
(81,'marlboro crafted','L10002','nom'),
(82,'velho barreiro','L106','nom'),
(83,'lost mary','L9060','nom'),
(84,'elfbar','L8568','nom'),
(85,'elfbar','L8551','nom'),
(86,'baron b','L124','nom'),
(87,'bressia conjuro','L1454','nom'),
(88,'catena zapata malbec argentino','L139','nom'),
(89,'schweppes pomelo','L1960','nom'),
(90,'hibiki','L6186','nom'),
(91,'johnnie walker gold','L288','nom'),
(92,'macallan 12','L3067','nom'),
(93,'jugo de limon','L2379','nom'),
(94,'hamburguesas paty','L5017','nom'),
(95,'manteca','L2766','nom'),
(96,'fideos mostachol','L2370','nom'),
(97,'pan integral bimbo','L10049','nom'),
(98,'tostadas riera','L2410','nom'),
(99,'queso rallado la serenisima','L5077','nom'),
(100,'deseado espumante','L2578','nom'),
(101,'tapa de pascualina','L4098','nom'),
(102,'paleta luccianos','L8628','nom'),
(103,'pasta dental colgate','L13026','nom'),
(104,'lysoform','L4439','nom'),
(105,'suavizante vivere','L4007','nom'),
(106,'cif crema','L2956','nom'),
(107,'cif antigrasa','L8353','nom'),
(108,'cif vidrios','L8135','nom'),
(109,'miel','L2980','nom'),
(110,'jabon liquido algabo','L12528','nom'),
(111,'jabon dove','L3862','nom'),
(112,'mostaza','L2720','nom'),
(113,'agua glaciar','L2316','nom'),
(114,'hielo','L1062','nom'),
(115,'quilmes ipa','L8346','nom'),
(116,'amstel','L2629','nom'),
(117,'budweiser','L2604','nom'),
(118,'cruzat','L1912','nom'),
(119,'cinzano','L707','nom'),
(120,'aperol','L566','nom'),
(121,'campari','L158','nom'),
(122,'beefeater','L806','nom'),
(123,'tanqueray','L464','nom'),
(124,'angostura','L856','nom'),
(125,'bacardi blanco','L3608','nom'),
(126,'bacardi gold','L365','nom'),
(127,'jameson','L8656','nom'),
(128,'johnnie walker red','L153','nom'),
(129,'johnnie walker black','L152','nom'),
(130,'johnnie walker island green','L10197','nom'),
(131,'bulleit','L4022','nom'),
(132,'glenfiddich','L1337','nom'),
(133,'glenmorangie','L7150','nom'),
(134,'kamiki','L9366','nom'),
(135,'sernova','L1916','nom'),
(136,'corona 710','L271','nom'),
(137,'gran enemigo gualtallary','L1080','nom'),
(138,'adrianna river','L8554','nom'),
(139,'sprite','L11032','nom'),
(140,'sprite zero','L7136','nom'),
(141,'coca zero 1.5','L7044','nom'),
(142,'coca light','L7135','nom'),
(143,'fanta exotic','L12319','nom'),
(144,'fanta maracuya','L11725','nom'),
(145,'dr pepper','L12129','nom'),
(146,'okf','L12892','nom'),
(147,'inca kola','L12133','nom'),
(148,'villavicencio con gas','L487','nom'),
(149,'cepita multifruta','L13729','nom'),
(150,'aceite de oliva oiioleo','L11849','nom'),
(151,'papel higienico higienol','L2458','nom'),
(152,'carefree tanga','L7858','nom'),
(153,'detergente cif','L12858','nom'),
(154,'detergente cif','L12409','nom'),
(155,'bolsas de residuos','L13049','nom'),
(156,'jabon liquido ala','L2511','nom'),
(157,'cafe cabrales molido','L7668','nom'),
(158,'cafe cabrales molido','L4595','nom'),
(159,'paleta luccianos','L11374','nom'),
(160,'paleta luccianos','L8626','nom'),
(161,'miranda','L7190','nom'),
(162,'barbacoa','L5692','nom'),
(163,'queso cremon','L3792','nom'),
(164,'vainillas','L8245','nom'),
(165,'fusilli barilla','L3328','nom'),
(166,'fideos fusilli','L3856','nom'),
(167,'arroz largo fino','L7433','nom'),
(168,'marlboro blue','L13116','nom'),
(169,'marlboro','L3890','nom'),
(170,'marlboro box','L4039','nom'),
(171,'agua tonica','L1961','nom'),
(172,'hielo','L8582','nom'),
(173,'vasos de fernet','L7474','nom'),
(174,'gin','L10235','gen'),
(175,'vino estuche','L10446','gen'),
(176,'fernet','L11817','gen'),
(177,'bolsas residuos','L12094','gen'),
(178,'vino estuche','L13105','gen'),
(179,'vino estuche','L13132','gen'),
(180,'vino estuche','L13267','gen'),
(181,'vino estuche','L13582','gen'),
(182,'jugo naranja','L1819','gen'),
(183,'vino estuche','L4978','gen'),
(184,'gin','L5009','gen'),
(185,'cafe suave','L6735','gen'),
(186,'vino estuche','L7969','gen'),
(187,'whisky mas de 1 litro','L9271','gen'),
(188,'aceite de oliva','L9349','gen'),
(189,'fernet','L9595','gen'),
(190,'vino estuche','L9664','gen'),
(191,'queso de maquina','L4468','gen'),
(192,'queso de maquina','L11682','gen'),
(193,'masa de tarta','L4098','gen'),
(194,'jamon','L3252','gen'),
(195,'agua 2 litros','L261','gen')
),
params as (
  select id, q, obj, clase from params0
  union all
  select 10000 + id,
    (select w from regexp_split_to_table(q, '\s+') with ordinality x(w, o)
      where length(w) >= 3 and w !~ '^(de|del|la|las|el|los|en|con|sin|por|para|mas|menos|pack|packs|caja|cajas|unidad|unidades|grande|grandes|chico|chica|precio|precios|stock|opciones|tienen|hay|regalo|tipo|unos|unas|kilo|kilos|gramos|ltr|litro|litros)$' order by o limit 1),
    obj, 'corto'
  from params0 where clase in ('esp', 'nom') and q ~ '\s'
),
p as (select id, q, obj, clase, t, lower(t) nq, public.quitar_tildes(t) nt from (select *, btrim(public.unaccent(q)) t from params) z),
p2 as (
  select p.*,
    (select string_agg(w, '%' order by o) from regexp_split_to_table(p.t, '\s+') with ordinality x(w, o) where length(w) >= 2) pct,
    (select count(*) from regexp_split_to_table(p.t, '\s+') w where length(w) >= 2) npal
  from p
),
s1 as (select p2.id, r.sku, r.nombre, r.codigo, r.total, r.ord::int ord from p2 cross join lateral public.stock_consulta(p2.t, 40) with ordinality r(sku, nombre, codigo, sucursales, total, ord)),
c1 as (select p2.id, count(s1.sku) n from p2 left join s1 using (id) group by p2.id),
s2 as (
  select p2.id, r.sku, r.nombre, r.codigo, r.total, 1000 + r.ord::int ord
  from p2 join c1 using (id) cross join lateral public.stock_consulta(p2.pct, 40) with ordinality r(sku, nombre, codigo, sucursales, total, ord)
  where p2.npal >= 2 and c1.n < 5 and not exists (select 1 from s1 where s1.id = p2.id and s1.sku = r.sku)
),
s12 as (select * from s1 union all select * from s2),
st as (select p2.id, count(s12.sku) n, coalesce(bool_or(s12.total > 0), false) hay from p2 left join s12 using (id) group by p2.id),
catn as (select id cat_id, public.quitar_tildes(nombre) nc, (regexp_split_to_array(public.quitar_tildes(nombre), '\s+'))[1] nc1 from categorias),
wq as (select p2.id, x.w from p2 cross join lateral regexp_split_to_table(p2.nq, '\s+') x(w)),
cm as (select distinct wq.id, c.cat_id from wq join catn c on length(wq.w) >= 4 and (strpos(c.nc, regexp_replace(wq.w, '(es|s)$', '')) > 0 or strpos(regexp_replace(wq.w, '(es|s)$', ''), c.nc1) > 0)),
sm as (
  select p2.id,
    exists (select 1 from cm where cm.id = p2.id) hay_cat,
    exists (select 1 from cm where cm.id = p2.id) and not exists (
      select 1 from wq where wq.id = p2.id and not (
        wq.w ~ '^(de|del|la|el|los|las|en|con|x|por|para|mas|menos|o|y|un|una|botella|botellas|litro|litros|lt|lts|l|cc|ml|grande|grandes|chico|chica|balancin|magnum|regalo|opciones|tienen|hay|precio|precios|stock|\d+([.,]\d+)?(l|lt|cc|ml)?)$'
        or exists (select 1 from catn c where length(wq.w) >= 4 and (strpos(c.nc, regexp_replace(wq.w, '(es|s)$', '')) > 0 or strpos(regexp_replace(wq.w, '(es|s)$', ''), c.nc1) > 0)))) sin_marca
  from p2
),
s3 as (
  select p2.id, x.sku, x.nombre, null::text codigo, x.total, 2000 + x.rn::int ord
  from p2 join st using (id) join sm using (id)
  cross join lateral (
    select pr.sku, pr.nombre, (select coalesce(sum(s.cantidad), 0) from stock s where s.producto_id = pr.id) total, row_number() over () rn
    from (select * from productos pr where pr.categoria_id in (select cat_id from cm where cm.id = p2.id) and pr.activo limit 200) pr
  ) x
  where sm.hay_cat and (not st.hay or st.n < 5 or sm.sin_marca) and x.total > 0
    and not exists (select 1 from s12 where s12.id = p2.id and s12.sku = x.sku)
),
todo as (select * from s12 union all select * from s3),
it as (
  select todo.*, pr.id pid, coalesce(pr.unidades_vendidas, 0) vend, pr.es_alcohol, pr.unidades_pack, pr.vendido_por_peso, cat.nombre catnom,
    public.quitar_tildes(todo.nombre) nn
  from todo left join productos pr on pr.sku = todo.sku left join categorias cat on cat.id = pr.categoria_id
  where todo.total > 0
),
pt as (
  select p2.id,
    p2.nt ~ '\y(grandes?|balancin(es)?|magnum|galon(es)?|mas de|mayor(es)? a|de mas)\y' grande,
    coalesce(
      (select round(v) from (select replace(substring(x.tt from '(\d{2,5}(?:[.,]\d+)?)\s*(?:cc|ml|cm3)(?![a-z])'), ',', '.')::numeric v) a where v between 50 and 20000),
      (select round(v * 1000) from (select replace(substring(x.tt from '(\d{1,2}(?:[.,]\d{1,3})?)\s*(?:l|lt|lts|ltr|litros?)(?![a-z])'), ',', '.')::numeric v) a where v > 0 and v <= 20)) ml
  from p2 cross join lateral (select regexp_replace(regexp_replace(p2.nt, '\yun litro\y', '1 l'), '\ymedio litro\y', '500 cc') tt) x
),
pt2 as (select id, grande, ml, (ml is not null or grande) tamano from pt),
-- palabras de elegirPorDefecto (completo.ts)
wpd as (
  select distinct p2.id, regexp_replace(w, '(es|s)$', '') w from p2 cross join lateral regexp_split_to_table(p2.nt, '[^a-z0-9]+') w
  where length(w) >= 3 and w !~ '^(de|del|la|las|el|los|con|sin|por|para|x|en|y|o|un|una|gr|grs|kg|cc|ml|lt|lts|litro|litros)$'
),
-- palabras del orden nuevo (sin números ni relleno)
wr as (
  select id, w, min(o) o from (
    select p2.id, regexp_replace(w, '(es|s)$', '') w, o from p2 cross join lateral regexp_split_to_table(p2.nt, '[^a-z0-9]+') with ordinality x(w, o)
    where length(w) >= 3 and w !~ '\d' and w !~ '^(de|del|la|las|el|los|en|con|sin|por|para|mas|menos|pack|packs|caja|cajas|unidad|unidades|grande|grandes|chico|chica|precio|precios|stock|opciones|tienen|hay|regalo|tipo|unos|unas|kilo|kilos|gramos|ltr|litro|litros)$'
  ) z group by id, w
),
qb as (select p2.id, (select string_agg(w, ' ' order by o) from wr where wr.id = p2.id) base_q, (select count(*) from wr where wr.id = p2.id) k, (select w from wr where wr.id = p2.id order by o limit 1) w0 from p2),
itt as (
  select it.*,
    array(select regexp_replace(w, '(es|s)$', '') from regexp_split_to_table(it.nn, '[^a-z0-9]+') w) toks,
    array(select regexp_replace(w, '(es|s)$', '') from regexp_split_to_table(public.quitar_tildes(coalesce(it.catnom, '')), '[^a-z0-9]+') w) ctoks,
    array(select distinct regexp_replace(w, '(es|s)$', '') from regexp_split_to_table(it.nn, '[^a-z0-9]+') w
      where length(w) >= 3 and w !~ '\d' and w !~ '^(de|del|la|las|el|los|en|con|sin|por|para|mas|menos|pack|packs|caja|cajas|unidad|unidades|grande|grandes|chico|chica|precio|precios|stock|opciones|tienen|hay|regalo|tipo|unos|unas|kilo|kilos|gramos|ltr|litro|litros)$') kw,
    coalesce(
      (select round(v) from (select replace(substring(it.nn from '(\d{2,5}(?:[.,]\d+)?)\s*(?:cc|ml|cm3)(?![a-z])'), ',', '.')::numeric v) a where v between 50 and 20000),
      (select round(v * 1000) from (select replace(substring(it.nn from '(\d{1,2}(?:[.,]\d{1,3})?)\s*(?:l|lt|lts|ltr|litros?)(?![a-z])'), ',', '.')::numeric v) a where v > 0 and v <= 20)) vol
  from it
),
itc as (
  select itt.*,
    (select count(*) from wpd where wpd.id = itt.id and exists (select 1 from unnest(itt.toks) tk where tk = wpd.w or (length(wpd.w) >= 4 and tk like wpd.w || '%'))) cobpd,
    (select count(*) from wr where wr.id = itt.id and exists (select 1 from unnest(itt.toks) tk where tk = wr.w or (length(wr.w) >= 4 and tk like wr.w || '%'))) c_nom,
    (select count(*) from wr where wr.id = itt.id and exists (select 1 from unnest(itt.toks || itt.ctoks) tk where tk = wr.w or (length(wr.w) >= 4 and tk like wr.w || '%'))) c,
    (select tk from unnest(itt.toks) with ordinality u(tk, o) where tk <> '' order by o limit 1) tok0
  from itt
),
pd as (
  select distinct on (i.id) i.id, i.sku from itc i join pt2 using (id) join (select id, max(cobpd) mx from itc group by id) m using (id)
  where not pt2.tamano and m.mx > 0 and i.cobpd = m.mx and i.vend > 0 order by i.id, i.vend desc, i.ord
),
rk as (
  select i.*, qb.k, qb.base_q,
    (pd.sku is not null) por_defecto,
    (lower(i.sku) = lower(p2.t) or (i.codigo is not null and i.codigo = p2.t) or (qb.k > 0 and i.c_nom = qb.k and (pt2.ml is null or i.vol = pt2.ml) and not exists (select 1 from unnest(i.kw) n where n !~ '^(fraccion|fraccionado|fraccionada|botella|botellita|lata|sachet|tetra|pack|caja|estuche|bolsa|frasco|pote|doypack|porron|vidrio|pet|descartable|retornable|unidad|granel|suelto|suelta)$' and not exists (select 1 from wr where wr.id = i.id and (n = wr.w or (length(wr.w) >= 4 and n like wr.w || '%'))))) or (p2.t ~ '^\d{6,}$' and i.ord = 1)) exacta,
    coalesce(case when pt2.ml is not null then i.vol = pt2.ml when pt2.grande then i.vol > 1000 else false end, false) talle,
    coalesce(qb.w0 is not null and (i.tok0 = qb.w0 or (length(qb.w0) >= 4 and i.tok0 like qb.w0 || '%')), false) empieza
  from itc i join p2 using (id) join qb using (id) join pt2 using (id) left join pd on pd.id = i.id and pd.sku = i.sku
),
rk2 as (
  select rk.*,
    row_number() over (partition by id order by (por_defecto or exacta) desc, c desc, talle desc, (empieza and c = k) desc, vend desc, ord) rank_a,
    count(*) over (partition by id) n_items
  from rk
)
, res as (
  select p.id, p.q, p.clase, p.obj, coalesce(max(rk2.n_items), 0) n, min(rk2.rank_a) filter (where rk2.sku = p.obj) puesto
  from p left join rk2 using (id) group by p.id, p.q, p.clase, p.obj
)
-- puesto = lugar del producto cotizado en el orden nuevo (null: hoy no aparece
-- con stock en esa búsqueda, queda fuera de la cuenta). Con tope N y el margen
-- de 5, queda con ficha si n <= N + 5 o puesto <= N; nombrado si puesto <= N + 40.
select id, q, clase, obj, n, puesto from res order by id;

-- TAMAÑO (caracteres de las fichas): cambiar params0 por las búsquedas comunes
-- (clase 'tam') y este select final por la suma de
--   length(jsonb_strip_nulls(jsonb_build_object(...la ficha de buscarProductos...))::text)
-- por puesto <= N (ver el informe del commit).


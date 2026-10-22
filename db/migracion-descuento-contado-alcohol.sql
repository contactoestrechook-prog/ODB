-- 10% PAGANDO EN EFECTIVO O TRANSFERENCIA EN BEBIDAS CON ALCOHOL, MENOS CERVEZA
-- (Leandro, 22/10/2026: «todo lo que es bebida con alcohol menos cerveza en
-- efectivo y transferencia tiene 10% de descuento; cuando pongamos efectivo o
-- transferencia, que se aplique automáticamente»).
--
-- Usa el motor de descuentos que ya existe (tabla descuentos + precio_vigente,
-- que registrar_venta llama con el medio de pago de la venta): una fila por
-- categoría de bebida y por medio. Se ven y se apagan desde Promociones.
-- La regla va por CATEGORÍA y no por productos.es_alcohol: esa marca está mal en
-- muchos productos (alfajores y chocolates «con alcohol», añadas y pisco «sin»).
-- Estuchería queda afuera hasta que el dueño decida: mezcla estuches con bebida
-- y sin bebida (fraperas, tablas) y la marca de alcohol ahí tampoco sirve.
--
-- precios_contado(): el precio pagando en efectivo/transferencia de cada sku, para
-- que la caja muestre y cobre lo mismo que después calcula la base (si no, los
-- pagos no coinciden con el total y la venta se rechaza).

insert into descuentos (nombre, alcance, categoria_id, tipo, valor, desde, hasta, medio_pago, combinable, activo, solo_comunidad)
select 'Contado 10% · ' || c.nombre || ' · ' || m.etiqueta, 'categoria', c.id, 'porcentaje', 10,
       now(), '2099-12-31 23:59:59-03', m.medio, false, true, false
  from categorias c
 cross join (values ('efectivo', 'Efectivo'), ('transferencia', 'Transferencia')) m(medio, etiqueta)
 where c.nombre ~* '^\s*(vinos?|a(ñ|n)adas|espumante|cavas?|whisk|gin\s*$|vodka|ron\s*$|tequila|licor|aperitiv|destilad|sidra)'
   and c.nombre !~* 'cervez'
   and not exists (select 1 from descuentos d where d.categoria_id = c.id and d.medio_pago = m.medio
                    and d.activo and d.nombre like 'Contado 10% · %');

create or replace function precios_contado(p_skus text[])
returns table(sku text, precio_contado numeric, precio_contado_mayorista numeric)
language sql stable security definer set search_path to 'public'
as $$
  select x.sku, x.minorista, x.mayorista
    from (
      select p.sku,
             (select pv.precio_final from precio_vigente(p.id, now(), null, 'efectivo', false, false) pv
               where pv.precio_final < pv.precio_lista) minorista,
             (select pv.precio_final from precio_vigente(p.id, now(), null, 'efectivo', false, true) pv
               where pv.precio_final < pv.precio_lista) mayorista
        from productos p
       where p.sku = any(p_skus)
         and p.categoria_id in (select d.categoria_id from descuentos d
                                 where d.activo and d.medio_pago = 'efectivo' and d.alcance = 'categoria'
                                   and now() between d.desde and d.hasta)
    ) x
   where x.minorista is not null or x.mayorista is not null;
$$;

revoke all on function precios_contado(text[]) from public, anon, authenticated;
grant execute on function precios_contado(text[]) to service_role;

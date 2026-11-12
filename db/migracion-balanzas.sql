-- ============================================================
-- LISTA DE PLU PARA LAS BALANZAS KRETZ (Leandro, 11/11/2026: «sí, armala»)
--
-- NÚCLEO ya lee las etiquetas de la balanza (2 + PLU + gramos + control) y
-- cobra con el precio de la lista Minorista. Faltaba el camino de vuelta: que
-- la balanza imprima el mismo precio. iTegra (el programa de Kretz) importa un
-- archivo con la lista de PLU; esta migración da lo que la API necesita para
-- armarlo.
--
-- · productos.en_balanza: un producto que se vende POR UNIDAD y sale con
--   etiqueta de la balanza (la torta matera, PLU 12717). Los que se venden por
--   peso van siempre; estos, sólo si alguien los suma.
-- · balanza_lista(): los productos activos que van a la balanza, con su PLU y
--   el precio que cobra la caja (el mismo cálculo que pos_buscar: lista
--   Minorista, el precio con la vigencia más nueva).
--
-- Aditiva: una columna con valor por defecto y una función. Sin aplicarla, la
-- pantalla avisa que falta y nada más se toca. Solo la usa la API (service_role).
-- ============================================================

alter table public.productos
  add column if not exists en_balanza boolean not null default false;

create or replace function public.balanza_lista()
returns table (
  producto_id uuid,
  sku text,
  nombre text,
  plu text,
  por_peso boolean,
  en_balanza boolean,
  precio numeric,
  precio_desde timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with lm as (select id from listas_precios where nombre = 'Minorista' limit 1)
  select p.id, p.sku, p.nombre,
    coalesce(nullif(trim(p.plu), ''), p.codigo_legacy),
    p.vendido_por_peso, p.en_balanza,
    pr.precio, pr.vigente_desde
  from productos p
  left join lateral (
    select x.precio, x.vigente_desde from precios x, lm
    where x.producto_id = p.id and x.lista_id = lm.id
    order by x.vigente_desde desc limit 1
  ) pr on true
  where p.activo and (p.vendido_por_peso or p.en_balanza)
  order by p.nombre;
$$;

revoke all on function public.balanza_lista() from public, anon, authenticated;
grant execute on function public.balanza_lista() to service_role;

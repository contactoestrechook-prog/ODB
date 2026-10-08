-- ============================================================
-- LO QUE NOS VENDE CADA PROVEEDOR (8/10/2026, pedido de Leandro)
--
-- «Cada vez que una factura ingresa el sistema tiene que ir guardando todos
-- los productos que ese proveedor trabaja, para luego en la mesa de compras
-- tener info valiosa disponible.»
--
-- compras_historial: un renglón por cada renglón de cada factura registrada,
-- también los que no se vincularon a un producto de la casa, con lo que dice
-- el papel (código del proveedor, bultos, unidades por bulto, precio,
-- bonificación, IVA, importe) y cómo entró al stock (cantidad y costo final).
-- La carga por foto lo guarda al registrar; la mesa de compras lo resume.
--
-- Aparte de facturas_proveedor_items, que es la base del cruce contra remitos
-- y no se toca.
-- Sin políticas de RLS: la lee y escribe solo la API (service role).
-- ============================================================

create table if not exists public.compras_historial (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  lectura_id uuid references public.lecturas_comprobante(id) on delete set null,
  factura_id uuid references public.facturas_proveedor(id) on delete set null,
  numero text,
  fecha date not null default current_date,
  renglon int,
  producto_id uuid references public.productos(id) on delete set null,
  codigo_proveedor text,
  descripcion text not null,
  bultos numeric,
  unidades_por_bulto numeric,
  sueltas numeric,
  unidades numeric,
  precio numeric,
  bonificacion_pct numeric,
  alicuota_iva numeric,
  importe numeric,
  entra_como text,
  cantidad_stock numeric,
  costo_unitario numeric,
  incluido boolean not null default false,
  es_descuento boolean not null default false,
  origen text not null default 'foto',
  usuario_id uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  -- volver a registrar la misma factura reemplaza sus renglones
  constraint compras_historial_renglon unique (proveedor_id, numero, renglon)
);
create index if not exists compras_historial_proveedor on public.compras_historial (proveedor_id, fecha desc);
create index if not exists compras_historial_producto on public.compras_historial (producto_id, fecha desc) where producto_id is not null;
alter table public.compras_historial enable row level security;
revoke all on public.compras_historial from anon, authenticated;

-- ------------------------------------------------------------
-- CARGA INICIAL con lo ya registrado
-- 1) Facturas y remitos que se cargaron por foto: la lectura trae TODOS los
--    renglones (también los sin vincular). Se toma la última lectura de cada
--    proveedor + número que figura registrado.
-- 2) Facturas sin lectura: los renglones guardados para el cruce.
-- ------------------------------------------------------------
with registrados as (
  select proveedor_id, numero, id as factura_id, coalesce(fecha_emision, creado_en::date) as fecha from public.facturas_proveedor
  union all
  select r.proveedor_id, r.numero, r.factura_id, r.creado_en::date from public.remitos r
  where not exists (select 1 from public.facturas_proveedor f where f.proveedor_id = r.proveedor_id and f.numero = r.numero)
),
lecturas as (
  select distinct on (g.proveedor_id, g.numero) l.id as lectura_id, g.proveedor_id, g.numero, g.factura_id, g.fecha, l.resultado
  from public.lecturas_comprobante l
  join registrados g on g.numero = l.resultado->'comprobante'->>'numero'
    and g.proveedor_id::text = l.resultado->'proveedor'->'match'->>'id'
  where l.estado = 'listo'
  order by g.proveedor_id, g.numero, l.creado_en desc
),
renglones as (
  select x.*, it, ord,
    case when jsonb_typeof(it->'interpretado'->'cantidad') = 'number' then (it->'interpretado'->>'cantidad')::numeric
         when jsonb_typeof(it->'cantidad') = 'number' then (it->>'cantidad')::numeric end as unidades,
    case when jsonb_typeof(it->'precio') = 'number' then (it->>'precio')::numeric end as precio,
    coalesce(case when jsonb_typeof(it->'interpretado'->'bonificacionPct') = 'number' then (it->'interpretado'->>'bonificacionPct')::numeric end,
             case when jsonb_typeof(it->'bonificacionPct') = 'number' then (it->>'bonificacionPct')::numeric end) as bonificacion_pct,
    coalesce(case when jsonb_typeof(it->'interpretado'->'unidadesPorBulto') = 'number' then (it->'interpretado'->>'unidadesPorBulto')::numeric end,
             case when jsonb_typeof(it->'unidadesPorBulto') = 'number' then (it->>'unidadesPorBulto')::numeric end) as unidades_por_bulto,
    case when jsonb_typeof(it->'alicuotaIva') = 'number' then (it->>'alicuotaIva')::numeric end as alicuota_iva,
    coalesce(case when jsonb_typeof(it->'interpretado'->'importeNeto') = 'number' then (it->'interpretado'->>'importeNeto')::numeric end,
             case when jsonb_typeof(it->'importe') = 'number' then (it->>'importe')::numeric end) as importe
  from lecturas x, jsonb_array_elements(coalesce(x.resultado->'items', '[]'::jsonb)) with ordinality as e(it, ord)
)
insert into public.compras_historial (proveedor_id, lectura_id, factura_id, numero, fecha, renglon, producto_id, codigo_proveedor, descripcion,
  unidades_por_bulto, unidades, precio, bonificacion_pct, alicuota_iva, importe, incluido, es_descuento, origen)
select r.proveedor_id, r.lectura_id, r.factura_id, r.numero, r.fecha, r.ord, p.id, nullif(trim(r.it->>'codigo'), ''),
  coalesce(nullif(trim(r.it->>'descripcion'), ''), '(renglón)'),
  r.unidades_por_bulto, r.unidades, r.precio, r.bonificacion_pct, r.alicuota_iva, r.importe,
  p.id is not null, coalesce((r.it->>'esDescuento')::boolean, false), 'historico'
from renglones r
left join public.productos p on p.sku = r.it->'match'->>'sku' and coalesce((r.it->'match'->>'sugerido')::boolean, false) = false
on conflict (proveedor_id, numero, renglon) do nothing;

insert into public.compras_historial (proveedor_id, factura_id, numero, fecha, renglon, producto_id, descripcion, unidades, precio, importe, incluido, origen)
select f.proveedor_id, f.id, f.numero, coalesce(f.fecha_emision, f.creado_en::date),
  row_number() over (partition by f.id order by i.id)::int, i.producto_id, i.descripcion, i.cantidad, i.precio, i.cantidad * i.precio,
  i.producto_id is not null, 'historico'
from public.facturas_proveedor f
join public.facturas_proveedor_items i on i.factura_id = f.id
where not exists (select 1 from public.compras_historial h where h.proveedor_id = f.proveedor_id and h.numero = f.numero)
on conflict (proveedor_id, numero, renglon) do nothing;

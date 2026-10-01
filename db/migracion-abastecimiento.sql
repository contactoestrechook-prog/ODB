-- ============================================================
-- ABASTECIMIENTO (1/10/2026): ritmo de venta vs stock vs plazo de entrega
--
-- Pedido de Leandro: la mesa de compras tiene un agente que sabe qué falta,
-- qué no llega a tiempo y qué proponer comprar. La alerta no es un número fijo:
-- un producto que vende 3 por día y cuyo proveedor tarda 10 días tiene que
-- avisar con 40 unidades, no con 12. Y antes de comprarle a un proveedor,
-- administración lo tiene que tener bien cargado.
--
--   1) Plazo de entrega APRENDIDO: cuándo se aprobó/envió cada orden y cuándo
--      entró. Mediana de las últimas 5 del proveedor; con menos de 2, el
--      plazo declarado (y se avisa si nunca se confirmó).
--   2) proveedor_faltantes(): la ÚNICA definición de "proveedor bien cargado".
--      La usan el freno de las órdenes, el agente y la pantalla.
--   3) Freno: una orden no se aprueba ni se envía con el proveedor incompleto.
--      Crear la orden sí se puede (queda "a aprobar") y administración recibe
--      el pedido en la campanita; al completar el proveedor, el aviso se
--      cierra solo y el dueño se entera de que ya puede aprobar. La compra
--      directa (factura de mercadería que ya entró) no se frena.
--   4) abastecimiento(): por producto y sucursal, stock, en camino, ritmo,
--      cobertura, proveedor, plazo, alerta y cantidad sugerida.
-- ============================================================

alter table public.ordenes_compra
  add column if not exists enviada_en timestamptz,
  add column if not exists recibida_en timestamptz;

alter table public.proveedores
  add column if not exists lead_time_confirmado boolean not null default false;

comment on column public.proveedores.lead_time_confirmado is
  'El plazo de entrega lo cargó administración (no es el 7 por defecto). Requisito para comprarle.';

-- ---------- 1) fechas para aprender el plazo real ----------
create or replace function public.oc_sellar_fechas() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado = 'enviada' and new.enviada_en is null then new.enviada_en := now(); end if;
  if new.estado in ('recibida_parcial', 'recibida') and new.recibida_en is null then new.recibida_en := now(); end if;
  return new;
end $$;

drop trigger if exists oc_sellar_fechas on public.ordenes_compra;
create trigger oc_sellar_fechas before insert or update of estado on public.ordenes_compra
  for each row execute function public.oc_sellar_fechas();

-- ---------- 2) proveedor bien cargado ----------
create or replace function public.proveedor_faltantes(p_id uuid) returns text[]
language sql stable set search_path = public as $$
  select coalesce(
    (select array_remove(array[
       case when coalesce(btrim(p.razon_social), '') = '' then 'razón social' end,
       case when coalesce(regexp_replace(p.cuit, '\D', '', 'g'), '') !~ '^\d{11}$' then 'CUIT' end,
       case when coalesce(regexp_replace(p.telefono, '\D', '', 'g'), '') !~ '^\d{8,15}$' then 'teléfono / WhatsApp' end,
       case when coalesce(btrim(p.condicion_pago), '') = '' then 'condición de pago' end,
       case when p.lead_time_dias is null or not p.lead_time_confirmado then 'plazo de entrega' end
     ], null)
     from public.proveedores p where p.id = p_id),
    array['proveedor']);
$$;

-- ---------- 3) freno y avisos ----------
create or replace function public.oc_exigir_proveedor() returns trigger
language plpgsql set search_path = public as $$
declare
  faltan text[];
begin
  if new.estado in ('aprobada', 'enviada') and (tg_op = 'INSERT' or old.estado is distinct from new.estado) then
    faltan := public.proveedor_faltantes(new.proveedor_id);
    if cardinality(faltan) > 0 then
      raise exception 'PROVEEDOR_INCOMPLETO: antes de aprobar o enviar esta orden, administración tiene que cargar del proveedor: %',
        array_to_string(faltan, ', ') using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists oc_exigir_proveedor on public.ordenes_compra;
create trigger oc_exigir_proveedor before insert or update of estado on public.ordenes_compra
  for each row execute function public.oc_exigir_proveedor();

-- Orden nueva con proveedor incompleto: UN aviso por proveedor a cada
-- administrativo (si ya tiene uno sin leer, se le suma el número de orden).
create or replace function public.oc_pedir_proveedor_completo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  faltan text[];
  nombre text;
  adm record;
  previa uuid;
begin
  if new.estado not in ('borrador', 'pendiente_aprobacion') then return new; end if;
  faltan := public.proveedor_faltantes(new.proveedor_id);
  if cardinality(faltan) = 0 then return new; end if;
  select razon_social into nombre from public.proveedores where id = new.proveedor_id;
  for adm in select id from public.usuarios where activo and rol = 'administrativo' loop
    previa := null;
    select a.id into previa from public.alertas_internas a
     where a.tipo = 'proveedor_incompleto' and a.leida_en is null and a.para_usuario = adm.id
       and a.referencia->>'proveedor_id' = new.proveedor_id::text
     limit 1;
    if previa is not null then
      update public.alertas_internas
         set detalle = detalle || E'\nTambién espera la orden #' || new.numero || '.',
             referencia = referencia || jsonb_build_object('ordenes', coalesce(referencia->'ordenes', '[]'::jsonb) || to_jsonb(new.numero))
       where id = previa;
    else
      insert into public.alertas_internas (para_usuario, tipo, titulo, detalle, referencia)
      values (adm.id, 'proveedor_incompleto',
        'Completá el proveedor ' || coalesce(nombre, '(sin nombre)'),
        'Se le va a comprar (orden #' || new.numero || ') y no se puede aprobar hasta que esté bien cargado. Falta: ' || array_to_string(faltan, ', ') || '.',
        jsonb_build_object('proveedor_id', new.proveedor_id, 'ordenes', jsonb_build_array(new.numero), 'link', '/compras?proveedor=' || new.proveedor_id));
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists oc_pedir_proveedor_completo on public.ordenes_compra;
create trigger oc_pedir_proveedor_completo after insert on public.ordenes_compra
  for each row execute function public.oc_pedir_proveedor_completo();

-- Proveedor completo: se cierran los pedidos a administración y se avisa a
-- quien creó cada orden que espera (o a los dueños) que ya se puede aprobar.
create or replace function public.proveedor_completado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oc record;
begin
  if not exists (select 1 from public.alertas_internas a where a.tipo = 'proveedor_incompleto' and a.leida_en is null
                  and a.referencia->>'proveedor_id' = new.id::text) then return new; end if;
  if cardinality(public.proveedor_faltantes(new.id)) > 0 then return new; end if;
  update public.alertas_internas set leida_en = now()
   where tipo = 'proveedor_incompleto' and leida_en is null and referencia->>'proveedor_id' = new.id::text;
  for oc in select numero, creada_por from public.ordenes_compra
             where proveedor_id = new.id and estado in ('borrador', 'pendiente_aprobacion') loop
    insert into public.alertas_internas (para_usuario, tipo, titulo, detalle, referencia)
    values (oc.creada_por, 'proveedor_completo',
      'Orden #' || oc.numero || ': el proveedor ya está completo',
      new.razon_social || ' quedó bien cargado. La orden ya se puede aprobar.',
      jsonb_build_object('proveedor_id', new.id, 'orden', oc.numero, 'link', '/aprobaciones'));
  end loop;
  return new;
end $$;

drop trigger if exists proveedor_completado on public.proveedores;
create trigger proveedor_completado after update on public.proveedores
  for each row execute function public.proveedor_completado();

-- ---------- 4) el motor ----------
create or replace function public.abastecimiento(
  p_sucursal uuid default null,
  p_solo_alertas boolean default true,
  p_proveedor uuid default null,
  p_q text default null,
  p_limite int default 200
) returns table (
  producto_id uuid, sku text, nombre text, categoria text,
  sucursal_id uuid, sucursal text,
  stock numeric, en_camino numeric,
  ritmo_dia numeric, ritmo_fuente text, ritmo_hasta date, tendencia_pct numeric,
  cobertura_dias numeric,
  proveedor_id uuid, proveedor text, proveedor_faltan text[],
  plazo_dias numeric, plazo_fuente text,
  punto_pedido numeric, alerta text, urgencia numeric,
  cantidad_sugerida numeric, ultimo_costo numeric,
  ultima_compra date, ultima_cantidad numeric
)
language plpgsql stable set search_path = public as $fn$
begin
  -- Consulta dinámica a propósito: como función SQL, Postgres la planificaba con un
  -- plan genérico (sin los valores de los parámetros) y tardaba 6,4 s; planificada
  -- en cada llamada tarda ~0,1 s.
  return query execute $q$
with
suc as (
  select s.id, s.nombre from sucursales s where s.activa and ($1 is null or s.id = $1)
),
-- reportes de ventas del sistema viejo: el último período de cada sucursal y el anterior
periodos as (
  select x.sucursal_id, x.desde, x.hasta, (x.hasta - x.desde + 1)::numeric dias,
         row_number() over (partition by x.sucursal_id order by x.hasta desc, x.desde desc) n
  from (select distinct vh.sucursal_id, vh.desde, vh.hasta from ventas_historicas vh) x
),
per_suc as (
  select pe.sucursal_id,
         max(pe.dias) filter (where pe.n = 1) d1, max(pe.hasta) filter (where pe.n = 1) hasta1,
         max(pe.dias) filter (where pe.n = 2) d2
  from periodos pe group by pe.sucursal_id
),
hist as (
  select vh.producto_id, vh.sucursal_id,
         sum(vh.unidades) filter (where pe.n = 1) u1,
         sum(vh.unidades) filter (where pe.n = 2) u2
  from ventas_historicas vh
  join periodos pe on pe.sucursal_id = vh.sucursal_id and pe.desde = vh.desde and pe.hasta = vh.hasta and pe.n <= 2
  where vh.producto_id is not null
  group by vh.producto_id, vh.sucursal_id
),
-- ventas de ODB (caja, pedidos): últimos 30 días, sobre los días que lleva vendiendo
vivas_dias as (
  select v.sucursal_id, greatest(1, least(30, current_date - min(v.vendida_en)::date + 1))::numeric dias
  from ventas v where v.estado = 'completada' and v.vendida_en > now() - interval '30 days' group by v.sucursal_id
),
vivas as (
  select vi.producto_id, v.sucursal_id, sum(vi.cantidad) u
  from ventas_items vi join ventas v on v.id = vi.venta_id
  where v.estado = 'completada' and v.vendida_en > now() - interval '30 days'
  group by vi.producto_id, v.sucursal_id
),
-- lo que ya está pedido y no entró (incluye órdenes a aprobar: no se pide dos veces)
camino as (
  select oci.producto_id, oc.sucursal_id, sum(greatest(oci.cantidad - coalesce(oci.cantidad_recibida, 0), 0)) u
  from ordenes_compra_items oci join ordenes_compra oc on oc.id = oci.oc_id
  where oc.estado in ('borrador', 'pendiente_aprobacion', 'aprobada', 'enviada', 'recibida_parcial')
  group by oci.producto_id, oc.sucursal_id
),
-- compras anteriores (para el proveedor habitual, el costo y la cantidad de siempre)
compras as (
  select oci.producto_id, oc.sucursal_id, oc.proveedor_id, oc.creado_en fecha, oci.cantidad, oci.costo_unitario
  from ordenes_compra_items oci join ordenes_compra oc on oc.id = oci.oc_id
  where oc.estado <> 'cancelada'
),
ult_compra as (
  select distinct on (c.producto_id, c.sucursal_id) c.producto_id, c.sucursal_id, c.fecha, c.cantidad
  from compras c order by c.producto_id, c.sucursal_id, c.fecha desc
),
prov_cand as (
  select c.producto_id, c.proveedor_id, c.fecha, c.costo_unitario costo from compras c
  union all
  select pp.producto_id, pp.proveedor_id, coalesce(pp.actualizado_en, '2000-01-01'::timestamptz), pp.ultimo_costo from proveedor_productos pp
),
prov as (
  select distinct on (pc.producto_id) pc.producto_id, pc.proveedor_id, pc.costo
  from prov_cand pc join proveedores pr on pr.id = pc.proveedor_id and pr.activo
  order by pc.producto_id, pc.fecha desc
),
-- plazo real de cada proveedor: mediana de sus últimas 5 órdenes recibidas
plazos as (
  select y.proveedor_id, percentile_cont(0.5) within group (order by y.d) d, count(*) n
  from (
    select oc.proveedor_id,
           extract(epoch from (oc.recibida_en - coalesce(oc.enviada_en, oc.aprobada_en))) / 86400.0 d,
           row_number() over (partition by oc.proveedor_id order by oc.recibida_en desc) k
    from ordenes_compra oc
    where oc.recibida_en is not null and coalesce(oc.enviada_en, oc.aprobada_en) is not null
      and oc.recibida_en > coalesce(oc.enviada_en, oc.aprobada_en)
  ) y where y.k <= 5 group by y.proveedor_id
),
-- lo que le falta a cada proveedor, una vez por proveedor (por fila tardaba 6 s)
prov_falt as (
  select pr.id, public.proveedor_faltantes(pr.id) faltan from proveedores pr
),
base as (
  select st.producto_id, st.sucursal_id, greatest(st.cantidad, 0) stock from stock st join suc on suc.id = st.sucursal_id
  union
  select h.producto_id, h.sucursal_id, 0 from hist h join suc on suc.id = h.sucursal_id
   where not exists (select 1 from stock st where st.producto_id = h.producto_id and st.sucursal_id = h.sucursal_id)
),
calc as (
  select b.producto_id, p.sku, p.nombre, cat.nombre categoria, b.sucursal_id, suc.nombre sucursal,
         b.stock, coalesce(ca.u, 0) en_camino,
         -- ritmo del sistema viejo: 70% el último período, 30% el anterior (si hay)
         case when ps.d1 is null then 0
              when ps.d2 is null then coalesce(h.u1, 0) / ps.d1
              else 0.7 * coalesce(h.u1, 0) / ps.d1 + 0.3 * coalesce(h.u2, 0) / ps.d2 end r_hist,
         coalesce(vv.u, 0) / coalesce(vd.dias, 30) r_vivo,
         ps.hasta1, ps.d1, ps.d2, h.u1, h.u2,
         coalesce(p.unidades_vendidas, 0) > 0 vendio,
         pv.proveedor_id, pr.razon_social proveedor, pr.lead_time_dias, pr.lead_time_confirmado,
         pl.d plazo_apr, pl.n plazo_n,
         pv.costo ultimo_costo, uc.fecha::date ultima_compra, uc.cantidad ultima_cantidad,
         pf.faltan
  from base b
  join productos p on p.id = b.producto_id and p.activo
  join suc on suc.id = b.sucursal_id
  left join categorias cat on cat.id = p.categoria_id
  left join per_suc ps on ps.sucursal_id = b.sucursal_id
  left join hist h on h.producto_id = b.producto_id and h.sucursal_id = b.sucursal_id
  left join vivas vv on vv.producto_id = b.producto_id and vv.sucursal_id = b.sucursal_id
  left join vivas_dias vd on vd.sucursal_id = b.sucursal_id
  left join camino ca on ca.producto_id = b.producto_id and ca.sucursal_id = b.sucursal_id
  left join prov pv on pv.producto_id = b.producto_id
  left join proveedores pr on pr.id = pv.proveedor_id
  left join plazos pl on pl.proveedor_id = pv.proveedor_id
  left join prov_falt pf on pf.id = pv.proveedor_id
  left join ult_compra uc on uc.producto_id = b.producto_id and uc.sucursal_id = b.sucursal_id
  where ($3 is null or pv.proveedor_id = $3)
    and ($4 is null or p.nombre ilike '%' || $4 || '%' or p.sku ilike $4 or coalesce(p.alias_busqueda, '') ilike '%' || $4 || '%')
),
c2 as (
  select c.*,
         greatest(c.r_hist, c.r_vivo) ritmo,
         case when c.plazo_n >= 2 then round(c.plazo_apr::numeric, 1) else coalesce(c.lead_time_dias, 7)::numeric end plazo
  from calc c
),
c3 as (
  select c.*,
         greatest(2, ceil(c.plazo * 0.3)) seguridad,
         case when c.ritmo > 0 then (c.stock + c.en_camino) / c.ritmo end cobertura,
         c.ritmo > 0 or c.vendio vende
  from c2 c
),
c4 as (
  select c.*,
         case
           when c.stock <= 0 and c.en_camino <= 0 and c.vende then 'sin_stock'
           when c.ritmo > 0 and c.cobertura <= c.plazo + c.seguridad then 'no_llega'
           when c.stock + c.en_camino < 12 and c.vende then 'menos_de_12'
         end alerta
  from c3 c
)
select c.producto_id, c.sku, c.nombre, c.categoria, c.sucursal_id, c.sucursal,
       c.stock, c.en_camino,
       round(c.ritmo, 2),
       case when c.r_vivo > 0 and c.r_vivo >= c.r_hist then 'ventas de ODB, últimos 30 días'
            when c.hasta1 is not null then 'sistema viejo, período hasta ' || to_char(c.hasta1, 'DD/MM/YYYY')
            else 'sin datos de ventas' end,
       c.hasta1,
       case when c.d2 is not null and coalesce(c.u2, 0) > 0
            then round(((coalesce(c.u1, 0) / c.d1) / (c.u2 / c.d2) - 1) * 100) end,
       round(c.cobertura, 1),
       c.proveedor_id, c.proveedor,
       case when c.proveedor_id is null then array['sin proveedor habitual'] else c.faltan end,
       c.plazo,
       case when c.proveedor_id is null then 'sin proveedor: 7 días por defecto'
            when c.plazo_n >= 2 then 'aprendido de ' || c.plazo_n || ' compras'
            when c.lead_time_confirmado then 'declarado por el proveedor'
            else 'sin confirmar: 7 días por defecto' end,
       ceil(c.ritmo * (c.plazo + c.seguridad)),
       c.alerta,
       round(case c.alerta
         when 'sin_stock' then 1000 + c.ritmo * 10
         when 'no_llega' then 500 + (c.plazo + c.seguridad - c.cobertura) * 10 + c.ritmo
         when 'menos_de_12' then 100 + c.ritmo * 10
         else 0 end, 1),
       greatest(
         ceil(c.ritmo * (c.plazo + c.seguridad + 14) - c.stock - c.en_camino),
         case when c.vende then 12 - c.stock - c.en_camino else 0 end,
         0),
       c.ultimo_costo, c.ultima_compra, c.ultima_cantidad
from c4 c
where not $2 or c.alerta is not null
order by 21 desc, c.ritmo desc, c.nombre
limit greatest(1, least(coalesce($5, 200), 20000))
  $q$ using p_sucursal, p_solo_alertas, p_proveedor, p_q, p_limite;
end $fn$;

revoke all on function public.abastecimiento(uuid, boolean, uuid, text, int) from public, anon, authenticated;
revoke all on function public.proveedor_faltantes(uuid) from public, anon, authenticated;
grant execute on function public.abastecimiento(uuid, boolean, uuid, text, int) to service_role;
grant execute on function public.proveedor_faltantes(uuid) to service_role;

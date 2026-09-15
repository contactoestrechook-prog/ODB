-- ============================================================
-- MÓDULO "MI TURNO" EN LA CAJA (2026-09-12)
--
-- La cajera trabaja a ciegas: cobra y no vuelve a ver nada. Si el cliente
-- pregunta "¿cuánto me cobraste?", "¿me diste la factura?" o se arrepiente del
-- medio de pago, hoy no hay dónde mirar. Esto le da su turno completo:
-- cuánto lleva vendido por medio de pago, cada ticket con su comprobante, y
-- el cambio de medio de pago auditado.
--
-- El resumen y el listado se resuelven ENTEROS en Postgres. Antes el backend
-- traía todas las ventas del turno y pedía los pagos de a 300 desde Node: con
-- el volumen de Sant Thomas (cientos de tickets por turno) eso se arrastra.
-- ============================================================

-- ---- índices que faltaban (todo este módulo filtra por sesión) ----
create index if not exists ventas_sesion_caja_idx
  on public.ventas (sesion_caja_id, vendida_en desc);

-- ---- auditoría del cambio de medio de pago ----
-- Cambiar cómo se cobró una venta toca la plata del arqueo: queda registrado
-- qué había antes, qué quedó, quién lo hizo y qué supervisor lo autorizó.
create table if not exists public.ventas_cambios_pago (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  sesion_caja_id uuid references public.sesiones_caja(id),
  pagos_antes jsonb not null,
  pagos_despues jsonb not null,
  motivo text,
  -- reembolso de Mercado Pago disparado por el cambio (si lo hubo)
  mp_payment_id text,
  mp_refund_id text,
  mp_estado text,
  usuario_id uuid references public.usuarios(id),
  autorizado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists ventas_cambios_pago_venta_idx
  on public.ventas_cambios_pago (venta_id, creado_en desc);
create index if not exists ventas_cambios_pago_sesion_idx
  on public.ventas_cambios_pago (sesion_caja_id, creado_en desc);

-- ============================================================
-- Resumen del turno: una sola consulta para toda la cabecera.
-- ============================================================
create or replace function public.caja_turno_resumen(p_sesion uuid)
returns jsonb
language sql
stable
as $$
with v as (
  select id, total, estado
    from public.ventas
   where sesion_caja_id = p_sesion
),
completadas as (select * from v where estado = 'completada'),
p as (
  select pg.medio, pg.terminal, pg.monto
    from public.pagos pg
    join completadas c on c.id = pg.venta_id
),
medios as (
  select medio,
         terminal,
         round(sum(monto)::numeric, 2) as monto,
         count(*)::int                 as pagos
    from p
   group by medio, terminal
),
movs as (
  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0) as ingresos,
         coalesce(sum(monto) filter (where tipo = 'egreso'),  0) as egresos
    from public.caja_movimientos
   where sesion_id = p_sesion
),
comp as (
  select c.tipo::text as tipo, count(*)::int as cantidad,
         count(*) filter (where c.cae is null)::int as sin_cae
    from public.comprobantes c
    join completadas v2 on v2.id = c.venta_id
   group by c.tipo
)
select jsonb_build_object(
  'tickets',        (select count(*)::int from completadas),
  'anuladas',       (select count(*)::int from v where estado <> 'completada'),
  'total',          (select coalesce(round(sum(total)::numeric, 2), 0) from completadas),
  'ticketPromedio', (select case when count(*) = 0 then 0
                          else round((sum(total) / count(*))::numeric, 2) end from completadas),
  'medios',         (select coalesce(jsonb_agg(jsonb_build_object(
                       'medio', medio, 'terminal', terminal,
                       'monto', monto, 'pagos', pagos) order by monto desc), '[]'::jsonb) from medios),
  'efectivoVentas', (select coalesce(sum(monto), 0) from p where medio = 'efectivo'),
  'ingresos',       (select ingresos from movs),
  'egresos',        (select egresos  from movs),
  'comprobantes',   (select coalesce(jsonb_agg(jsonb_build_object(
                       'tipo', tipo, 'cantidad', cantidad, 'sinCae', sin_cae) order by tipo), '[]'::jsonb) from comp)
);
$$;

-- ============================================================
-- Tickets del turno, paginados, con sus medios de pago y su comprobante.
-- p_buscar acepta el final del id de la venta, el número de comprobante,
-- el importe exacto o el nombre/DNI del cliente: es lo que la cajera tiene
-- a mano cuando el cliente vuelve al mostrador.
-- ============================================================
create or replace function public.caja_turno_ventas(
  p_sesion uuid,
  p_buscar text default null,
  p_medio  text default null,
  p_limite int  default 50,
  p_offset int  default 0
)
returns jsonb
language sql
stable
as $$
with base as (
  select v.id, v.total, v.estado, v.vendida_en, v.descuento,
         cl.nombre as cliente_nombre, cl.dni as cliente_dni
    from public.ventas v
    left join public.clientes cl on cl.id = v.cliente_id
   where v.sesion_caja_id = p_sesion
),
conpagos as (
  select b.*,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'medio', pg.medio, 'terminal', pg.terminal,
                            'monto', pg.monto, 'mpPaymentId', pg.mp_payment_id)
                          order by pg.monto desc)
                     from public.pagos pg where pg.venta_id = b.id), '[]'::jsonb) as pagos,
         (select string_agg(distinct pg.medio, ',') from public.pagos pg where pg.venta_id = b.id) as medios_txt,
         (select jsonb_build_object('tipo', c.tipo, 'puntoVenta', c.punto_venta,
                                    'numero', c.numero, 'cae', c.cae, 'estado', c.estado)
            from public.comprobantes c
           where c.venta_id = b.id and c.tipo::text in ('FA','FB','FC','REM')
           order by c.emitido_en desc limit 1) as comprobante,
         (select count(*) from public.ventas_cambios_pago cp where cp.venta_id = b.id) as cambios
    from base b
),
filtrado as (
  select * from conpagos
   where (p_medio is null or medios_txt like '%' || p_medio || '%')
     and (
       p_buscar is null or btrim(p_buscar) = '' or
       right(id::text, 8) ilike '%' || btrim(p_buscar) || '%' or
       coalesce(cliente_nombre, '') ilike '%' || btrim(p_buscar) || '%' or
       coalesce(cliente_dni, '')    ilike btrim(p_buscar) || '%' or
       (p_buscar ~ '^[0-9]+(\.[0-9]+)?$' and total = p_buscar::numeric) or
       (p_buscar ~ '^[0-9]+$' and (comprobante->>'numero') = ltrim(btrim(p_buscar), '0'))
     )
)
select jsonb_build_object(
  'total', (select count(*)::int from filtrado),
  'items', coalesce((
     select jsonb_agg(jsonb_build_object(
              'id', id,
              'ticket', upper(right(id::text, 8)),
              'total', total,
              'descuento', descuento,
              'estado', estado,
              'vendidaEn', vendida_en,
              'cliente', case when cliente_nombre is null and cliente_dni is null then null
                              else jsonb_build_object('nombre', cliente_nombre, 'dni', cliente_dni) end,
              'pagos', pagos,
              'comprobante', comprobante,
              'cambiosPago', cambios)
            order by vendida_en desc)
     from (select * from filtrado order by vendida_en desc
            limit greatest(least(coalesce(p_limite, 50), 200), 1)
           offset greatest(coalesce(p_offset, 0), 0)) pag), '[]'::jsonb)
);
$$;

-- ============================================================
-- Reemplaza los pagos de una venta ya cobrada (el cliente se arrepintió del
-- medio). Atómica: o cambia todo o no cambia nada. NO toca el comprobante
-- fiscal: la factura no depende de con qué se pagó.
--
-- El reembolso de Mercado Pago lo hace el backend ANTES de llamar acá: si la
-- plata no volvió, el medio no se cambia.
-- ============================================================
create or replace function public.cambiar_medio_pago_venta(
  p_venta uuid,
  p_pagos jsonb,               -- [{medio, monto, terminal?}]
  p_usuario uuid,
  p_autorizado_por uuid,
  p_motivo text default null,
  p_mp jsonb default null      -- {paymentId, refundId, estado} del reembolso, si hubo
)
returns jsonb
language plpgsql
as $$
declare
  v_venta   public.ventas%rowtype;
  v_antes   jsonb;
  v_suma    numeric;
  v_item    jsonb;
begin
  select * into v_venta from public.ventas where id = p_venta for update;
  if not found then
    raise exception 'La venta no existe';
  end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se puede cambiar el medio de pago de una venta completada';
  end if;
  if p_autorizado_por is null then
    raise exception 'Falta la autorización del supervisor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'medio', medio, 'monto', monto, 'terminal', terminal,
           'mpPaymentId', mp_payment_id)), '[]'::jsonb)
    into v_antes
    from public.pagos where venta_id = p_venta;

  select coalesce(sum((x->>'monto')::numeric), 0) into v_suma
    from jsonb_array_elements(p_pagos) x;
  if round(v_suma, 2) <> round(v_venta.total, 2) then
    raise exception 'Los pagos suman % y la venta es de %', round(v_suma, 2), round(v_venta.total, 2);
  end if;

  delete from public.pagos where venta_id = p_venta;
  for v_item in select * from jsonb_array_elements(p_pagos) loop
    if coalesce((v_item->>'monto')::numeric, 0) <= 0 then
      raise exception 'Hay un pago con importe cero o negativo';
    end if;
    insert into public.pagos (venta_id, medio, monto, terminal)
    values (p_venta,
            v_item->>'medio',
            (v_item->>'monto')::numeric,
            nullif(v_item->>'terminal', ''));
  end loop;

  insert into public.ventas_cambios_pago
    (venta_id, sesion_caja_id, pagos_antes, pagos_despues, motivo,
     mp_payment_id, mp_refund_id, mp_estado, usuario_id, autorizado_por)
  values
    (p_venta, v_venta.sesion_caja_id, v_antes, p_pagos, nullif(btrim(coalesce(p_motivo, '')), ''),
     p_mp->>'paymentId', p_mp->>'refundId', p_mp->>'estado', p_usuario, p_autorizado_por);

  return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', p_pagos, 'total', v_venta.total);
end;
$$;

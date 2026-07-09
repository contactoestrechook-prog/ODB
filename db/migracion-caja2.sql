-- ============================================================================
-- Caja tanda 2 — descuento con PIN, movimientos de efectivo y devolución parcial
-- Aplicada en Supabase (proyecto ODB) el 2026-07-01.
--
--   caja_movimientos          ingresos/retiros de efectivo por sesión (cambio,
--                             retiro a tesorería, reintegro de devolución)
--   cerrar_sesion_caja        el arqueo ahora suma ingresos y resta egresos
--   registrar_venta           + p_descuento_extra y p_autorizado_por: descuento
--                             manual autorizado por PIN de supervisor, auditado
--   verificar_pin_supervisor  valida el PIN (bcrypt o sha256 legacy) contra
--                             gerentes/dueños activos
--   devolver_venta_parcial    devolución por renglón: valida contra lo ya
--                             devuelto, repone stock, NC en cola ARCA, auditoría
--
-- NOTA: registrar_venta cambió de firma (se DROPeó la versión de 8 parámetros).
-- El cuerpo completo de cada función quedó volcado en db/esquema-real/04-funciones.sql
-- (regenerar ese directorio tras aplicar esta migración).
-- ============================================================================

create table if not exists public.caja_movimientos (
  id bigint generated always as identity primary key,
  sesion_id uuid not null references sesiones_caja(id),
  tipo text not null check (tipo in ('ingreso','egreso')),
  monto numeric(14,2) not null check (monto > 0),
  motivo text not null,
  usuario_id uuid references usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists caja_movimientos_sesion_idx on public.caja_movimientos (sesion_id);

-- (cuerpos de cerrar_sesion_caja, registrar_venta v2, verificar_pin_supervisor y
--  devolver_venta_parcial: ver db/esquema-real/04-funciones.sql regenerado)

-- 2026-07-02: consulta de stock por sucursal para la caja (el cajero ve ambas
-- sucursales). RPC stock_consulta(q, limit) → sku, nombre, sucursales jsonb, total.
-- Endpoint GET /pos/stock (rol cajero+). Cuerpo en db/esquema-real/04-funciones.sql.

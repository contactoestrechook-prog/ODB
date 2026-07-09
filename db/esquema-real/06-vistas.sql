-- =============================================================
-- ODB — Esquema real: vistas
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-01
-- Fuente: pg_get_viewdef sobre pg_views (schema public)
-- =============================================================

create or replace view stock_critico as
 SELECT p.sku,
    p.nombre AS producto,
    s.sucursal_id,
    su.nombre AS sucursal,
    s.cantidad,
    s.stock_minimo,
    s.punto_reposicion
   FROM stock s
     JOIN productos p ON p.id = s.producto_id AND p.activo
     JOIN sucursales su ON su.id = s.sucursal_id
  WHERE s.punto_reposicion > 0::numeric AND s.cantidad <= s.punto_reposicion
  ORDER BY (s.cantidad / NULLIF(s.punto_reposicion, 0::numeric));

create or replace view sugerencias_compra as
 SELECT p.id AS producto_id,
    p.sku,
    p.nombre AS producto,
    st.sucursal_id,
    su.nombre AS sucursal,
    st.cantidad,
    st.punto_reposicion,
    GREATEST(st.punto_reposicion * 2::numeric - st.cantidad, 0::numeric)::numeric(12,3) AS cantidad_sugerida,
    pp.proveedor_id,
    pr.razon_social AS proveedor,
    pp.ultimo_costo,
    pr.lead_time_dias
   FROM stock st
     JOIN productos p ON p.id = st.producto_id AND p.activo
     JOIN sucursales su ON su.id = st.sucursal_id
     LEFT JOIN LATERAL ( SELECT x.proveedor_id,
            x.producto_id,
            x.codigo_proveedor,
            x.ultimo_costo,
            x.actualizado_en
           FROM proveedor_productos x
          WHERE x.producto_id = p.id
          ORDER BY x.ultimo_costo
         LIMIT 1) pp ON true
     LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
  WHERE st.punto_reposicion > 0::numeric AND st.cantidad <= st.punto_reposicion;

-- =============================================================
-- ODB — Esquema real: triggers
-- Volcado desde Supabase (proyecto utemmsmuwocerhmuxrbs) el 2026-07-01
-- Fuente: pg_get_triggerdef sobre pg_trigger (no internos, tablas de public)
-- Las funciones que ejecutan están en 04-funciones.sql.
-- =============================================================

CREATE TRIGGER trg_touch_cheque BEFORE UPDATE ON public.cheques FOR EACH ROW EXECUTE FUNCTION touch_cheque();

CREATE TRIGGER trg_acreditacion_pago AFTER INSERT ON public.pagos FOR EACH ROW EXECUTE FUNCTION fn_acreditacion_por_pago();

CREATE TRIGGER trg_puntos_venta AFTER INSERT OR UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION fn_puntos_por_venta();

CREATE TRIGGER trg_referido_venta AFTER INSERT OR UPDATE ON public.ventas FOR EACH ROW EXECUTE FUNCTION fn_referido_por_venta();

-- LA FACTURA A MEDIO CARGAR SE GUARDA SOLA (Leandro, 3/11/2026): «no tomó los
-- cambios viejos; cuando modificamos algo hay que hacer todo otra vez». Lo que
-- una persona corrige en la pantalla de carga (vínculos, unidades, IVA,
-- internos, devoluciones, el pie) vivía solo en el navegador: al recargar o
-- volver a abrir la factura desde la bandeja, se perdía.
--
-- Se guarda SOLO lo que la persona cambió, renglón por renglón, contra lo que
-- leyó el sistema. Al abrir, la lectura se interpreta con las reglas de HOY y
-- encima van esos cambios.
alter table public.lecturas_comprobante
  add column if not exists borrador jsonb,
  add column if not exists borrador_en timestamptz,
  add column if not exists borrador_por uuid references public.usuarios(id) on delete set null;

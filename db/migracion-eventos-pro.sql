-- ============================================================
-- EVENTOS PROFESIONAL (21/10/2026, pedido de Leandro: la pantalla de Eventos
-- "es basura")
--
-- La pantalla nueva carga eventos para gente que todavía no es cliente
-- (contacto nuevo: nombre + WhatsApp), anota dónde es la fiesta y de qué
-- oportunidad salió (cumpleaños, empresa para fin de año, compra grande o a
-- mano). La tabla `eventos` solo tenía nombre, fecha, invitados y notas.
--
-- Aditiva: cuatro columnas que aceptan null. No se toca nada de lo que hay.
--
--   lugar              salón, quinta, oficina… (sale también en el PDF)
--   contacto_nombre    quién habla por el evento (puede no ser el titular
--   contacto_telefono  del cliente: la novia, la secretaria de la empresa).
--                      El teléfono va solo con dígitos.
--   origen             manual | cumpleanos | fin_de_ano | compra_grande:
--                      para saber qué oportunidades terminan en venta.
--
-- El API funciona igual SIN esta migración: si la base rechaza las columnas
-- nuevas (PGRST204), reintenta y deja el lugar y el contacto escritos en las
-- notas (apps/api/src/eventos/eventos.logica.ts → pasarExtrasANotas).
--
-- Los índices que usa la pantalla ya existen: idx_eventos_estado (estado,
-- fecha) e idx_eventos_cliente (cliente_id).
-- ============================================================

alter table public.eventos add column if not exists lugar text;
alter table public.eventos add column if not exists contacto_nombre text;
alter table public.eventos add column if not exists contacto_telefono text;
alter table public.eventos add column if not exists origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_origen_valido') then
    alter table public.eventos
      add constraint eventos_origen_valido
      check (origen is null or origen in ('manual', 'cumpleanos', 'fin_de_ano', 'compra_grande'));
  end if;
end $$;

comment on column public.eventos.lugar is 'Dónde es el evento (salón, quinta, oficina). Sale en el presupuesto.';
comment on column public.eventos.contacto_nombre is 'Quién habla por el evento, si no es el titular del cliente.';
comment on column public.eventos.contacto_telefono is 'WhatsApp del contacto, solo dígitos.';
comment on column public.eventos.origen is 'De dónde salió: manual, cumpleanos, fin_de_ano o compra_grande.';

-- que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

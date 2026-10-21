-- ============================================================
-- FRACCIONAR "BIEN PRO" (21/10/2026, pedido de Leandro)
--
-- «Módulo totalmente basura, hacelo bien pro, no tiene la opción para sumar
-- nada.» La pantalla Fraccionar ahora arma el grupo entero (sumar pozo y
-- presentaciones, editar, quitar), carga el pozo y muestra el historial.
--
-- El código de la API ya valida todo esto antes de escribir y funciona SIN
-- esta migración. Esto lo deja garantizado también en la base, para que ni
-- un script ni otra pantalla rompan la cuenta del pozo:
--
--   productos_fraccion_valida   (trigger) un producto no es presentación de
--                               sí mismo; un pozo no es a la vez presentación
--                               (no hay cadenas pozo → docena → media); una
--                               presentación siempre dice cuánto lleva; y lo
--                               que lleva no cambia mientras haya armadas (al
--                               abrirlas volverían al pozo con la cuenta nueva
--                               y aparecerían o desaparecerían huevos).
--   movimientos_stock_fraccionar_idx
--                               índice chico (solo esos movimientos) para el
--                               historial de la pantalla, que filtra por
--                               sucursal y referencia 'fraccionamiento' /
--                               'carga_pozo' (la carga manual del pozo).
--
-- Los datos de hoy ya cumplen (verificado 21/10: 0 casos de cada regla).
-- Aditiva: no cambia fraccionar_producto ni registrar_movimiento.
-- ============================================================

create or replace function public.tg_productos_fraccion_valida()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_pozo productos%rowtype;
  v_armadas numeric;
begin
  -- quitar del grupo: las dos columnas en null y listo
  if new.fraccion_de is null then
    if new.unidades_por_fraccion is not null then
      raise exception 'Un producto sin pozo no puede llevar unidades por fracción';
    end if;
    return new;
  end if;

  if new.unidades_por_fraccion is null then
    raise exception 'La presentación % tiene que decir cuánto lleva del pozo', new.nombre;
  end if;
  if new.fraccion_de = new.id then
    raise exception 'Un producto no puede ser presentación de sí mismo';
  end if;

  select * into v_pozo from productos where id = new.fraccion_de;
  if v_pozo.fraccion_de is not null then
    raise exception '% ya es una presentación: no puede ser el pozo de %', v_pozo.nombre, new.nombre;
  end if;
  if exists (select 1 from productos where fraccion_de = new.id) then
    raise exception '% es el pozo de otras presentaciones: no puede ser presentación', new.nombre;
  end if;

  if tg_op = 'UPDATE'
     and old.fraccion_de is not null
     and old.unidades_por_fraccion is distinct from new.unidades_por_fraccion then
    select coalesce(sum(cantidad), 0) into v_armadas
      from stock where producto_id = new.id and cantidad > 0;
    if v_armadas > 0 then
      raise exception 'Hay % armadas de %: pasalas al pozo antes de cambiar lo que lleva', trim_scale(v_armadas), new.nombre;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists productos_fraccion_valida on public.productos;
create trigger productos_fraccion_valida
  before insert or update of fraccion_de, unidades_por_fraccion on public.productos
  for each row execute function public.tg_productos_fraccion_valida();

create index if not exists movimientos_stock_fraccionar_idx
  on public.movimientos_stock (sucursal_id, id desc)
  where referencia_tipo in ('fraccionamiento', 'carga_pozo');

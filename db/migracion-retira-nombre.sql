-- Quién retira, siempre a la vista del local (Leandro, 12/10/2026: «siempre que piden
-- picadas o pedidos a retirar por el local necesitamos el nombre de quien retira»).
-- Antes el «Retira: …» se anotaba solo cuando el nombre cerraba el pedido (modo 'dato');
-- ahora va en todo retiro, primero en las notas (el aviso las corta a 300 caracteres),
-- después de la nota del pago si el cliente ya transfirió.
-- El nombre lo exige el bot al armar el resumen (preparar_pedido): la base no rechaza
-- un retiro sin nombre, para que un pedido en curso al publicar no quede sin cargar.
do $do$
declare
  d text;
  viejo1 text := $v$ v_retira := case when v_modo = 'dato' and q.tipo <> 'domicilio' and coalesce(trim(q.nombre),'') <> '' then 'Retira: ' || trim(q.nombre) end;$v$;
  nuevo1 text := $n$ v_retira := case when q.tipo <> 'domicilio' and coalesce(trim(q.nombre),'') <> '' then 'Retira: ' || trim(q.nombre) end;$n$;
  viejo2 text := $v$   (case when v_modo='comprobante' then concat_ws(' · ', v_nota_pago, nullif(trim(q.notas),''))
         when v_modo='dato' and v_retira is not null then concat_ws(' · ', nullif(trim(q.notas),''), v_retira)
         else q.notas end),$v$;
  nuevo2 text := $n$   (case when v_modo='comprobante' then concat_ws(' · ', v_nota_pago, v_retira, nullif(trim(q.notas),''))
         else nullif(concat_ws(' · ', v_retira, nullif(trim(q.notas),'')), '') end),$n$;
begin
  d := pg_get_functiondef('public.confirmar_cotizacion_bot(uuid,text,text,text,text,numeric)'::regprocedure);
  if position(nuevo1 in d) > 0 and position(nuevo2 in d) > 0 then return; end if; -- ya aplicada
  if position(viejo1 in d) = 0 or position(viejo2 in d) = 0 then
    raise exception 'confirmar_cotizacion_bot cambió: no encuentro las líneas de «Retira»';
  end if;
  execute replace(replace(d, viejo1, nuevo1), viejo2, nuevo2);
end $do$;

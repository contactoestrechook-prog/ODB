-- PERMISOS POR PERSONA, ADEMÁS DEL ROL (25/11/2026). Leandro, con las dos pantallas
-- de una factura de Bodegas Esmeralda: «esto es lo que ve Juampi desde su usuario y
-- necesito que Ana vea lo mismo», «podemos hacerlo solo con Anabella» y «solamente
-- con respecto a las imágenes que te pasé, claramente no todo».
--
-- usuarios.permisos: lo que una persona puede además de lo de su rol. El primero es
-- `pagar_anular_facturas`: registrar pagos y anular facturas de compra directo, como
-- gerencia y los dueños (ver apps/api/src/compras/pagar-anular-facturas.ts). Lo
-- tiene solo Anabella; Romina, del mismo rol, no.
--
-- Solo agrega una columna: la API de antes la ignora. APLICADA por MCP en
-- utemmsmuwocerhmuxrbs (permiso_facturas_directo, que primero le dio
-- `facturas_directo`, y permiso_pagar_anular_facturas, que lo cambió por este).
alter table public.usuarios add column if not exists permisos text[] not null default '{}';

update public.usuarios
   set permisos = array(select distinct unnest(array_remove(permisos, 'facturas_directo') || array['pagar_anular_facturas']))
 where id = '83528aad-ccbd-4aea-bec4-f8a001e3829c' and nombre = 'Anabella';

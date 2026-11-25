-- PERMISOS POR PERSONA, ADEMÁS DEL ROL (25/11/2026). Leandro, con las dos pantallas
-- de una factura de Bodegas Esmeralda: «esto es lo que ve Juampi desde su usuario y
-- necesito que Ana vea lo mismo», y «el dueño me está pidiendo ese cambio, así que
-- podemos hacerlo solo con Anabella».
--
-- usuarios.permisos: lo que una persona puede además de lo de su rol. El primero es
-- `facturas_directo`: registrar pagos, anular y corregir facturas de compra directo,
-- como gerencia y los dueños (ver apps/api/src/compras/facturas-directo.ts). Lo
-- tiene solo Anabella; Romina, del mismo rol, no.
--
-- Solo agrega una columna: la API de antes la ignora. APLICADA por MCP en
-- utemmsmuwocerhmuxrbs (permiso_facturas_directo).
alter table public.usuarios add column if not exists permisos text[] not null default '{}';

update public.usuarios
   set permisos = array(select distinct unnest(permisos || array['facturas_directo']))
 where id = '83528aad-ccbd-4aea-bec4-f8a001e3829c' and nombre = 'Anabella';

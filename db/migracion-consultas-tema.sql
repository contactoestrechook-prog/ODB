-- EL TEMA DE CADA CONSULTA INTERNA (5/10/2026, charla de Pablo: vinos a España).
--
-- El bot le avisaba al cliente «Ya te confirmo por acá.» sin decir qué, una vez
-- por mensaje y no por consulta: salió pegado abajo de «¿Está completo el
-- pedido…?» y después SOLO, como respuesta a un audio con nombre y retiro. Y la
-- misma pregunta de la caja se consultó dos veces (16:02 y 16:17), con dos
-- WhatsApp a administración.
--
-- Ahora la herramienta consultar_interno trae el tema ("la caja para viajar",
-- "el PerSe Inseparable"): se reconoce la misma consulta cuando vuelve con otras
-- palabras (se le suma el dato, sin otro WhatsApp) y el modelo ve en el estado de
-- la charla qué quedó abierto.
--
-- 6/10/2026 (CONSULTA SILENCIOSA, regla de Leandro): al cliente ya no se le avisa
-- nada de la consulta, así que el tema es de USO INTERNO. Lo único que le llega
-- es la respuesta del área, encabezada por el tema cuando no lo nombra («Sobre la
-- caja para viajar: sí, vienen en estuche individual.»).
--
-- Aditiva y sin datos que migrar: las consultas viejas quedan sin tema y el bot
-- las nombra por su texto. El código ya tolera que la columna todavía no exista
-- (lee y registra sin ella), así que se puede aplicar antes o después del deploy.
alter table public.bot_consultas_internas add column if not exists tema text;

comment on column public.bot_consultas_internas.tema is
  'De qué se trata la consulta, 2 a 6 palabras con artículo (la caja para viajar). Uso interno: junta la misma consulta repetida y encabeza la respuesta del área al cliente («Sobre <tema>: …»); al cliente no se le avisa la consulta (consulta silenciosa, 6/10/2026). Nunca lleva nada interno (stock, unidades, sucursal, el local, compras). 5/10/2026.';

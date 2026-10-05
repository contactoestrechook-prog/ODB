-- EL TEMA DE CADA CONSULTA INTERNA (5/10/2026, charla de Pablo: vinos a España).
--
-- El bot le avisaba al cliente «Ya te confirmo por acá.» sin decir qué, una vez
-- por mensaje y no por consulta: salió pegado abajo de «¿Está completo el
-- pedido…?» y después SOLO, como respuesta a un audio con nombre y retiro. Y la
-- misma pregunta de la caja se consultó dos veces (16:02 y 16:17), con dos
-- WhatsApp a administración.
--
-- Ahora la herramienta consultar_interno trae el tema PARA EL CLIENTE ("la caja
-- para viajar", "el PerSe Inseparable"): con él se arma el aviso «Lo de la caja
-- para viajar te lo confirmo por acá.», se reconoce la misma consulta cuando
-- vuelve con otras palabras (se le suma el dato, sin otro WhatsApp) y el modelo
-- ve en el estado de la charla qué quedó abierto.
--
-- Aditiva y sin datos que migrar: las consultas viejas quedan sin tema y el bot
-- las nombra por su texto. El código ya tolera que la columna todavía no exista
-- (lee y registra sin ella), así que se puede aplicar antes o después del deploy.
alter table public.bot_consultas_internas add column if not exists tema text;

comment on column public.bot_consultas_internas.tema is
  'De qué se trata la consulta para el cliente, 2 a 6 palabras con artículo (la caja para viajar). Arma el aviso «Lo de <tema> te lo confirmo por acá.» y junta la misma consulta repetida. Nunca lleva nada interno (stock, unidades, sucursal, el local, compras). 5/10/2026.';

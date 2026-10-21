-- LA CONSULTA SIN RESPUESTA PASA SOLA A UNA PERSONA (Leandro, 21/10/2026: «si»).
-- SIN APLICAR: probada con begin/rollback en producción el 21/10/2026.
--
-- La consulta silenciosa (6/10/2026): lo que el bot no sabe se le pregunta a
-- administración y al cliente no se le dice nada. Del 15 al 21/10 administración
-- contestó 2 de 94 consultas y los clientes quedaban esperando algo que no llegaba.
-- Ahora el vigía de consultas (seguirConsultasPendientes, cada 5 min) hace que una
-- consulta que lleva 30 minutos de horario de atención sin respuesta del área (y sin
-- que nadie de la casa le haya escrito al cliente) pase sola a una persona: al cliente
-- le llega UNA vez «Te paso con una persona del local.», el bot queda en pausa en esa
-- charla y al local le llega la campanita y un WhatsApp a administración.
--
-- Las dos marcas hacen que eso pase UNA sola vez aunque corran dos procesos o se
-- reinicie el servidor: se toman con un update condicionado (... is null) antes de
-- mandar el WhatsApp, y si el WhatsApp no sale se vuelven a poner en null para que el
-- vigía lo reintente.
--
-- Aditiva y sin datos que migrar. Mientras no esté aplicada, el servidor no se rompe:
-- el update de la marca falla, queda un aviso en el log y ninguna consulta vence (todo
-- sigue como antes). Se puede aplicar antes o después del deploy. Las consultas viejas
-- no vencen al aplicarla: pasadas las 2 horas de horario ya no se le escribe al cliente.
alter table public.bot_consultas_internas add column if not exists vencida_en timestamptz;
alter table public.bot_consultas_internas add column if not exists vencida_aviso_en timestamptz;

comment on column public.bot_consultas_internas.vencida_en is
  'Cuándo la consulta pasó sola a una persona por no tener respuesta del área en 30 min de horario: al cliente le llegó «Te paso con una persona del local.» y la charla quedó derivada. Marca de una sola vez (update condicionado); null si el WhatsApp no salió. 21/10/2026.';
comment on column public.bot_consultas_internas.vencida_aviso_en is
  'Cuándo salió el WhatsApp a administración avisando que esa consulta pasó a una persona. Marca de una sola vez; null mientras no salga (el vigía lo reintenta hasta 6 h). 21/10/2026.';

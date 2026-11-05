-- EL CHAT DE LA FACTURA · CUÁNTO RAZONA Y SI SE TRABA (Leandro, 5/11/2026:
-- «¿estás seguro que el chat está teniendo razonamiento? vamos a medirlo a ver
-- cuánto está usando y si no está trabado»).
-- uso:   { llamadas: [{ modelo, esfuerzo, termino, segundos, entrada, cacheLeida,
--          cacheEscrita, salida, bloquesDeRazonamiento, caracteresDeRazonamiento,
--          caracteresDeRespuesta, salidaSinRespuesta, usoCrudo } | { error, estado, segundos }] }
-- error: si la charla no llegó a contestar (la llamada falló o volvió ilegible).
--        Hasta hoy esas charlas no dejaban ninguna fila.
-- Aditiva. APLICADA en producción el 5/11/2026 (migración compras_chat_uso).

alter table public.compras_chat_turnos add column if not exists uso jsonb;
alter table public.compras_chat_turnos add column if not exists error text;

-- Envío de la orden de compra al proveedor por WhatsApp (2/10/2026).
--
-- Cuando el dueño firma, la orden sale sola: un mensaje con el pedido y la nota
-- de pedido en PDF (sin precios), desde la línea de la casa. La orden pasa a
-- 'enviada' (el trigger oc_sellar_fechas guarda enviada_en, que es de donde el
-- agente de compras aprende el plazo real del proveedor).
--
-- Qué queda guardado en la orden: si salió, a qué número, el id del mensaje
-- (para reenviar o cruzar la respuesta citada) y por qué no salió si falló.

alter table ordenes_compra
  add column if not exists enviada_por uuid references usuarios(id),
  add column if not exists whatsapp_estado text,
  add column if not exists whatsapp_intentos integer not null default 0,
  add column if not exists whatsapp_intento_en timestamptz,
  add column if not exists whatsapp_error text,
  add column if not exists whatsapp_msg_id text,
  add column if not exists whatsapp_telefono text;

do $$ begin
  alter table ordenes_compra add constraint ordenes_compra_whatsapp_estado_check
    check (whatsapp_estado is null or whatsapp_estado in ('enviando', 'enviado', 'error', 'manual'));
exception when duplicate_object then null; end $$;

-- Toma el envío de una orden. La firma y el cron pueden pedirlo a la vez: solo
-- uno lo consigue, así el proveedor nunca recibe el pedido dos veces.
--   · sin intento previo → sí
--   · falló → sí si se fuerza (botón "Reenviar") o, solo, hasta 3 veces cada 10 min
--   · quedó "enviando" más de 5 min (se cortó el proceso) → sí
create or replace function oc_tomar_envio(p_oc uuid, p_forzar boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update ordenes_compra
     set whatsapp_estado = 'enviando',
         whatsapp_intento_en = now(),
         whatsapp_intentos = whatsapp_intentos + 1
   where id = p_oc
     and estado = 'aprobada'
     and (whatsapp_estado is null
          or (whatsapp_estado = 'error'
              and (p_forzar or (whatsapp_intentos < 3 and whatsapp_intento_en < now() - interval '10 minutes')))
          or (whatsapp_estado = 'enviando' and whatsapp_intento_en < now() - interval '5 minutes'));
  return found;
end $$;

revoke all on function oc_tomar_envio(uuid, boolean) from public, anon, authenticated;

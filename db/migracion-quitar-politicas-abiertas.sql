-- ============================================================
-- SE BORRAN LAS 25 REGLAS DE «CUALQUIERA PUEDE LEER» (11/11/2026)
-- Auditoría del 11/11/2026 (Leandro: «amenazas, cosas sin sentido»).
--
-- 25 tablas tenían una política de lectura para el rol «public» (todos), casi
-- todas con condición «true»: 16 se llamaban «lectura dev» (restos de cuando se
-- desarrolló: usuarios con sus claves cifradas y PIN, clientes, proveedores con
-- CBU, ventas, pagos, órdenes de compra…) y 9 «catalogo publico» / «promos
-- publicas» (de cuando la tienda iba a leer la base directo).
--
-- Hoy no abrían nada: ni anon ni authenticated tienen permiso sobre esas
-- tablas (solo postgres y service_role, y la API entra como service_role, que
-- no pasa por estas reglas). Pero lo único que las mantenía cerradas era que
-- faltaba el permiso: un GRANT dado por error las dejaba a la vista de
-- cualquiera con la clave pública. Sin la regla, aunque alguien dé el permiso,
-- la tabla sigue cerrada (queda con la protección por filas prendida y sin
-- ninguna regla que deje pasar).
--
-- Para volver atrás (no debería hacer falta):
--   create policy "lectura dev" on <tabla> for select to public using (true);
--   create policy "catalogo publico" on productos for select to public using (activo = true);
--   (listas_precios y sucursales: using (activa = true); el resto: using (true))
-- ============================================================
drop policy if exists "lectura dev" on aprobaciones;
drop policy if exists "lectura dev" on cajas;
drop policy if exists "lectura dev" on clientes;
drop policy if exists "lectura dev" on comprobantes_arca;
drop policy if exists "lectura dev" on movimientos_stock;
drop policy if exists "lectura dev" on ordenes_compra;
drop policy if exists "lectura dev" on ordenes_compra_items;
drop policy if exists "lectura dev" on pagos;
drop policy if exists "lectura dev" on proveedor_productos;
drop policy if exists "lectura dev" on proveedores;
drop policy if exists "lectura dev" on sesiones_caja;
drop policy if exists "lectura dev" on transferencias;
drop policy if exists "lectura dev" on transferencias_items;
drop policy if exists "lectura dev" on usuarios;
drop policy if exists "lectura dev" on ventas;
drop policy if exists "lectura dev" on ventas_items;
drop policy if exists "catalogo publico" on categorias;
drop policy if exists "catalogo publico" on codigos_barras;
drop policy if exists "catalogo publico" on listas_precios;
drop policy if exists "catalogo publico" on marcas;
drop policy if exists "catalogo publico" on precios;
drop policy if exists "catalogo publico" on productos;
drop policy if exists "catalogo publico" on stock;
drop policy if exists "catalogo publico" on sucursales;
drop policy if exists "promos publicas" on descuentos;

-- ============================================================
-- Y LA PROTECCIÓN POR FILAS, PRENDIDA EN TODAS (mismo día)
-- 30 tablas no la tenían. Nadie de afuera tiene permiso sobre ellas, pero un
-- GRANT dado por error las abría enteras. Prendida y sin reglas, quedan
-- cerradas aunque alguien dé el permiso. La API (service_role) y el dueño de
-- las tablas no pasan por esta protección.
-- ============================================================
alter table alertas_internas enable row level security;
alter table bot_contactos enable row level security;
alter table bot_envios enable row level security;
alter table bot_notas_equipo enable row level security;
alter table bot_respuestas_clave enable row level security;
alter table cobranzas_pendientes enable row level security;
alter table devoluciones_pendientes enable row level security;
alter table documentos enable row level security;
alter table facturas_proveedor_items enable row level security;
alter table facturas_proveedor_pagos enable row level security;
alter table fotos_calidad enable row level security;
alter table fotos_externas enable row level security;
alter table fotos_normalizadas enable row level security;
alter table lecturas_comprobante enable row level security;
alter table lineas_whatsapp enable row level security;
alter table mensajes_programados enable row level security;
alter table mp_cobros enable row level security;
alter table novedades_sistema enable row level security;
alter table novedades_vistas enable row level security;
alter table propuestas_costo enable row level security;
alter table propuestas_costo_items enable row level security;
alter table reportes_sistema enable row level security;
alter table reseteos_clave enable row level security;
alter table respaldo_costos_catalogo_20261104 enable row level security;
alter table respaldo_proveedor_productos_luvik_20261104 enable row level security;
alter table responde_difusiones enable row level security;
alter table responde_difusiones_destinatarios enable row level security;
alter table responde_listas enable row level security;
alter table responde_listas_miembros enable row level security;
alter table ventas_cambios_pago enable row level security;

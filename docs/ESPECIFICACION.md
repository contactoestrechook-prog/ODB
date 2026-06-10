# ODB — Especificación funcional

Versión 1.0 — junio 2026

## 1. Contexto del negocio

- **Rubro**: outlet de bebidas, +13.000 artículos activos.
- **Sucursales**: 2, con stock propio cada una y transferencias entre ellas.
- **Canales de venta**: mostrador (caja), e-commerce (Tienda Nube con frontend propio), WhatsApp, app de cliente con pick-up y self-checkout.
- **Origen de datos**: el catálogo actual vive en un Excel; se migra con el importador incluido en el proyecto.

## 2. Usuarios y roles

| Rol | Permisos principales |
|---|---|
| **Dueño** | Todo. Único que aprueba OC por encima del monto máximo y firma órdenes de pago grandes. |
| **Gerente de sucursal** | Ventas, stock, ajustes, cierre de caja, aprobación de OC hasta su límite. |
| **Comprador** | Crea OC, gestiona proveedores y listas de precios, recibe sugerencias de reposición. |
| **Cajero** | POS: vender, cobrar, pedir DNI, facturar. No puede anular ventas sin autorización. |
| **Repositor/Depósito** | Recepción de mercadería (remitos), inventario cíclico, mermas, transferencias, preparación de pedidos pick-up. |
| **Cliente registrado** | Compra online, pick-up, self-checkout (requiere verificación biométrica). |

Toda acción sensible (ajuste de stock, anulación, cambio de precio, aprobación) queda en la tabla de auditoría con usuario, fecha y datos previos/posteriores.

## 3. Módulo catálogo y stock

### 3.1 Productos
- SKU interno + múltiples códigos de barras por producto (botella, pack x6, pack x12).
- Atributos: marca, categoría (árbol), volumen, graduación alcohólica, bandera **es_alcohol** (bloquea venta a menores en todos los canales).
- Sincronización con Tienda Nube: el sistema es la **fuente de verdad**; alta/baja/precio/stock se empujan por API.

### 3.2 Stock multi-sucursal
- Stock por producto **por sucursal**, con stock mínimo y punto de reposición propios (la rotación difiere entre sucursales).
- Todo cambio de stock pasa por `movimientos_stock` (venta, compra, ajuste, transferencia, merma, devolución): nunca se edita la cantidad a mano.
- **Transferencias entre sucursales** con remito interno y confirmación de recepción.
- **Mermas** con motivo (rotura, vencimiento, robo, diferencia de inventario) y responsable.
- **Lotes y vencimientos** para productos perecederos, con alertas configurables (ej. 60 días antes).
- **Inventario cíclico**: conteo por góndola desde el celular escaneando; genera ajustes con doble confirmación.

### 3.3 Precios y promociones
- Listas múltiples: minorista, mayorista, y por sucursal si hiciera falta.
- Historial completo de precios (quién, cuándo, cuánto).
- Promos: 3x2, segunda unidad al X%, combos, descuento por categoría de cliente.
- **Impresión de etiquetas de góndola** ante cambios de precio (cola de etiquetas pendientes por sucursal).

### 3.4 Actualización de listas de precios por PDF/Excel (IA)
- El comprador sube el archivo del proveedor (PDF o Excel, cualquier formato).
- Claude API lo parsea y propone el match contra `proveedor_productos` (por código de proveedor, código de barras o nombre).
- Pantalla de revisión: diferencias de precio resaltadas, productos no matcheados para resolver a mano, y aplicación en un click.
- Nada impacta precios de venta automáticamente: actualiza **costos**; los precios de venta se recalculan según regla de margen por categoría con aprobación.

## 4. Módulo compras y proveedores

### 4.1 Proveedores
- Ficha completa: CUIT, condiciones de pago, plazo de entrega (lead time), contactos.
- Catálogo por proveedor (`proveedor_productos`): código del proveedor, último costo, historial de costos → detección de aumentos.
- Ranking de proveedores: cumplimiento de entregas, evolución de precios.

### 4.2 Órdenes de compra con aprobaciones y firmas
- Estados: borrador → pendiente de aprobación → aprobada → enviada → recibida (parcial/total) → cerrada/cancelada.
- **Matriz de aprobación por monto**: hasta $X aprueba el gerente, por encima el dueño. Cada aprobación registra usuario, fecha, hash del documento aprobado y firma (PIN o biometría del aprobador).
- La OC aprobada se envía al proveedor por mail/WhatsApp en PDF.

### 4.3 Recepción de mercadería por remito (IA)
- El depósito fotografía o sube el PDF del remito.
- Claude API extrae los renglones y los cruza contra la OC pendiente del proveedor.
- Pantalla de control: diferencias entre lo pedido y lo recibido resaltadas (faltantes, sobrantes, productos no pedidos).
- Al confirmar: ingresa stock en la sucursal receptora, actualiza estado de la OC y deja la factura del proveedor pendiente de carga.

### 4.4 Órdenes de pago
- Vinculan una o más facturas de proveedor; estados con aprobación según monto (misma matriz que OC).
- Medios: transferencia, cheque, efectivo. Exportación para el contador.

### 4.5 Sugerencias de compra
- Algoritmo por producto y sucursal: velocidad de venta (últimos 30/60/90 días, ponderada por estacionalidad) + stock actual + stock en tránsito + lead time del proveedor + stock mínimo.
- Genera un borrador de OC por proveedor que el comprador ajusta y manda a aprobar.
- Alertas de quiebre inminente (días de stock restantes < lead time).

## 5. Módulo ventas

### 5.1 POS / Caja
- **Offline-first**: la caja opera sin internet (catálogo y precios replicados localmente); sincroniza ventas y facturación al reconectar. La facturación ARCA en contingencia usa CAEA o queda en cola.
- Venta por escaneo, búsqueda por nombre, precio rápido.
- Medios de pago combinables: efectivo, Mercado Pago (QR/Point), tarjeta, cuenta corriente.
- **DNI en caja**: el cajero pide DNI (opcional para el cliente, incentivado con descuentos/puntos). Crea o matchea el cliente y acumula su historial.
- Apertura/cierre de caja con arqueo, retiros parciales, diferencias registradas.
- Devoluciones con nota de crédito ARCA y reingreso de stock (o merma si corresponde).

### 5.2 Facturación ARCA
- Factura A/B/C y notas de crédito vía web services (a través de SDK tipo afipsdk o TusFacturas).
- Numeración por punto de venta por sucursal.
- Libro IVA ventas/compras exportable para el contador.

### 5.3 Clasificación de clientes (RFM)
- A partir de la **3ª compra**, un job nocturno clasifica por Recencia/Frecuencia/Monto: `ocasional`, `frecuente`, `mayorista`, `vip`.
- La clasificación habilita beneficios: lista mayorista, descuentos, cuenta corriente (con límite de crédito y aprobación del dueño).
- Visible en caja al ingresar el DNI: "Cliente frecuente — 12 compras, ticket promedio $X".

## 6. Canal cliente

### 6.1 E-commerce (Tienda Nube + frontend propio)
- Tienda Nube como plataforma (checkout, pagos, cumplimiento); frontend propio (theme custom o headless según necesidad de diseño).
- Sincronización bidireccional: productos/precios/stock salen del sistema; pedidos entran por webhook y reservan stock de la sucursal asignada.

### 6.2 App de cliente (Expo)
- Registro con **verificación biométrica Didit**: DNI + selfie con prueba de vida, validación contra RENAPER (~15 seg). Verifica identidad **y mayoría de edad** (obligatoria para alcohol). Costo: gratis hasta 500/mes, luego ~USD 0,30.
- ODB guarda solo el resultado de la verificación (no los datos biométricos) + consentimiento explícito (Ley 25.326).
- Catálogo, carrito, pago con Mercado Pago, historial, puntos.

### 6.3 Pick-up con geolocalización
- El cliente arma el pedido y elige sucursal; paga con MP.
- Al iniciar viaje comparte ubicación: cuando el ETA baja del umbral configurado (ej. 10 min), el pedido pasa a **"preparar ahora"** en la pantalla del depósito.
- Estados visibles para el cliente: recibido → preparando → listo para retirar. Notificación push al estar listo.
- Retiro validando QR del pedido en mostrador.

### 6.4 Self-checkout en local
- Solo clientes verificados biométricamente (control de edad ya resuelto).
- Escanea productos con el celular, paga con Mercado Pago en la app.
- **Control de salida**: QR de compra que un empleado o tótem escanea; el sistema marca la compra como retirada (anti-hurto).

### 6.5 WhatsApp Business
- Catálogo y carrito nativo de WhatsApp o flujo conversacional; el pedido entra al mismo pipeline que pick-up.
- Notificaciones transaccionales: pedido listo, OC enviada a proveedor, promos segmentadas por tipo de cliente (con opt-in).

## 7. Módulo financiero y motor de promociones

### 7.1 Motor de descuentos (nivel supermercado)
- **Alcances**: toda la tienda, una categoría, una marca o un producto puntual.
- **Tipos**: porcentaje, monto fijo o precio fijo ("a $1.990").
- **Vigencia obligatoria**: fecha/hora de inicio y de cierre; los descuentos se programan con anticipación y se apagan solos. Estados: programado → vigente → vencido.
- **Condiciones opcionales**: solo para un segmento de cliente (vip, mayorista…), solo con un medio de pago (estilo "15 % pagando con Mercado Pago los miércoles"), combinable o no con otros descuentos.
- **Regla de aplicación**: si hay varios descuentos no combinables sobre el mismo producto, gana el de mayor beneficio para el cliente (regla estándar de retail).
- El precio final **siempre se recalcula en el momento de la venta** (caja, app, web): nunca se confía en un precio calculado antes.
- Cupones de descuento de un solo uso y campañas por segmento (se apoyan en la clasificación RFM).

### 7.2 Finanzas
- **Tesorería**: cajas por sucursal, arqueos, retiros y depósitos bancarios.
- **Cuentas a pagar**: facturas de proveedor, vencimientos, órdenes de pago (ya en módulo compras).
- **Cuentas a cobrar**: cuenta corriente de clientes mayoristas, límites, antigüedad de saldos.
- **Conciliación de tarjetas y Mercado Pago**: liquidaciones, comisiones, retenciones; control de que lo cobrado por MP/tarjetas coincida con lo acreditado.
- **Impuestos**: IVA compras/ventas (libro IVA), IIBB, percepciones y retenciones; exportación para el contador.
- **Rentabilidad**: margen real por producto/categoría/sucursal considerando descuentos aplicados y costos actualizados (category management, como Jumbo/Carrefour).
- **Flujo de caja proyectado**: vencimientos a pagar vs. cobros esperados.

## 8. Estadísticas y reportes

- Ranking de mejores/peores productos por unidades, facturación y **margen** (por sucursal y consolidado).
- Rotación de inventario, días de stock, productos muertos (sin ventas en N días) → candidatos a liquidación.
- Quiebres de stock y ventas perdidas estimadas.
- Comparativa de proveedores y evolución de costos.
- Estacionalidad: curvas por categoría (verano, fiestas) alimentan las sugerencias de compra.
- Dashboard de ventas en vivo por sucursal para el dueño.

## 9. Requisitos no funcionales

- **Disponibilidad de caja**: el POS nunca depende de internet para vender.
- **Auditoría total**: toda mutación sensible registrada (quién, qué, cuándo, antes/después).
- **Backups** automáticos diarios con prueba de restauración periódica.
- **Datos personales**: consentimiento explícito, biometría delegada al proveedor, derecho de acceso/supresión (Ley 25.326).
- **Rendimiento**: búsqueda de productos < 200 ms con 13.000+ artículos (índices + búsqueda por trigramas).

## 10. Fuera de alcance (por ahora)

- Envíos a domicilio con logística propia (Tienda Nube lo cubre con sus integraciones de envío).
- Multi-empresa / franquicias.
- Producción/fraccionamiento de productos.

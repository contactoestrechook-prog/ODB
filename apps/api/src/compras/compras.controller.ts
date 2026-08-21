import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MesaComprasService } from './mesa-compras.service';
import { ComprasService } from './compras.service';
import type { AprobarDto, CrearOcDto, EntradaDirectaDto, RecibirDto } from './compras.service';
import { ListasService } from '../listas/listas.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ComprasController {
  constructor(
    private readonly compras: ComprasService,
    private readonly listas: ListasService, private readonly mesa: MesaComprasService) {}

  // Pedido exportado del portal del proveedor (Excel/CSV/PDF): lo lee, matchea
  // contra el catálogo y devuelve los renglones listos para precargar la OC.
  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/ordenes/importar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 15 * 1024 * 1024 } }))
  importarPedido(
    @UploadedFile() archivo: Express.Multer.File,
    @Body('proveedorId') proveedorId: string,
  ) {
    if (!archivo) throw new BadRequestException('Subí el pedido exportado del proveedor (máx. 15MB)');
    return this.listas.analizarPedido(archivo, proveedorId);
  }

  // FOTO de la factura/remito que llegó con la mercadería: la IA extrae
  // proveedor, renglones e impuestos y devuelve la propuesta para revisar.
  // La confirmación va por /compras/entrada-directa (con factura incluida).
  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/entrada-foto')
  @UseInterceptors(
    FileInterceptor('archivo', {
      // 32 MB: cubre un PDF de varias hojas y cualquier foto de celular sin achicar.
      // (Las fotos igual llegan ya comprimidas desde el navegador.)
      limits: { fileSize: 32 * 1024 * 1024 },
      // Aceptamos foto (JPG/PNG/WEBP/HEIC…) o PDF. Antes solo dejaba pasar imágenes
      // y descartaba los PDF en silencio.
      fileFilter: (_req, archivo, cb) =>
        cb(null, /^image\//.test(archivo.mimetype) || archivo.mimetype === 'application/pdf' || /\.pdf$/i.test(archivo.originalname ?? '')),
    }),
  )
  entradaFoto(@UploadedFile() archivo: Express.Multer.File, @Body('aclaraciones') aclaraciones?: string) {
    if (!archivo) throw new BadRequestException('Subí una foto o el PDF de la factura/remito (máx. 32MB)');
    return this.listas.analizarComprobanteFoto(archivo, aclaraciones);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Get('proveedores')
  proveedores() {
    return this.compras.proveedores();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('proveedores')
  crearProveedor(@Body() dto: any) {
    return this.compras.crearProveedor(dto);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Patch('proveedores/:id')
  editarProveedor(@Param('id') id: string, @Body() dto: any) {
    return this.compras.editarProveedor(id, dto);
  }

  // remarcación aprendida por producto (y la sugerida del rubro como respaldo)
  @Roles('comprador', 'deposito', 'gerente', 'dueno')
  @Get('compras/remarcacion')
  remarcacion(@Query('proveedorId') proveedorId: string, @Query('skus') skus: string) {
    return this.compras.remarcacionDe(proveedorId, String(skus ?? '').split(',').filter(Boolean));
  }

  // detalle de UNA orden, con sus remitos y sus facturas (backoffice entra por
  // 'comprador', que su rol implica)
  @Roles('comprador', 'deposito', 'gerente', 'dueno')
  @Get('compras/ordenes/:id')
  ordenDetalle(@Param('id') id: string) {
    return this.compras.ordenDetalle(id);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/resumen')
  resumen() {
    return this.compras.resumen();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/sugerencias')
  sugerencias() {
    return this.compras.sugerencias();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/deuda')
  deuda() {
    return this.compras.deudaProveedores();
  }

  // ---- Mesa de compras: costeo asistido + aprobación del dueño ----

  // El comprador charla con el analista (texto, dictado o foto de la lista)
  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/mesa/charla')
  mesaCharla(@Body() b: { mensajes: any[] }, @Req() req: any) {
    return this.mesa.charlar(b.mensajes ?? [], req.usuario?.sub);
  }

  // Bandeja del dueño: lo que espera su visto bueno
  @Roles('gerente', 'dueno')
  @Get('compras/propuestas')
  propuestas() {
    return this.mesa.pendientes();
  }

  // Aplicar cuesta plata: solo el dueño, y queda auditado
  @Roles('dueno')
  @Post('compras/propuestas/:id/aprobar')
  aprobarPropuesta(@Param('id') id: string, @Req() req: any) {
    return this.mesa.aprobar(id, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/propuestas/:id/rechazar')
  rechazarPropuesta(@Param('id') id: string, @Body() b: { motivo?: string }, @Req() req: any) {
    return this.mesa.rechazar(id, b.motivo ?? '', req.usuario?.sub);
  }

  // Recepción con pistola: el depósito escanea lo que baja del camión
  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/recepcion')
  recepcionPistola(@Body() dto: any, @Req() req: any) {
    return this.compras.recepcionPistola({ ...dto, usuarioId: dto.usuarioId ?? req.usuario?.sub });
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Get('compras/recepcion/codigo/:codigo')
  productoPorCodigo(@Param('codigo') codigo: string) {
    return this.compras.productoPorCodigo(codigo);
  }

  // Vincular un código desconocido a un producto sin salir de la recepción
  @Roles('deposito', 'cajero', 'comprador', 'gerente', 'dueno')
  @Post('compras/recepcion/codigo')
  vincularCodigo(@Body() dto: any, @Req() req: any) {
    return this.compras.vincularCodigo({ ...dto, usuarioId: req.usuario?.sub });
  }

  // Conciliación remito↔factura (administración)
  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/conciliacion')
  bandejaConciliacion() {
    return this.compras.bandejaConciliacion();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/conciliacion/cruce')
  cruce(@Query('facturaId') facturaId: string, @Query('remitos') remitos: string) {
    return this.compras.cruceRemitosFactura(facturaId, String(remitos ?? '').split(',').filter(Boolean));
  }

  @Roles('gerente', 'dueno')
  @Post('compras/conciliacion/confirmar')
  confirmarConciliacion(@Body() dto: any, @Req() req: any) {
    return this.compras.confirmarConciliacion(dto.facturaId, dto.remitoIds ?? [], req.usuario?.sub);
  }

  // Back office de facturas: listado con filtros + tablero de vencimientos
  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/facturas')
  listarFacturas(@Query() q: any) {
    return this.compras.listarFacturas(q);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/facturas/resumen')
  resumenFacturas() {
    return this.compras.resumenFacturas();
  }

  // (antes de ':id': si no, 'cambios' se toma como un id de factura)
  @Roles('gerente', 'dueno', 'comprador', 'deposito')
  @Get('compras/facturas/cambios')
  listarCambiosFactura(@Query() q: any) {
    return this.compras.listarCambiosFactura(q);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/facturas/:id')
  facturaDetalle(@Param('id') id: string) {
    return this.compras.facturaDetalle(id);
  }

  // Solicitudes de cambio: las pide quien carga (backoffice/comprador/depósito),
  // las ve gerencia, las aprueba un dueño. Van ANTES de ':id' para que la ruta
  // 'compras/facturas/cambios' no se tome como un id.
  @Roles('dueno')
  @Post('compras/facturas/cambios/:id/aprobar')
  aprobarCambioFactura(@Param('id') id: string, @Body() b: { respuesta?: string }, @Req() req: any) {
    return this.compras.resolverCambioFactura(id, 'aprobar', b?.respuesta, req.usuario?.sub);
  }

  @Roles('dueno')
  @Post('compras/facturas/cambios/:id/rechazar')
  rechazarCambioFactura(@Param('id') id: string, @Body() b: { respuesta?: string }, @Req() req: any) {
    return this.compras.resolverCambioFactura(id, 'rechazar', b?.respuesta, req.usuario?.sub);
  }

  @Roles('comprador', 'deposito', 'gerente', 'dueno')
  @Post('compras/facturas/:id/solicitar-cambio')
  solicitarCambioFactura(@Param('id') id: string, @Body() b: any, @Req() req: any) {
    return this.compras.solicitarCambioFactura(id, b ?? {}, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Patch('compras/facturas/:id')
  editarFactura(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.compras.editarFactura(id, dto, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/facturas/:id/anular')
  anularFactura(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.compras.anularFactura(id, dto?.motivo ?? '', req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/facturas/:id/pagos')
  pagoFactura(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.compras.pagoFactura(id, dto, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/ordenes-pago')
  ordenesPago() {
    return this.compras.ordenesPago();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/facturas')
  registrarFactura(@Body() dto: any, @Req() req: any) {
    return this.compras.registrarFactura(dto, req.usuario?.sub);
  }

  // Órdenes de pago: crear (queda pendiente) → aprobar (dueño) → pagar
  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/ordenes-pago')
  crearOP(@Body() dto: any) {
    return this.compras.crearOrdenPago(dto);
  }

  @Roles('dueno')
  @Post('compras/ordenes-pago/:id/aprobar')
  aprobarOP(@Param('id') id: string, @Body() dto: any) {
    return this.compras.aprobarOrdenPago(id, dto);
  }

  @Roles('dueno')
  @Post('compras/ordenes-pago/:id/rechazar')
  rechazarOP(@Param('id') id: string, @Body() dto: any) {
    return this.compras.rechazarOrdenPago(id, dto);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/ordenes-pago/:id/pagar')
  pagarOP(@Param('id') id: string, @Body() dto: any) {
    return this.compras.pagarOrdenPago(id, dto);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Get('compras/ordenes')
  ordenes() {
    return this.compras.ordenes();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/ordenes')
  crear(@Body() dto: CrearOcDto) {
    return this.compras.crear(dto);
  }

  @Roles('dueno')
  @Post('compras/ordenes/:id/aprobar')
  aprobar(@Param('id') id: string, @Body() dto: AprobarDto) {
    return this.compras.aprobar(id, dto);
  }

  @Roles('dueno')
  @Post('compras/ordenes/:id/rechazar')
  rechazar(@Param('id') id: string, @Body() dto: any) {
    return this.compras.rechazar(id, dto);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('compras/ordenes/:id/recibir')
  recibir(@Param('id') id: string, @Body() dto: RecibirDto) {
    return this.compras.recibir(id, dto);
  }

  // Llegó mercadería sin OC previa (compra directa / remito del reparto):
  // se registra igual, con OC retroactiva trazable y regla de oro.
  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/entrada-directa')
  entradaDirecta(@Body() dto: EntradaDirectaDto, @Req() req: any) {
    return this.compras.entradaDirecta({ ...dto, usuarioId: dto.usuarioId ?? req.usuario?.sub });
  }
}

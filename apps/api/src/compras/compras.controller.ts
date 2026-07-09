import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ComprasService } from './compras.service';
import type { AprobarDto, CrearOcDto, EntradaDirectaDto, RecibirDto } from './compras.service';
import { ListasService } from '../listas/listas.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ComprasController {
  constructor(
    private readonly compras: ComprasService,
    private readonly listas: ListasService,
  ) {}

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
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, archivo, cb) => cb(null, /^image\//.test(archivo.mimetype)),
    }),
  )
  entradaFoto(@UploadedFile() archivo: Express.Multer.File) {
    if (!archivo) throw new BadRequestException('Subí una foto de la factura/remito (máx. 8MB)');
    return this.listas.analizarComprobanteFoto(archivo);
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

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/ordenes-pago')
  ordenesPago() {
    return this.compras.ordenesPago();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/facturas')
  registrarFactura(@Body() dto: any) {
    return this.compras.registrarFactura(dto);
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

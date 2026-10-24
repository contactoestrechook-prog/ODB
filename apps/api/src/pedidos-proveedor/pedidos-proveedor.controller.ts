import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { PedidosProveedorService } from './pedidos-proveedor.service';

// El pedido al proveedor por WhatsApp: reenviar, mandarlo a mano o marcarlo
// enviado (ver pedidos-proveedor.service.ts). El envío normal sale solo al firmar.
@Controller('pedidos-proveedor')
export class PedidosProveedorController {
  constructor(private readonly pedidos: PedidosProveedorService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Post('ordenes/:id/enviar')
  enviar(@Param('id') id: string, @Body() b: { forzar?: boolean }, @Req() req: any) {
    return this.pedidos.enviar(id, { usuarioId: req.usuario?.sub ?? null, forzar: b?.forzar !== false });
  }

  // La nota de pedido sin precios (la que recibe el proveedor), para bajarla
  @Roles('comprador', 'gerente', 'dueno')
  @Get('ordenes/:id/nota')
  async nota(@Param('id') id: string, @Req() req: any, @Res() res: any) {
    const { folio, pdf } = await this.pedidos.notaPDF(id, req.usuario?.sub ?? null);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="nota-de-pedido-${folio}.pdf"` });
    res.send(pdf);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('ordenes/:id/whatsapp')
  aMano(@Param('id') id: string) {
    return this.pedidos.paraMandarAMano(id);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('ordenes/:id/enviada-a-mano')
  enviadaAMano(@Param('id') id: string, @Req() req: any) {
    return this.pedidos.marcarEnviadaAMano(id, req.usuario?.sub ?? null);
  }

  // ---- 23/10/2026: la fecha de entrega y la mercadería por llegar ----

  @Roles('comprador', 'deposito', 'administrativo', 'gerente', 'dueno')
  @Get('por-llegar')
  porLlegar(@Query('sucursalId') sucursalId?: string) {
    return this.pedidos.porLlegar(sucursalId || undefined);
  }

  // la fecha la anota una persona (el proveedor llamó, o la respuesta quedó a revisar)
  @Roles('comprador', 'administrativo', 'gerente', 'dueno')
  @Post('ordenes/:id/entrega')
  fijarEntrega(@Param('id') id: string, @Body() b: { fecha?: string; horario?: string }, @Req() req: any) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.fecha ?? ''))) throw new BadRequestException('Elegí la fecha de entrega');
    return this.pedidos.fijarEntrega(id, String(b.fecha), b?.horario ?? null, req.usuario?.sub ?? null);
  }

  @Roles('comprador', 'administrativo', 'gerente', 'dueno')
  @Get('proveedores-sin-whatsapp')
  sinWhatsapp() {
    return this.pedidos.proveedoresSinWhatsapp();
  }

  @Roles('comprador', 'administrativo', 'gerente', 'dueno')
  @Post('proveedores/:id/whatsapp')
  cargarWhatsapp(@Param('id') id: string, @Body() b: { telefono?: string }, @Req() req: any) {
    return this.pedidos.cargarWhatsapp(id, String(b?.telefono ?? ''), req.usuario?.sub ?? null);
  }
}

import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
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
}

import { Body, Controller, Get, Post } from '@nestjs/common';
import { TiendanubeService } from './tiendanube.service';
import { Roles, Publico } from '../auth/decorators';

@Controller('tiendanube')
export class TiendanubeController {
  constructor(private readonly servicio: TiendanubeService) {}

  @Roles('gerente', 'dueno')
  @Get('estado')
  estado() {
    return this.servicio.estado();
  }

  @Roles('gerente', 'dueno')
  @Post('sync-catalogo')
  syncCatalogo(@Body() dto: { limite?: number }) {
    return this.servicio.syncCatalogo(dto ?? {});
  }

  @Roles('gerente', 'dueno')
  @Post('importar-pedidos')
  importar() {
    return this.servicio.importarPedidos();
  }

  // Tienda Nube llama acá cuando entra un pedido. Es público pero re-consulta
  // el pedido a TN con nuestro token (no confía en el body).
  @Publico()
  @Post('webhook')
  webhook(@Body() body: any) {
    return this.servicio.recibirWebhook(body);
  }
}

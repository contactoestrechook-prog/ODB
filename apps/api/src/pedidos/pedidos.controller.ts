import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import type { PedidoYaPayload } from './pedidos.service';
import { Publico, Roles } from '../auth/decorators';

@Controller()
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  // Webhook real de PedidosYa: configurar la URL pública + token en el portal de partners.
  // Hasta tener las credenciales, el simulador genera pedidos idénticos.
  @Publico()
  @Post('pedidosya/webhook')
  webhook(@Body() payload: PedidoYaPayload, @Query('token') token?: string) {
    const esperado = process.env.PEDIDOSYA_WEBHOOK_TOKEN;
    if (esperado && token !== esperado) {
      throw new UnauthorizedException('Token de webhook inválido');
    }
    return this.pedidos.recibirDePedidosYa(payload);
  }

  @Roles('gerente', 'dueno')
  @Post('pedidosya/simular')
  simular() {
    const ejemplos: PedidoYaPayload[] = [
      {
        orderId: Math.floor(100000 + Math.random() * 900000),
        customer: { name: 'Cliente PedidosYa' },
        items: [
          { sku: 'CER-0001', name: 'Cerveza Quilmes lata 473', quantity: 6 },
          { name: 'fernet branca 750', quantity: 1 },
          { name: 'picada aceitunas verdes', quantity: 1 },
        ],
        notes: 'Tocar timbre depto 3B',
      },
      {
        orderId: Math.floor(100000 + Math.random() * 900000),
        customer: { name: 'Cliente PedidosYa' },
        items: [
          { name: 'coca cola original 2.25', quantity: 2 },
          { name: 'jamon crudo feteado', quantity: 1 },
          { name: 'queso brie', quantity: 1 },
          { sku: 'VIN-0005', name: 'Zuccardi Serie A Malbec', quantity: 1 },
        ],
      },
    ];
    return this.pedidos.recibirDePedidosYa(ejemplos[Math.floor(Math.random() * ejemplos.length)]);
  }

  @Get('pedidos')
  cola() {
    return this.pedidos.cola();
  }

  // --- Endpoints públicos para la app del cliente ---
  // TODO(produccion): rate limit + auth de cliente (hoy el id del pedido es la credencial)
  @Publico()
  @Post('app/pedidos')
  crearDesdeApp(@Body() body: { sucursalId: string; items: { sku: string; cantidad: number }[]; dni?: string }) {
    return this.pedidos.crearDesdeApp(body);
  }

  @Publico()
  @Get('app/pedidos/:id')
  obtener(@Param('id') id: string) {
    return this.pedidos.obtener(id);
  }

  @Publico()
  @Get('app/perfil/:dni')
  perfil(@Param('dni') dni: string) {
    return this.pedidos.perfil(dni);
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Post('pedidos/:id/avanzar')
  avanzar(@Param('id') id: string, @Body() body: { estado: string }, @Req() req: any) {
    return this.pedidos.avanzar(id, body.estado, req.usuario?.sub);
  }
}

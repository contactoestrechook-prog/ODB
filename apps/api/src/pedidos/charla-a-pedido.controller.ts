import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { CharlaAPedidoService } from './charla-a-pedido.service';

// Pedidos › Charlas de WhatsApp › «Pasar a pedido» (14/11/2026). Los mismos que
// atienden pedidos (administración entra por depósito).
@Controller('pedidos/charlas')
export class CharlaAPedidoController {
  constructor(private readonly charlas: CharlaAPedidoService) {}

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Get()
  lista() {
    return this.charlas.charlas();
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Post('armar')
  armar(@Body() b: { linea: string; telefono: string }) {
    return this.charlas.armar(String(b?.linea ?? ''), String(b?.telefono ?? ''));
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Post('crear')
  crear(@Body() b: any, @Req() req: any) {
    return this.charlas.crear(b, { sub: req.usuario?.sub, nombre: req.usuario?.nombre });
  }
}

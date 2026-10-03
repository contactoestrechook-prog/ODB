import { Controller, Get } from '@nestjs/common';
import { AvisosPedidosService } from './avisos-pedidos.service';

// El panel pregunta acá si hay pedidos cuyo aviso a administración no salió o
// no llegó: si hay, muestra el cartel rojo arriba de todo (3/10/2026).
@Controller('avisos')
export class AvisosController {
  constructor(private readonly avisos: AvisosPedidosService) {}

  @Get('pedidos')
  async pedidos() {
    return { problemas: await this.avisos.problemas() };
  }
}

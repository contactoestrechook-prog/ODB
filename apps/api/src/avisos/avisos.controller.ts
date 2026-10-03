import { BadRequestException, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { AvisosPedidosService } from './avisos-pedidos.service';

// El panel pregunta acá si hay avisos a administración que no salieron o no
// llegaron: si hay, muestra la franja roja arriba de todo (3/10/2026). "Ya
// avisé al local" la saca y deja quién y cuándo.
@Controller('avisos')
export class AvisosController {
  constructor(private readonly avisos: AvisosPedidosService) {}

  @Get('pedidos')
  async pedidos() {
    try {
      return { problemas: await this.avisos.problemas(), whatsapp: this.avisos.estadoWhatsapp };
    } catch (e) {
      // la franja no puede quedar vacía porque la consulta falló: lo dice
      return { problemas: [], whatsapp: this.avisos.estadoWhatsapp, error: e instanceof Error ? e.message : String(e) };
    }
  }

  @Post('pedidos/:id/visto')
  async visto(@Param('id') id: string, @Req() req: any) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('aviso inválido');
    return this.avisos.marcarVisto(id, req.usuario?.sub ?? null);
  }
}

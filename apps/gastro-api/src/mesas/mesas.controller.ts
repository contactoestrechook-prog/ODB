import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MesasService } from './mesas.service';
import { PisoService } from '../piso/piso.service';
import { Publico } from '../auth/decorators';

@Controller()
export class MesasController {
  constructor(
    private readonly mesas: MesasService,
    private readonly piso: PisoService,
  ) {}

  // El cliente escanea el QR → la mesa/opinar del front llama esto para saber
  // "¿es una mesa real?" antes de mostrar la carta o el termómetro.
  @Publico()
  @Get('mesas/:token')
  validar(@Param('token') token: string) {
    return this.mesas.validarToken(token);
  }

  // Botón "Llamar al mozo" desde la carta: no hace falta login, el QR ya
  // identifica la mesa.
  @Publico()
  @Post('mesas/:token/llamar-mozo')
  llamarMozo(@Param('token') token: string) {
    return this.piso.llamarMozo(token);
  }

  // --- administración ---

  @Get('admin/mesas')
  listar() {
    return this.mesas.listar();
  }

  @Post('admin/mesas')
  crear(@Body() body: { numero: number; sector?: string }) {
    return this.mesas.crear(body.numero, body.sector);
  }

  @Delete('admin/mesas/:id')
  desactivar(@Param('id') id: string) {
    return this.mesas.desactivar(id);
  }
}

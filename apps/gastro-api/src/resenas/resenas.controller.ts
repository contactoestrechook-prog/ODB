import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ResenasService } from './resenas.service';

// Todo este módulo es admin-only (panel de Damián): no hay endpoint público,
// las reseñas no las carga el cliente.
@Controller('admin/resenas')
export class ResenasController {
  constructor(private readonly resenas: ResenasService) {}

  @Get()
  listar(@Query('estado') estado?: string) {
    return this.resenas.listar(estado);
  }

  @Post()
  cargarManual(@Body() body: { autor: string; rating: number; texto: string; idioma?: string }) {
    return this.resenas.cargarManual(body);
  }

  @Post(':id/generar-respuesta')
  generarRespuesta(@Param('id') id: string) {
    return this.resenas.generarRespuesta(id);
  }

  @Post(':id/aprobar')
  aprobar(@Param('id') id: string, @Body() body: { textoFinal?: string }) {
    return this.resenas.aprobar(id, body?.textoFinal);
  }

  @Post(':id/marcar-publicada')
  marcarPublicada(@Param('id') id: string) {
    return this.resenas.marcarPublicadaManualmente(id);
  }
}

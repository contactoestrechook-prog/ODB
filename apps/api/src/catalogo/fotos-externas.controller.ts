import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { FotosExternasService } from './fotos-externas.service';
import { CalidadFotosService } from './calidad-fotos.service';

// Fotos por código de barras desde EZ Catalog: estado, lote y producto puntual.
@Controller('catalogo/fotos-externas')
export class FotosExternasController {
  constructor(private readonly fotos: FotosExternasService, private readonly calidad: CalidadFotosService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Get('estado')
  estado() { return this.fotos.estado(); }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('completar')
  completar(@Body() b: { limite?: number }) { return this.fotos.completar(b?.limite ?? 30); }

  // Repasa Storage contra la marca "tiene foto" que usa la tienda para ordenar.
  @Roles('gerente', 'dueno')
  @Post('sincronizar-marca')
  sincronizarMarca() { return this.fotos.sincronizarMarca(); }

  @Roles('gerente', 'dueno')
  @Post('revisar-guardadas')
  revisarGuardadas() { return this.fotos.revisarGuardadas(); }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('dudosas')
  dudosas() { return this.fotos.dudosas(); }

  // Con la foto a la vista, una persona decide: es este producto o no lo es.
  @Roles('comprador', 'gerente', 'dueno')
  @Post('dudosa/:id')
  resolverDudosa(@Param('id') id: string, @Body() b: { aceptar?: boolean }) { return this.fotos.resolverDudosa(id, !!b?.aceptar); }

  // Control de calidad: el modelo mira las fotos y saca las que no sirven.
  @Roles('comprador', 'gerente', 'dueno')
  @Get('calidad')
  calidadEstado() { return this.calidad.estado(); }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('calidad/sacadas')
  calidadSacadas() { return this.calidad.sacadas(); }

  @Roles('gerente', 'dueno')
  @Post('calidad/revisar')
  calidadRevisar(@Body() b: { limite?: number }) { return this.calidad.revisar(b?.limite ?? 40); }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('producto/:sku')
  producto(@Param('sku') sku: string) { return this.fotos.paraSku(sku); }
}

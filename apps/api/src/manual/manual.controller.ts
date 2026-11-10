import { Body, Controller, ForbiddenException, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParaCualquierRol } from '../auth/decorators';
import { ManualService, type PreguntaManual } from './manual.service';

// El manual lo abre cualquiera que entra al sistema (también op salón y el
// repartidor): cualquier rol con sesión puede preguntarle.
@ParaCualquierRol()
@Controller('manual')
export class ManualController {
  constructor(private readonly manual: ManualService) {}

  @Get('novedades')
  novedades(@Req() req: any) {
    delEquipo(req);
    return this.manual.novedades();
  }

  // cada pregunta es una llamada al modelo: tope por persona
  @Throttle({ default: { ttl: 600_000, limit: 40 } })
  @Post('preguntar')
  preguntar(@Body() b: PreguntaManual, @Req() req: any) {
    return this.manual.preguntar(b ?? {}, delEquipo(req));
  }

  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  @Post('pedir')
  pedir(@Body() b: { pregunta?: string; respuesta?: string }, @Req() req: any) {
    delEquipo(req);
    return this.manual.pedir(b ?? {}, req?.usuario?.sub);
  }
}

// la sesión de un cliente de la tienda también es un token válido: el manual es del equipo
function delEquipo(req: any): string {
  const rol = req?.usuario?.rol;
  if (!rol || rol === 'cliente') throw new ForbiddenException('El manual es para el equipo de ODB');
  return rol;
}

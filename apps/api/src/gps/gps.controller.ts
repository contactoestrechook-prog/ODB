import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Publico } from '../auth/decorators';
import { GpsService } from './gps.service';
import { claveValida, leerOsmand, leerTraccar, type Resultado } from './lectura';

// Entrada de los equipos GPS de los vehículos. No hay usuario logueado: entra
// con la clave GPS_TOKEN (header x-gps-token o ?token=). Sin la clave
// configurada no entra nada (fail-closed, como el webhook de PedidosYa).
// Sin límite de tráfico: al recuperar señal un equipo descarga de golpe todo
// lo que guardó sin conexión.
@SkipThrottle()
@Controller('gps')
export class GpsController {
  constructor(private readonly gps: GpsService) {}

  // Traccar, con forward.url apuntando acá y forward.type=json
  @Publico()
  @Post('traccar')
  traccar(@Body() body: any, @Headers('x-gps-token') h?: string, @Query('token') q?: string) {
    this.exigirClave(h ?? q);
    return this.guardar(leerTraccar(body));
  }

  // Traccar Client / protocolo OsmAnd. La app manda POST; otros equipos, GET.
  @Publico()
  @Post('osmand')
  osmandPost(@Query() query: any, @Body() body: any, @Headers('x-gps-token') h?: string) {
    this.exigirClave(h ?? query?.token);
    return this.guardar(leerOsmand(query, body));
  }

  @Publico()
  @Get('osmand')
  osmandGet(@Query() query: any, @Headers('x-gps-token') h?: string) {
    this.exigirClave(h ?? query?.token);
    return this.guardar(leerOsmand(query));
  }

  private exigirClave(recibida?: string) {
    if (!process.env.GPS_TOKEN) throw new UnauthorizedException('Entrada de GPS sin configurar (falta GPS_TOKEN)');
    if (!claveValida(recibida, process.env.GPS_TOKEN)) throw new UnauthorizedException('Clave de GPS inválida');
  }

  // Una lectura sin señal no es un error del equipo: se contesta 200 para que
  // Traccar no la reintente.
  private guardar(r: Resultado) {
    if (!r.ok) return { ok: false, motivo: r.motivo };
    return this.gps.registrar(r.lectura);
  }
}

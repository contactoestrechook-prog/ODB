import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Logger, Param, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Publico } from '../auth/decorators';
import { AvisosCelularService } from './avisos-celular.service';

// AVISOS AL CELULAR (6/11/2026). Cada uno maneja solo sus aparatos.
//   GET  /avisos-celular/clave                    → la clave pública (para suscribirse)
//   GET  /avisos-celular/aparatos                 → mis aparatos con avisos
//   POST /avisos-celular/suscribir {suscripcion, dispositivo} → guarda este aparato
//   POST /avisos-celular/quitar {endpoint}        → deja de mandarle a este aparato
//   POST /avisos-celular/aparatos/:id/quitar      → deja de mandarle a otro aparato mío
//   POST /avisos-celular/probar                   → uno de prueba a todos mis aparatos
//   POST /avisos-celular/enviar                   → SOLO la base (x-avisos: el secreto del Vault)
@Controller('avisos-celular')
export class AvisosCelularController {
  private readonly log = new Logger('AvisosCelular');
  constructor(private readonly avisos: AvisosCelularService) {}

  @Publico()
  @Get('clave')
  async clave() {
    try {
      return { clave: (await this.avisos.clavesAvisos()).publica };
    } catch {
      throw new ServiceUnavailableException('Los avisos al celular todavía no están configurados');
    }
  }

  @Get('aparatos')
  aparatos(@Req() req: any) {
    return this.avisos.aparatos(req.usuario.sub);
  }

  @Post('suscribir')
  async suscribir(@Body() b: { suscripcion?: any; dispositivo?: string }, @Req() req: any) {
    try {
      await this.avisos.suscribir(req.usuario.sub, b?.suscripcion, b?.dispositivo);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'No se pudo guardar el aparato');
    }
    return { ok: true };
  }

  @Post('quitar')
  async quitar(@Body() b: { endpoint?: string }, @Req() req: any) {
    if (!b?.endpoint) throw new BadRequestException('Falta el aparato');
    await this.avisos.quitar(req.usuario.sub, { endpoint: b.endpoint });
    return { ok: true };
  }

  @Post('aparatos/:id/quitar')
  async quitarAparato(@Param('id') id: string, @Req() req: any) {
    await this.avisos.quitar(req.usuario.sub, { id: Number(id) });
    return { ok: true };
  }

  @Post('probar')
  async probar(@Req() req: any) {
    return { ok: true, ...(await this.avisos.probar(req.usuario.sub)) };
  }

  // La llama la base: el disparador de alertas_internas ({ alerta_id }) y el
  // resumen de las 8 ({ modo: 'manana' }). Nunca devuelve error a la base: lo
  // que falla queda en el log.
  @Publico()
  @Post('enviar')
  @HttpCode(200)
  async enviar(@Headers('x-avisos') secreto: string, @Body() b: { alerta_id?: string; modo?: string }) {
    if (!(await this.avisos.secretoOk(secreto ?? ''))) throw new UnauthorizedException();
    try {
      if (b?.modo === 'manana') return { ok: true, ...(await this.avisos.manana()) };
      if (!b?.alerta_id) return { ok: false, error: 'Falta el aviso' };
      return { ok: true, ...(await this.avisos.enviarAlerta(String(b.alerta_id))) };
    } catch (e: any) {
      this.log.error(`no pude mandar al celular ${b?.alerta_id ?? b?.modo ?? ''}: ${e?.message ?? e}`);
      return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    }
  }
}

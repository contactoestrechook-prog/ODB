import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { Publico } from '../auth/decorators';
import { CatalogoService } from '../catalogo/catalogo.service';
import { AsistenteService, type MensajeAsistente } from './asistente.service';

// Compra guiada con IA de la tienda. Es público (cualquiera puede comprar),
// así que lleva un tope por IP: cada pedido es una llamada al modelo.
@Controller('asistente')
export class AsistenteController {
  constructor(private readonly asistente: AsistenteService, private readonly jwt: JwtService, private readonly catalogo: CatalogoService) {}

  @Publico()
  @Throttle({ default: { ttl: 600_000, limit: 40 } })
  @Post('charla')
  async charla(@Body() b: { mensajes?: MensajeAsistente[] }, @Headers('authorization') auth?: string) {
    const { verificado, segmento } = await this.cliente(auth);
    return this.asistente.charlar(Array.isArray(b?.mensajes) ? b.mensajes.slice(-20) : [], verificado, segmento);
  }

  // Mismo criterio que el catálogo: si es de la Comunidad ODB, ve su precio.
  private async cliente(authorization?: string): Promise<{ verificado: boolean; segmento?: string }> {
    const token = (authorization ?? '').replace(/^Bearer /, '');
    if (!token) return { verificado: false };
    try {
      const p = await this.jwt.verifyAsync(token);
      if (p.rol !== 'cliente' || !p.sub) return { verificado: false };
      const { data } = await this.catalogo.tipoCliente(p.sub);
      return { verificado: p.verificado === true, segmento: data ?? undefined };
    } catch {
      return { verificado: false };
    }
  }
}

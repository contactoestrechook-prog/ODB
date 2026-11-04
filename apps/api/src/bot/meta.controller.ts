import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import { Publico } from '../auth/decorators';
import { eventosDeMeta, firmaMetaValida } from '../comun/meta';
import { BotService } from './bot.service';

// EL WEBHOOK DE LA API OFICIAL (4/11/2026). Meta le pega acá a cada mensaje de
// la línea que va por la API (ver comun/meta.ts). No usa la API key del bot
// (Meta no la manda): se protege con la firma X-Hub-Signature-256 de la app.
// Cada mensaje se traduce a la forma de WAHA y entra por el mismo camino que
// los de WAHA (webhookWaha), con su registro en bot_entrantes: un reintento de
// Meta del mismo mensaje se descarta como repetido.
@Publico()
@Controller('bot/meta')
export class MetaWebhookController {
  private readonly log = new Logger('Webhook Meta');
  constructor(private readonly bot: BotService) {}

  // Meta verifica el webhook una vez, al darlo de alta: devuelve el desafío si la palabra coincide
  @Get()
  verificar(@Query('hub.mode') modo?: string, @Query('hub.verify_token') palabra?: string, @Query('hub.challenge') desafio?: string) {
    const esperada = process.env.META_VERIFY_TOKEN;
    if (modo === 'subscribe' && esperada && palabra === esperada) return desafio ?? '';
    throw new ForbiddenException('Verificación del webhook inválida');
  }

  @Post()
  @HttpCode(200)
  async recibir(@Req() req: any, @Body() cuerpo: any, @Headers('x-hub-signature-256') firma?: string) {
    if (!firmaMetaValida(req.rawBody, firma)) throw new ForbiddenException('Firma de Meta inválida');
    const eventos = eventosDeMeta(cuerpo);
    // Meta espera respuesta rápida y reintenta si no la recibe: lo que tarde más
    // de 12 s sigue procesándose y se le contesta igual (el registro en
    // bot_entrantes frena el reintento repetido)
    const trabajo = Promise.all(eventos.map(async ({ evento, numeroLinea }) => {
      try {
        return await this.bot.webhookWaha(evento, numeroLinea);
      } catch (e: any) {
        this.log.error(`mensaje ${evento?.payload?.id ?? '?'} de Meta falló: ${e?.message ?? e}`);
        return { error: true };
      }
    }));
    const reloj = new Promise((r) => setTimeout(() => r('sigue'), 12_000));
    await Promise.race([trabajo, reloj]);
    return { ok: true, eventos: eventos.length };
  }
}

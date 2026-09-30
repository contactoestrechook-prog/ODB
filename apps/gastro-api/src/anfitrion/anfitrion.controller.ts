import { Body, Controller, Post } from '@nestjs/common';
import { Publico } from '../auth/decorators';
import { AnfitrionService, type MensajeChat, type Idioma } from './anfitrion.service';

@Controller('anfitrion')
export class AnfitrionController {
  constructor(private readonly anfitrion: AnfitrionService) {}

  @Publico()
  @Post('charlar')
  charlar(@Body() body: { mensajes: MensajeChat[]; idioma?: Idioma }) {
    return this.anfitrion.charlar(body.mensajes, body.idioma);
  }
}

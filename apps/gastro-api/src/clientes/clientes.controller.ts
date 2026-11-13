import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClientesService } from './clientes.service';
import { Publico } from '../auth/decorators';

@Controller()
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  // Público (el cliente en la mesa), pero con rate limit fuerte propio:
  // captura datos personales, no queremos scripts probando tokens.
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('mesas/:token/canjear-cafe')
  canjear(@Param('token') token: string, @Body() body: { telefono: string; nombre?: string; idioma?: string }) {
    return this.clientes.canjearCafe(token, body.telefono, body.nombre, body.idioma);
  }

  @Get('admin/post-visita')
  postVisita() {
    return this.clientes.postVisita();
  }

  @Post('admin/post-visita/:id')
  marcarPostVisita(@Param('id') id: string, @Body() body?: { enviado?: boolean }) {
    return this.clientes.marcarPostVisita(id, body?.enviado !== false);
  }

  @Get('admin/clientes')
  listar() {
    return this.clientes.listar();
  }

  @Get('admin/clientes/resumen')
  resumen() {
    return this.clientes.resumen();
  }
}

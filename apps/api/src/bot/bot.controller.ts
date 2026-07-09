import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotGuard } from './bot.guard';
import { Publico, Roles } from '../auth/decorators';

// API que consumen los bots de WhatsApp (n8n). Se saltea la sesión de usuario
// (@Publico) y se protege con API key (BotGuard → header x-api-key).
@Publico()
@UseGuards(BotGuard)
@Controller('bot')
export class BotController {
  constructor(private readonly bot: BotService) {}

  // ---- El agente conversacional (lo llama n8n con cada mensaje entrante) ----
  // Cerebro server-side: Opus + razonamiento adaptativo + herramientas + memoria.
  @Post('charla')
  charla(@Body() body: {
    linea: 'pedidos' | 'proveedores';
    telefono: string;
    mensaje?: string;
    mensajeId?: string; // id del mensaje de WhatsApp (idempotencia ante reintentos)
    archivoBase64?: string;
    mimeType?: string;
  }) {
    return this.bot.charla(body);
  }

  // ---- Línea PEDIDOS ----

  @Post('pedidos/cliente')
  cliente(@Body() body: { telefono: string }) {
    return this.bot.identificarCliente(body.telefono);
  }

  @Get('pedidos/buscar')
  buscar(@Query('q') q: string) {
    return this.bot.buscarProductos(q ?? '');
  }

  @Post('pedidos/crear')
  crear(@Body() body: {
    telefono: string;
    nombre?: string;
    tipo?: 'pickup' | 'domicilio';
    items: { sku: string; cantidad: number }[];
    direccion?: string;
  }) {
    return this.bot.crearPedido(body);
  }

  @Get('pedidos/:id')
  estado(@Param('id') id: string) {
    return this.bot.estadoPedido(id);
  }

  // ---- Línea PROVEEDORES ----

  @Post('proveedores/factura')
  factura(@Body() body: { telefono?: string; archivoBase64: string; mimeType: string }) {
    return this.bot.recibirFactura(body);
  }
}

// Simulador del panel: el staff prueba el bot con su sesión normal (sin la
// API key de n8n). Mismo cerebro y mismas herramientas que WhatsApp.
@Roles('gerente', 'dueno')
@Controller('bot')
export class BotPruebaController {
  constructor(private readonly bot: BotService) {}

  @Post('probar')
  probar(@Body() body: {
    linea: 'pedidos' | 'proveedores';
    telefono: string;
    mensaje?: string;
    archivoBase64?: string;
    mimeType?: string;
  }) {
    return this.bot.charla(body);
  }

  // "Nueva conversación" del simulador: borra la memoria de ese teléfono
  @Delete('probar')
  reiniciar(@Query('linea') linea: string, @Query('telefono') telefono: string) {
    return this.bot.borrarConversacion(linea === 'proveedores' ? 'proveedores' : 'pedidos', telefono ?? '');
  }
}

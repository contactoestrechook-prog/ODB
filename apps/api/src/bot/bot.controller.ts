import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
    linea?: 'pedidos' | 'proveedores';
    numeroLinea?: string; // número del negocio al que llegó el mensaje
    telefono: string;
    mensaje?: string;
    mensajeId?: string; // id del mensaje de WhatsApp (idempotencia ante reintentos)
    archivoBase64?: string;
    mimeType?: string;
  }) {
    return this.bot.charla(body);
  }

  // WAHA postea acá cada mensaje entrante (webhook de la sesión). Se protege con
  // la misma API key en un header propio, configurado en la sesión de WAHA.
  @Post('waha')
  waha(@Body() evento: any, @Query('linea') numeroLinea?: string) {
    return this.bot.webhookWaha(evento, numeroLinea);
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

// Bandeja + simulador del panel: el staff usa su sesión normal (sin la API key
// del puente). La bandeja la atiende quien está en el mostrador, así que entra
// cajero; el interruptor general queda para gerencia.
@Roles('cajero', 'gerente', 'dueno')
@Controller('bot')
export class BotPruebaController {
  constructor(private readonly bot: BotService) {}

  // RESPONDE: bandeja de conversaciones en vivo del empleado virtual
  @Get('conversaciones')
  conversaciones() {
    return this.bot.conversaciones();
  }

  @Get('conversaciones/detalle')
  conversacionDetalle(@Query('linea') linea: string, @Query('telefono') telefono: string) {
    return this.bot.conversacionDetalle(linea, telefono);
  }

  // La persona contesta desde la bandeja: el mensaje sale por el puente (n8n)
  // con el número del local, y el bot queda callado en esa conversación.
  @Post('conversaciones/responder')
  responder(@Body() b: { linea?: string; telefono: string; texto: string }, @Req() req: any) {
    return this.bot.responderComoHumano(
      b.linea === 'proveedores' ? 'proveedores' : 'pedidos',
      String(b.telefono ?? '').replace(/\D/g, ''),
      b.texto,
      req.usuario?.sub,
    );
  }

  // Tema resuelto: la conversación vuelve al bot
  @Post('conversaciones/devolver')
  devolver(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.devolverAlBot(
      b.linea === 'proveedores' ? 'proveedores' : 'pedidos',
      String(b.telefono ?? '').replace(/\D/g, ''),
      req.usuario?.sub,
    );
  }

  // Pausar el bot en una charla sin escribir (la persona atiende por el teléfono)
  @Post('conversaciones/pausar')
  pausar(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.pausarBot(b.linea === 'proveedores' ? 'proveedores' : 'pedidos', String(b.telefono ?? '').replace(/\D/g, ''), req.usuario?.sub);
  }

  // "Este número es de la casa": el bot deja de contestarle. Hace falta a mano
  // porque WhatsApp ya no manda el teléfono, manda un identificador.
  @Post('conversaciones/equipo')
  equipo(@Body() b: { telefono: string; esEquipo?: boolean }, @Req() req: any) {
    return this.bot.marcarEquipo(String(b.telefono ?? ''), b.esEquipo !== false, req.usuario?.sub);
  }

  // El equipo abrió la charla: deja de figurar como sin leer
  @Post('conversaciones/leida')
  leida(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.marcarLeida(b.linea === 'proveedores' ? 'proveedores' : 'pedidos', String(b.telefono ?? '').replace(/\D/g, ''), req.usuario?.sub);
  }

  // Interruptor general de la línea: apagar/encender el bot en TODAS las charlas
  @Get('linea/estado')
  estadoLinea(@Query('linea') linea?: string) {
    return this.bot.estadoLinea(linea === 'proveedores' ? 'proveedores' : 'pedidos');
  }

  @Roles('gerente', 'dueno')
  @Post('linea/bot')
  setBotLinea(@Body() b: { linea?: string; activo: boolean }, @Req() req: any) {
    return this.bot.setBotLinea(b.linea === 'proveedores' ? 'proveedores' : 'pedidos', b.activo !== false, req.usuario?.sub);
  }

  // ---- RESPONDE · gestión ----
  @Get('contactos/ficha')
  ficha(@Query('telefono') telefono: string) {
    return this.bot.fichaContacto(String(telefono ?? '').replace(/\D/g, ''));
  }

  @Post('contactos/nota')
  nota(@Body() b: { telefono: string; nota: string; etiquetas?: string[] }) {
    return this.bot.guardarNota(String(b.telefono ?? '').replace(/\D/g, ''), b.nota ?? '', b.etiquetas);
  }

  @Post('programados')
  programar(@Body() b: { linea?: string; telefono: string; texto: string; enviarEn: string }, @Req() req: any) {
    return this.bot.programarMensaje({ ...b, telefono: String(b.telefono ?? '').replace(/\D/g, ''), usuarioId: req.usuario?.sub });
  }

  @Get('programados')
  programados(@Query('telefono') telefono?: string) {
    return this.bot.programados(telefono ? String(telefono).replace(/\D/g, '') : undefined);
  }

  @Post('programados/:id/cancelar')
  cancelarProgramado(@Param('id') id: string) {
    return this.bot.cancelarProgramado(id);
  }

  // Difusiones: solo gerencia (es la reputación del número)
  @Roles('gerente', 'dueno')
  @Post('difusiones')
  crearDifusion(@Body() b: { linea?: string; titulo?: string; texto: string; imagenUrl?: string; telefonos: string[] }, @Req() req: any) {
    return this.bot.crearDifusion({ ...b, usuarioId: req.usuario?.sub });
  }

  @Roles('gerente', 'dueno')
  @Get('difusiones')
  difusiones() {
    return this.bot.difusiones();
  }

  @Roles('gerente', 'dueno')
  @Get('listas')
  listasDifusion() {
    return this.bot.listasDifusion();
  }

  @Roles('gerente', 'dueno')
  @Get('listas/:id/telefonos')
  listaTelefonos(@Param('id') id: string) {
    return this.bot.listaTelefonos(id);
  }

  @Roles('gerente', 'dueno')
  @Get('difusiones/base')
  baseDifundible() {
    return this.bot.baseDifundible();
  }

  @Get('responde/resumen')
  resumenResponde() {
    return this.bot.resumenResponde();
  }

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

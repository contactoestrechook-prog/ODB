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
    linea?: string; // el ID de la línea; sin línea (o una que no existe), la principal
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
  // Todas las sesiones (una por línea) usan este mismo webhook: la línea sale
  // de la sesión que trae cada evento (6/10/2026). ?linea= es el número de la
  // línea, por compatibilidad y como segundo dato.
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

  @Get('adjuntos/renovar')
  renovarAdjunto(@Query('ruta') ruta: string) {
    return this.bot.renovarAdjunto(ruta);
  }

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
  async responder(@Body() b: { linea?: string; telefono: string; texto: string }, @Req() req: any) {
    // MULTILÍNEA (6/10/2026): la línea se valida y se usa tal cual. Antes todo lo
    // que no era 'proveedores' se volvía 'pedidos' y la acción caía en la charla
    // de la otra línea del mismo cliente.
    return this.bot.responderComoHumano(
      await this.bot.lineaDelPanel(b.linea),
      String(b.telefono ?? '').replace(/\D/g, ''),
      b.texto,
      req.usuario?.sub,
    );
  }

  // Tema resuelto: la conversación vuelve al bot
  @Post('conversaciones/devolver')
  async devolver(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.devolverAlBot(
      await this.bot.lineaDelPanel(b.linea),
      String(b.telefono ?? '').replace(/\D/g, ''),
      req.usuario?.sub,
    );
  }

  // Pausar el bot en una charla sin escribir (la persona atiende por el teléfono)
  @Post('conversaciones/pausar')
  async pausar(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.pausarBot(await this.bot.lineaDelPanel(b.linea), String(b.telefono ?? '').replace(/\D/g, ''), req.usuario?.sub);
  }

  // "Este número es de la casa": el bot deja de contestarle. Hace falta a mano
  // porque WhatsApp ya no manda el teléfono, manda un identificador.
  @Post('conversaciones/equipo')
  equipo(@Body() b: { telefono: string; esEquipo?: boolean }, @Req() req: any) {
    return this.bot.marcarEquipo(String(b.telefono ?? ''), b.esEquipo !== false, req.usuario?.sub);
  }

  // El equipo abrió la charla: deja de figurar como sin leer
  @Post('conversaciones/leida')
  async leida(@Body() b: { linea?: string; telefono: string }, @Req() req: any) {
    return this.bot.marcarLeida(await this.bot.lineaDelPanel(b.linea), String(b.telefono ?? '').replace(/\D/g, ''), req.usuario?.sub);
  }

  // Las líneas de WhatsApp (6/10/2026): una tarjeta por número en el panel,
  // con su interruptor y el estado de su sesión.
  @Get('lineas')
  lineas() {
    return this.bot.listarLineas();
  }

  // Interruptor general de la línea: apagar/encender el bot en TODAS las charlas
  // de ESA línea (cada número tiene el suyo)
  @Get('linea/estado')
  async estadoLinea(@Query('linea') linea?: string) {
    return this.bot.estadoLinea(await this.bot.lineaDelPanel(linea));
  }

  @Roles('gerente', 'dueno')
  @Post('linea/bot')
  async setBotLinea(@Body() b: { linea?: string; activo: boolean }, @Req() req: any) {
    return this.bot.setBotLinea(await this.bot.lineaDelPanel(b.linea), b.activo !== false, req.usuario?.sub);
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
  crearDifusion(@Body() b: { linea?: string; titulo?: string; texto: string; imagenUrl?: string; telefonos: string[]; programadaPara?: string }, @Req() req: any) {
    return this.bot.crearDifusion({ ...b, usuarioId: req.usuario?.sub });
  }

  @Roles('gerente', 'dueno')
  @Post('difusiones/:id/cancelar')
  cancelarDifusion(@Param('id') id: string) {
    return this.bot.cancelarDifusion(id);
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

  // El simulador muestra lo que recibe el cliente (2/10/2026): si la respuesta
  // sale con tarjeta Placa roja (resumen, pedido, precios), viaja también la
  // imagen con su epígrafe. La respuesta en texto sigue igual. Si la tarjeta no
  // se arma, el simulador muestra el texto, como le llegaría al cliente.
  @Post('probar')
  async probar(@Body() body: {
    linea: string; // cualquier línea cargada: el simulador prueba la línea nueva antes de prenderla
    telefono: string;
    mensaje?: string;
    archivoBase64?: string;
    mimeType?: string;
  }) {
    const r: any = await this.bot.charla(body);
    const tarjeta = await this.bot.tarjetaDeLaRespuesta(r).catch(() => null);
    return { ...r, tarjeta };
  }

  // "Nueva conversación" del simulador: borra la memoria de ese teléfono
  @Delete('probar')
  async reiniciar(@Query('linea') linea: string, @Query('telefono') telefono: string) {
    return this.bot.borrarConversacion(await this.bot.lineaDelPanel(linea), telefono ?? '');
  }
}

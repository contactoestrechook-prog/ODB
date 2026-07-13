import { BadRequestException, Body, Controller, Get, Header, Headers, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PedidosService } from './pedidos.service';
import type { PedidoYaPayload } from './pedidos.service';
import { Publico, Roles } from '../auth/decorators';
import { LimitadorTasa } from '../comun/limitador';

// POST /app/pedidos es público (guest checkout de la app del cliente, sin
// login) y reserva stock real: sin límite, cualquiera podría bombardearlo
// para bloquear stock de productos ajenos. Tope bajo por IP.
const limitadorPedidosApp = new LimitadorTasa(Number(process.env.ODB_APP_PEDIDOS_HORA ?? 6), 3_600_000);

@Controller()
export class PedidosController {
  constructor(
    private readonly pedidos: PedidosService,
    private readonly jwt: JwtService,
  ) {}

  // Si llega un token de cliente, devuelve su id para atribuirle el pedido
  // (la web loguea por email; el pedido suma puntos e historial). Opcional: el
  // guest checkout sigue funcionando sin token.
  private async clienteDeToken(auth?: string): Promise<string | undefined> {
    const token = (auth ?? '').replace(/^Bearer /, '');
    if (!token) return undefined;
    try {
      const p = await this.jwt.verifyAsync(token);
      return p.rol === 'cliente' && p.sub ? p.sub : undefined;
    } catch {
      return undefined;
    }
  }

  // Webhook real de PedidosYa: configurar la URL pública + token en el portal de partners.
  // Hasta tener las credenciales, el simulador genera pedidos idénticos.
  @Publico()
  @Post('pedidosya/webhook')
  webhook(
    @Body() payload: PedidoYaPayload,
    @Headers('x-webhook-token') tokenHeader?: string,
    @Query('token') tokenQuery?: string,
  ) {
    const esperado = process.env.PEDIDOSYA_WEBHOOK_TOKEN;
    if (!esperado) {
      // fail-closed: sin token configurado no se aceptan pedidos externos
      throw new UnauthorizedException('Webhook de PedidosYa sin configurar');
    }
    // preferimos el header (no queda en logs/proxies); el query se mantiene por compatibilidad
    const recibido = tokenHeader ?? tokenQuery ?? '';
    const a = Buffer.from(recibido);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token de webhook inválido');
    }
    return this.pedidos.recibirDePedidosYa(payload);
  }

  @Roles('gerente', 'dueno')
  @Post('pedidosya/simular')
  simular() {
    const ejemplos: PedidoYaPayload[] = [
      {
        orderId: Math.floor(100000 + Math.random() * 900000),
        customer: { name: 'Cliente PedidosYa' },
        items: [
          { sku: 'CER-0001', name: 'Cerveza Quilmes lata 473', quantity: 6 },
          { name: 'fernet branca 750', quantity: 1 },
          { name: 'picada aceitunas verdes', quantity: 1 },
        ],
        notes: 'Tocar timbre depto 3B',
      },
      {
        orderId: Math.floor(100000 + Math.random() * 900000),
        customer: { name: 'Cliente PedidosYa' },
        items: [
          { name: 'coca cola original 2.25', quantity: 2 },
          { name: 'jamon crudo feteado', quantity: 1 },
          { name: 'queso brie', quantity: 1 },
          { sku: 'VIN-0005', name: 'Zuccardi Serie A Malbec', quantity: 1 },
        ],
      },
    ];
    return this.pedidos.recibirDePedidosYa(ejemplos[Math.floor(Math.random() * ejemplos.length)]);
  }

  // Pedido por WhatsApp: la IA interpreta el mensaje del cliente → preview → crear
  @Roles('cajero', 'gerente', 'dueno', 'deposito')
  @Post('pedidos/whatsapp/analizar')
  analizarWa(@Body() b: { texto: string }) {
    return this.pedidos.analizarWhatsApp(b.texto);
  }

  @Roles('cajero', 'gerente', 'dueno', 'deposito')
  @Post('pedidos/whatsapp')
  crearWa(@Body() b: { items: any[]; nombre?: string; notas?: string; dni?: string }) {
    return this.pedidos.recibirWhatsApp(b);
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Get('pedidos')
  cola() {
    return this.pedidos.cola();
  }

  // --- Endpoints públicos para la app del cliente ---
  // Guest checkout intencional (sin login obligatorio); el límite por IP es
  // la defensa contra bombardeo automatizado que reserve stock ajeno.
  @Publico()
  @Post('app/pedidos')
  async crearDesdeApp(
    @Body() body: { tipo?: 'pickup' | 'domicilio'; items: { sku: string; cantidad: number }[]; dni?: string; destino?: any },
    @Headers('authorization') auth?: string,
    @Req() req?: any,
  ) {
    if (limitadorPedidosApp.superaLimite(req?.ip ?? 'sin-ip')) {
      throw new BadRequestException('Demasiados pedidos desde esta conexión. Probá de nuevo en un rato.');
    }
    const clienteId = await this.clienteDeToken(auth);
    return this.pedidos.crearDesdeApp({ ...body, clienteId });
  }

  // Sucursal central (única con pick-up): la app la muestra como punto de retiro.
  @Publico()
  @Get('sucursal-pickup')
  sucursalPickup() {
    return this.pedidos.sucursalPickup();
  }

  @Publico()
  @Get('app/pedidos/:id')
  obtener(@Param('id') id: string) {
    return this.pedidos.obtener(id);
  }

  // El cliente reporta su ubicación; si está llegando, se le asigna estacionamiento.
  @Publico()
  @Post('app/pedidos/:id/ubicacion')
  ubicacion(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.pedidos.reportarUbicacion(id, body.lat, body.lng);
  }

  @Publico()
  @Get('app/pedidos/:id/seguimiento')
  seguimiento(@Param('id') id: string) {
    return this.pedidos.seguimiento(id);
  }

  // --- Mercado Pago ---
  @Publico()
  @Post('app/pedidos/:id/pago')
  pago(@Param('id') id: string) {
    return this.pedidos.crearPreferenciaMP(id);
  }

  @Publico()
  @Post('mercadopago/webhook')
  webhookMP(@Body() body: any, @Query() query: any, @Headers() headers: Record<string, string>) {
    return this.pedidos.webhookMP(body, query, headers);
  }

  @Publico()
  @Get('pago/ok')
  @Header('Content-Type', 'text/html; charset=utf-8')
  pagoOk() {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago O.D.B</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#1A1412;color:#F4EEE4;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">
<div style="padding:32px"><div style="font-size:54px">🍷</div>
<h1 style="color:#C9A96E;letter-spacing:3px;margin:8px 0 0">O.D.B</h1>
<p style="font-size:20px;font-weight:700;margin:18px 0 6px">¡Listo!</p>
<p style="color:#cfc4b8">Ya podés volver a la app O.D.B para ver tu pedido.</p></div></body></html>`;
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Get('estacionamientos')
  estacionamientos(@Query('sucursalId') sucursalId?: string) {
    return this.pedidos.estacionamientos(sucursalId);
  }

  // --- Delivery a domicilio ---
  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Patch('pedidos/:id/repartidor')
  asignarRepartidor(@Param('id') id: string, @Body() body: { repartidorId: string }) {
    return this.pedidos.asignarRepartidor(id, body.repartidorId);
  }

  @Roles('repartidor', 'gerente', 'dueno')
  @Get('repartidor/mis-entregas')
  misEntregas(@Req() req: any) {
    return this.pedidos.misEntregas(req.usuario.sub);
  }

  @Roles('repartidor', 'gerente', 'dueno')
  @Post('repartidor/pedidos/:id/ubicacion')
  repartidorUbicacion(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.pedidos.repartidorUbicacion(id, body.lat, body.lng);
  }

  // El DNI sale del token del cliente (no del path): así nadie puede enumerar
  // la base de clientes probando DNIs ajenos.
  @Roles('cliente')
  @Get('app/perfil')
  perfil(@Req() req: any) {
    return this.pedidos.perfil(req.usuario.dni);
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno', 'repartidor')
  @Post('pedidos/:id/avanzar')
  avanzar(@Param('id') id: string, @Body() body: { estado: string }, @Req() req: any) {
    return this.pedidos.avanzar(id, body.estado, req.usuario?.sub);
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Get('envios')
  envios() {
    return this.pedidos.enviosDomicilio();
  }

  @Roles('deposito', 'cajero', 'gerente', 'dueno')
  @Get('repartidores')
  repartidores() {
    return this.pedidos.repartidores();
  }
}

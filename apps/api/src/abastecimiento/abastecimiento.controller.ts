import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { AbastecimientoService, filaCorta, type MensajeAbastecimiento } from './abastecimiento.service';

// La mesa de compras: qué falta, qué no llega a tiempo y el agente que propone
// y arma las órdenes (ver abastecimiento.service.ts).
@Controller('abastecimiento')
export class AbastecimientoController {
  constructor(private readonly abastecimiento: AbastecimientoService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Get('resumen')
  resumen() {
    return this.abastecimiento.resumen();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('lista')
  async lista(@Query('sucursal') sucursal?: string, @Query('alerta') alerta?: string, @Query('q') q?: string, @Query('limite') limite?: string) {
    const sucursalId = await this.abastecimiento.sucursalId(sucursal);
    let filas = await this.abastecimiento.situacion({ sucursalId, q: q ?? null, limite: Math.min(Number(limite) || 300, 2000) });
    if (alerta && alerta !== 'todas') filas = filas.filter((f) => f.alerta === alerta);
    return filas.map(filaCorta);
  }

  // "Qué comprar": lo sugerido, como notas de pedido para tildar
  @Roles('comprador', 'gerente', 'dueno')
  @Get('propuestas')
  propuestas(@Query('sucursal') sucursal?: string) {
    return this.abastecimiento.propuestas({ sucursal });
  }

  // La nota tildada se convierte en orden de compra (queda a aprobar)
  @Roles('comprador', 'gerente', 'dueno')
  @Post('orden')
  orden(@Body() b: { proveedorId: string; sucursalId: string; items: { sku: string; cantidad: number }[] }, @Req() req: any) {
    return this.abastecimiento.crearOrden({
      proveedorId: b?.proveedorId, sucursalId: b?.sucursalId, items: Array.isArray(b?.items) ? b.items : [],
      // las observaciones viajan al proveedor: acá no va ninguna nota interna
      usuarioId: req.usuario?.sub,
    });
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('charla')
  charla(@Body() b: { mensajes: MensajeAbastecimiento[] }, @Req() req: any) {
    if (!Array.isArray(b?.mensajes)) throw new BadRequestException('Faltan los mensajes');
    return this.abastecimiento.charlar(b.mensajes, req.usuario?.sub);
  }
}

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import type { AjusteDto, TransferenciaDto } from './stock.service';
import { Roles } from '../auth/decorators';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('bajo-minimo')
  bajoMinimo() {
    return this.stock.bajoMinimo();
  }

  @Get('movimientos')
  movimientos(
    @Query('limite') limite?: string,
    @Query('tipo') tipo?: string,
    @Query('sucursalId') sucursalId?: string,
    @Query('sku') sku?: string,
    @Query('dias') dias?: string,
  ) {
    return this.stock.movimientos({
      limite: limite ? Number(limite) : undefined,
      tipo: tipo || undefined,
      sucursalId: sucursalId || undefined,
      sku: sku || undefined,
      dias: dias ? Number(dias) : undefined,
    });
  }

  @Get('resumen')
  resumen() {
    return this.stock.resumen();
  }

  @Get('valorizacion')
  valorizacion() {
    return this.stock.valorizacion();
  }

  @Get('negativos')
  negativos() {
    return this.stock.negativos();
  }

  @Get('abc')
  abc() {
    return this.stock.abc();
  }

  @Get('sin-rotacion')
  sinRotacion(@Query('dias') dias?: string) {
    return this.stock.sinRotacion(dias ? Number(dias) : undefined);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('ajustes')
  ajuste(@Body() dto: AjusteDto) {
    return this.stock.registrarAjuste(dto, 'ajuste');
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('mermas')
  merma(@Body() dto: AjusteDto) {
    return this.stock.registrarAjuste(dto, 'merma');
  }

  @Get('transferencias')
  transferencias() {
    return this.stock.transferenciasPendientes();
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('transferencias')
  transferencia(@Body() dto: TransferenciaDto) {
    return this.stock.crearTransferencia(dto);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('transferencias/:id/recibir')
  recibir(@Param('id') id: string) {
    return this.stock.recibirTransferencia(id);
  }
}

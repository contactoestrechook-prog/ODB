import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import type { AjusteDto, TransferenciaDto } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('bajo-minimo')
  bajoMinimo() {
    return this.stock.bajoMinimo();
  }

  @Get('movimientos')
  movimientos(@Query('limite') limite?: string) {
    return this.stock.movimientos(limite ? Number(limite) : undefined);
  }

  @Post('ajustes')
  ajuste(@Body() dto: AjusteDto) {
    return this.stock.registrarAjuste(dto, 'ajuste');
  }

  @Post('mermas')
  merma(@Body() dto: AjusteDto) {
    return this.stock.registrarAjuste(dto, 'merma');
  }

  @Post('transferencias')
  transferencia(@Body() dto: TransferenciaDto) {
    return this.stock.crearTransferencia(dto);
  }

  @Post('transferencias/:id/recibir')
  recibir(@Param('id') id: string) {
    return this.stock.recibirTransferencia(id);
  }
}

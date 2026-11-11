import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { BalanzasService } from './balanzas.service';

// Balanzas: la lista de PLU con precio para cargar en las Kretz con iTegra
// (11/11/2026). La baja quien carga las balanzas (depósito, gerencia, compras;
// administrativo entra por herencia); sumar un producto por unidad, quien
// decide el catálogo.
@Roles('dueno', 'gerente', 'comprador', 'deposito')
@Controller('balanzas')
export class BalanzasController {
  constructor(private readonly balanzas: BalanzasService) {}

  @Get('lista')
  lista() {
    return this.balanzas.lista();
  }

  // ?modo=completo|cambios → el archivo para iTegra
  @Get('itegra')
  async itegra(@Query('modo') modo: string, @Req() req: any, @Res() res: any) {
    const r = await this.balanzas.archivo(modo === 'cambios' ? 'cambios' : 'completo', req.usuario?.sub);
    res.setHeader('Content-Type', 'text/csv; charset=us-ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
    res.setHeader('X-Cantidad', String(r.cantidad));
    res.send(r.csv);
  }

  @Roles('dueno', 'gerente', 'comprador')
  @Post('productos')
  marcar(@Body() dto: { sku?: string; enBalanza?: boolean }, @Req() req: any) {
    return this.balanzas.marcar(dto?.sku ?? '', dto?.enBalanza !== false, req.usuario?.sub);
  }
}

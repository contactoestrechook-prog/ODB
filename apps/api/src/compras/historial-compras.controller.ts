import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { HistorialComprasService } from './historial-compras.service';
import { FichaArticuloService } from './ficha-articulo.service';

// Lo que nos vende cada proveedor (8/10/2026): la carga por foto guarda los
// renglones al registrar (mismos permisos que la carga) y la mesa de compras
// los consulta (mismos permisos que la mesa).
@Controller()
export class HistorialComprasController {
  constructor(private readonly historial: HistorialComprasService, private readonly fichas: FichaArticuloService) {}

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/entrada-foto/:id/historial')
  guardar(@Param('id') id: string, @Body() b: any, @Req() req: any) {
    return this.historial.guardar(id, b ?? {}, req?.usuario?.sub);
  }

  // La ficha de cada artículo del proveedor (11/11/2026): cómo vino y cómo entró
  // la última vez. La pide la carga por foto al abrir una factura recién leída.
  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/proveedores/:id/fichas-articulo/buscar')
  buscarFichas(@Param('id') id: string, @Body() b: { renglones?: { descripcion?: string; sku?: string | null }[] }) {
    return this.fichas.buscar(id, b?.renglones ?? []);
  }

  // Arma las fichas desde todo lo ya registrado. Se corre una vez al publicar.
  @Roles('dueno')
  @Post('compras/fichas-articulo/sembrar')
  sembrarFichas() {
    return this.fichas.sembrar();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/proveedores/:id/historial')
  proveedor(@Param('id') id: string) {
    return this.historial.resumen(id);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('compras/productos/:sku/historial-compras')
  producto(@Param('sku') sku: string) {
    return this.historial.porProducto(sku);
  }
}

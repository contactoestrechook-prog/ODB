import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { FacturaChatService } from './factura-chat.service';

// La factura editable (8/10/2026): el chat con IA, las reglas por proveedor y
// la constancia de quién cambió qué antes de registrar. Mismos permisos que la
// carga por foto (administrativo entra como comprador y depósito).
@Controller()
export class FacturaChatController {
  constructor(private readonly factura: FacturaChatService) {}

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/entrada-foto/:id/chat')
  chat(@Param('id') id: string, @Body() b: any, @Req() req: any) {
    return this.factura.chat(id, b ?? {}, req?.usuario?.sub);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/entrada-foto/:id/revision')
  revision(@Param('id') id: string, @Body() b: any, @Req() req: any) {
    return this.factura.guardarRevision(id, b ?? {}, req?.usuario?.sub);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Get('compras/proveedores/:id/reglas-lectura')
  reglas(@Param('id') id: string) {
    return this.factura.reglas(id);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/proveedores/:id/reglas-lectura')
  guardarRegla(@Param('id') id: string, @Body() b: { regla?: string }, @Req() req: any) {
    return this.factura.guardarRegla(id, b?.regla ?? '', req?.usuario?.sub);
  }

  @Roles('deposito', 'comprador', 'gerente', 'dueno')
  @Post('compras/reglas-lectura/:id/desactivar')
  desactivarRegla(@Param('id') id: string, @Req() req: any) {
    return this.factura.desactivarRegla(id, req?.usuario?.sub);
  }
}

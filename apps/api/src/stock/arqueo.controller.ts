import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ArqueoService } from './arqueo.service';
import { autorizaSolo } from './stock.controller';

// Arqueo de stock (24/10/2026). Cuentan cajeros, depósito y backoffice
// (administrativo hereda depósito); arman, revisan y aplican gerencia y dueño.
// Aplicar ajusta stock en masa: depósito puede hacerlo solo con el PIN de un
// supervisor (token de un solo uso de /caja/autorizar).
@Controller('stock/arqueos')
export class ArqueoController {
  constructor(private readonly arqueo: ArqueoService) {}

  @Roles('gerente', 'dueno')
  @Post()
  crear(@Body() dto: any, @Req() req: any) {
    return this.arqueo.crear(dto, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Get('opciones')
  opciones() {
    return this.arqueo.opciones();
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get()
  listar() {
    return this.arqueo.listar();
  }

  // ---- contar ----

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get(':id/contar')
  paraContar(@Param('id') id: string, @Req() req: any) {
    return this.arqueo.paraContar(id, req.usuario?.sub);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get(':id/identificar')
  identificar(@Param('id') id: string, @Query('q') q: string, @Req() req: any) {
    return this.arqueo.identificar(id, q ?? '', req.usuario?.sub);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post(':id/registros')
  registrar(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.arqueo.registrar(id, dto, req.usuario?.sub);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post(':id/registros/:registroId/anular')
  anular(@Param('id') id: string, @Param('registroId') registroId: string, @Req() req: any) {
    return this.arqueo.anular(id, registroId, req.usuario?.sub, !!autorizaSolo(req));
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post(':id/no-encontrado')
  noEncontrado(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.arqueo.noEncontrado(id, dto, req.usuario?.sub);
  }

  // ---- revisar ----

  @Roles('deposito', 'gerente', 'dueno')
  @Get(':id/revision')
  revision(@Param('id') id: string) {
    return this.arqueo.revision(id);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/a-revision')
  aRevision(@Param('id') id: string) {
    return this.arqueo.aRevision(id);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/reabrir')
  reabrir(@Param('id') id: string) {
    return this.arqueo.reabrir(id);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/reconteo')
  reconteo(@Param('id') id: string, @Body() b: { sku?: string; pedir?: boolean }) {
    return this.arqueo.reconteo(id, String(b?.sku ?? ''), b?.pedir !== false);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post(':id/aplicar')
  aplicar(@Param('id') id: string, @Body() body: { sinContar?: string; autorizacionToken?: string }, @Req() req: any) {
    const autorizadoPor = autorizaSolo(req);
    if (!autorizadoPor && !body?.autorizacionToken) {
      throw new ForbiddenException('Aplicar el arqueo requiere autorización de un supervisor (PIN)');
    }
    return this.arqueo.aplicar(id, body ?? {}, autorizadoPor, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/descartar')
  descartar(@Param('id') id: string) {
    return this.arqueo.descartar(id);
  }
}

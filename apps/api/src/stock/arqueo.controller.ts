import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ArqueoService } from './arqueo.service';
import { autorizaSolo } from './stock.controller';

// Arqueo de stock (24/10/2026). Cuentan cajeros, depósito y backoffice.
// Arman, planifican y revisan administración (Ana y Romina son las responsables,
// Leandro 24/10), gerencia y dueño. Aplicar: ellas, gerencia y dueño sin PIN;
// depósito con el PIN de un supervisor.
// Aplicar ajusta stock en masa: depósito puede hacerlo solo con el PIN de un
// supervisor (token de un solo uso de /caja/autorizar).
@Controller('stock/arqueos')
export class ArqueoController {
  constructor(private readonly arqueo: ArqueoService) {}

  @Roles('administrativo', 'gerente', 'dueno')
  @Post()
  crear(@Body() dto: any, @Req() req: any) {
    return this.arqueo.crear(dto, req.usuario?.sub);
  }

  // ---- plan de conteo por rubro (la planilla de la pared) ----

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get('plan')
  plan(@Query('sucursalId') sucursalId: string, @Query('mes') mes?: string) {
    return this.arqueo.plan(sucursalId, mes);
  }

  @Roles('administrativo', 'gerente', 'dueno')
  @Post('plan/asignar')
  asignar(@Body() dto: any, @Req() req: any) {
    return this.arqueo.asignar(dto, req.usuario?.sub);
  }

  @Roles('administrativo', 'gerente', 'dueno')
  @Post('plan/repartir')
  repartir(@Body() dto: any, @Req() req: any) {
    return this.arqueo.repartirMes(dto, req.usuario?.sub);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get('plan/mi-semana')
  miSemana(@Query('sucursalId') sucursalId: string, @Query('persona') persona: string) {
    return this.arqueo.miSemana(sucursalId, persona);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post('plan/empezar')
  empezar(@Body() dto: any, @Req() req: any) {
    return this.arqueo.empezarRubro(dto, req.usuario?.sub);
  }

  @Roles('administrativo', 'gerente', 'dueno')
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
  @Get(':id/faltan')
  faltan(@Param('id') id: string) {
    return this.arqueo.faltan(id);
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

  @Roles('administrativo', 'gerente', 'dueno')
  @Post(':id/a-revision')
  aRevision(@Param('id') id: string) {
    return this.arqueo.aRevision(id);
  }

  @Roles('administrativo', 'gerente', 'dueno')
  @Post(':id/reabrir')
  reabrir(@Param('id') id: string) {
    return this.arqueo.reabrir(id);
  }

  @Roles('administrativo', 'gerente', 'dueno')
  @Post(':id/reconteo')
  reconteo(@Param('id') id: string, @Body() b: { sku?: string; pedir?: boolean }) {
    return this.arqueo.reconteo(id, String(b?.sku ?? ''), b?.pedir !== false);
  }

  @Roles('deposito', 'administrativo', 'gerente', 'dueno')
  @Post(':id/aplicar')
  aplicar(@Param('id') id: string, @Body() body: { sinContar?: string; autorizacionToken?: string }, @Req() req: any) {
    // las responsables del arqueo (administración: Ana y Romina) aplican sin PIN
    // (Leandro, 24/10/2026: «sacale el pin»); depósito sigue con PIN de supervisor
    const autorizadoPor = autorizaSolo(req) ?? (req?.usuario?.rol === 'administrativo' ? req.usuario.sub : undefined);
    if (!autorizadoPor && !body?.autorizacionToken) {
      throw new ForbiddenException('Aplicar el arqueo requiere autorización de un supervisor (PIN)');
    }
    return this.arqueo.aplicar(id, body ?? {}, autorizadoPor, req.usuario?.sub);
  }

  @Roles('administrativo', 'gerente', 'dueno')
  @Post(':id/descartar')
  descartar(@Param('id') id: string) {
    return this.arqueo.descartar(id);
  }
}

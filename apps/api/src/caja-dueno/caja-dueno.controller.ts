import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { CajaDuenoService } from './caja-dueno.service';

// Caja del dueño (25/11/2026): la puerta es el rol dueño y, adentro, el permiso
// `caja_dueno` de la persona (hoy, solo Juan Pablo). Ver caja-dueno.service.ts.
@Roles('dueno')
@Controller('caja-dueno')
export class CajaDuenoController {
  constructor(private readonly caja: CajaDuenoService) {}

  // para el menú: si la persona la ve
  @Get('permiso')
  async permiso(@Req() req: any) {
    return { puede: await this.caja.puede(req.usuario) };
  }

  @Get()
  async hoja(@Query('desde') desde: string | undefined, @Query('hasta') hasta: string | undefined, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.hoja({ desde, hasta });
  }

  @Post('movimientos')
  async crear(@Body() dto: any, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.crear(dto, req.usuario?.sub);
  }

  @Patch('movimientos/:id')
  async editar(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.editar(id, dto, req.usuario?.sub);
  }

  @Delete('movimientos/:id')
  async borrar(@Param('id') id: string, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.borrar(id, req.usuario?.sub);
  }

  @Post('cuadros')
  async crearCuadro(@Body() dto: any, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.crearCuadro(dto, req.usuario?.sub);
  }

  @Patch('cuadros/:id')
  async renombrarCuadro(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.renombrarCuadro(id, dto);
  }

  @Delete('cuadros/:id')
  async quitarCuadro(@Param('id') id: string, @Req() req: any) {
    await this.caja.exigir(req.usuario);
    return this.caja.quitarCuadro(id);
  }
}

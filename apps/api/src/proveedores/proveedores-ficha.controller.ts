import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators';
import { ProveedoresFichaService } from './proveedores-ficha.service';
import { LogosSemanalService } from './logos-semanal.service';

// Ficha de proveedores (27/10/2026). La carga es de administración (que hereda
// comprador), compras, gerencia y dueño: los mismos que hoy editan el proveedor
// desde Compras.
@Controller('proveedores-ficha')
export class ProveedoresFichaController {
  constructor(private readonly serv: ProveedoresFichaService, private readonly logos: LogosSemanalService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Get()
  lista() {
    return this.serv.lista();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post()
  crear(@Body() dto: any, @Req() req: any) {
    return this.serv.crear(dto ?? {}, req.usuario?.sub);
  }

  // La búsqueda de logos corre sola los lunes; esto la dispara ya (usa IA con búsqueda web)
  @Roles('gerente', 'dueno')
  @Post('logos/buscar')
  buscarLogos(@Body() b: { limite?: number }) {
    return this.logos.buscar(Math.min(Math.max(Number(b?.limite) || 10, 1), 40));
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get(':id')
  ficha(@Param('id') id: string) {
    return this.serv.ficha(id);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Patch(':id')
  guardar(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.serv.guardar(id, dto ?? {}, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/activo')
  activo(@Param('id') id: string, @Body() b: { activo: boolean }, @Req() req: any) {
    return this.serv.activo(id, b?.activo === true, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/contactos')
  agregarContacto(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.serv.agregarContacto(id, dto ?? {}, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Patch('contactos/:cid')
  editarContacto(@Param('cid') cid: string, @Body() dto: any) {
    return this.serv.editarContacto(cid, dto ?? {});
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('contactos/:cid/borrar')
  borrarContacto(@Param('cid') cid: string, @Req() req: any) {
    return this.serv.borrarContacto(cid, req.usuario?.sub);
  }

  // Logo de la marca: imagen hasta 5 MB, o traído de la web del proveedor
  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/logo')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, archivo, cb) => cb(null, /^image\/(jpeg|png|webp|svg\+xml|gif)$/.test(archivo.mimetype)),
    }),
  )
  subirLogo(@Param('id') id: string, @UploadedFile() archivo: Express.Multer.File, @Req() req: any) {
    if (!archivo) throw new BadRequestException('Subí una imagen (JPG, PNG, WEBP o SVG) de hasta 5 MB');
    return this.serv.subirLogo(id, archivo, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/logo/web')
  logoDesdeWeb(@Param('id') id: string, @Req() req: any) {
    return this.serv.logoDesdeWeb(id, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/logo/sacar')
  sacarLogo(@Param('id') id: string, @Req() req: any) {
    return this.serv.sacarLogo(id, req.usuario?.sub);
  }

  // Catálogos, listas, constancias: PDF o imagen, hasta 25 MB
  @Roles('comprador', 'gerente', 'dueno')
  @Post(':id/documentos')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, archivo, cb) => cb(null, /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(archivo.mimetype)),
    }),
  )
  subirDocumento(@Param('id') id: string, @UploadedFile() archivo: Express.Multer.File, @Body() dto: any, @Req() req: any) {
    if (!archivo) throw new BadRequestException('Subí un PDF o una foto (JPG, PNG), de hasta 25 MB');
    return this.serv.subirDocumento(id, archivo, dto ?? {}, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('documentos/:did/enlace')
  enlace(@Param('did') did: string) {
    return this.serv.enlaceDocumento(did);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('documentos/:did/borrar')
  borrarDocumento(@Param('did') did: string, @Req() req: any) {
    return this.serv.borrarDocumento(did, req.usuario?.sub);
  }
}

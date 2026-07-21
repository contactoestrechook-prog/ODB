import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators';
import { RepartidoresService } from './repartidores.service';
import type { CrearRepartidorDto, VehiculoDto } from './repartidores.service';

// Alta de repartidores + vehículos + seguro, y la autorización de ingreso a
// barrios. Solo gerencia/dueño administran; el repartidor no se toca a sí mismo.
@Roles('gerente', 'dueno')
@Controller('gestion/repartidores')
export class RepartidoresController {
  constructor(private readonly serv: RepartidoresService) {}

  @Get()
  listar() {
    return this.serv.listar();
  }

  @Post()
  crear(@Body() dto: CrearRepartidorDto) {
    return this.serv.crear(dto);
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: any) {
    return this.serv.editar(id, dto);
  }

  @Post(':id/vehiculos')
  agregarVehiculo(@Param('id') id: string, @Body() dto: VehiculoDto) {
    return this.serv.agregarVehiculo(id, dto);
  }

  @Patch('vehiculos/:vid')
  editarVehiculo(@Param('vid') vid: string, @Body() dto: Partial<VehiculoDto>) {
    return this.serv.editarVehiculo(vid, dto);
  }

  @Delete('vehiculos/:vid')
  desactivarVehiculo(@Param('vid') vid: string) {
    return this.serv.desactivarVehiculo(vid);
  }

  // Póliza de seguro (PDF/imagen, máx. 8MB)
  @Post('vehiculos/:vid/poliza')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, archivo, cb) => cb(null, /^(image\/|application\/pdf)/.test(archivo.mimetype)),
    }),
  )
  subirPoliza(@Param('vid') vid: string, @UploadedFile() archivo: Express.Multer.File) {
    if (!archivo) throw new BadRequestException('Subí el archivo de la póliza (PDF o imagen, máx. 8MB)');
    return this.serv.subirPoliza(vid, archivo);
  }

  // Asigna repartidor + vehículo a un pedido y devuelve la autorización armada
  @Post('asignar/:pedidoId')
  asignar(@Param('pedidoId') pedidoId: string, @Body() b: { repartidorId: string; vehiculoId?: string }) {
    return this.serv.asignarReparto(pedidoId, b.repartidorId, b.vehiculoId);
  }

  @Get('autorizacion/:pedidoId')
  autorizacion(@Param('pedidoId') pedidoId: string) {
    return this.serv.autorizacion(pedidoId);
  }
}

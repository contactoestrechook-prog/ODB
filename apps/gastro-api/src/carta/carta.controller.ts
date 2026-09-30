import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CartaService } from './carta.service';
import type { ItemCartaInput } from './carta.service';
import { Publico } from '../auth/decorators';

@Controller()
export class CartaController {
  constructor(private readonly carta: CartaService) {}

  // Lo que ve el cliente al escanear el QR de la mesa
  @Publico()
  @Get('carta')
  publica() {
    return this.carta.publica();
  }

  // --- administración: panel de Damián (requiere x-admin-key) ---

  @Get('admin/carta/categorias')
  listarCategorias() {
    return this.carta.listarCategorias();
  }

  @Post('admin/carta/categorias')
  crearCategoria(@Body() body: { nombre: string; orden?: number }) {
    return this.carta.crearCategoria(body.nombre, body.orden);
  }

  @Get('admin/carta/items')
  listarItems() {
    return this.carta.listarItems();
  }

  @Post('admin/carta/items')
  crearItem(@Body() body: ItemCartaInput) {
    return this.carta.crearItem(body);
  }

  @Put('admin/carta/items/:id')
  actualizarItem(@Param('id') id: string, @Body() body: Partial<ItemCartaInput>) {
    return this.carta.actualizarItem(id, body);
  }

  @Delete('admin/carta/items/:id')
  eliminarItem(@Param('id') id: string) {
    return this.carta.eliminarItem(id);
  }
}

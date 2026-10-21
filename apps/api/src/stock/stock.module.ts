import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { supabaseProvider } from '../supabase.provider';
import { CajaModule } from '../caja/caja.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { FraccionesController } from './fracciones.controller';
import { FraccionesService } from './fracciones.service';

@Module({
  // Catálogo: Fraccionar da de alta presentaciones nuevas por el mismo camino
  // que la ficha de productos (ProductosAdminService)
  imports: [CajaModule, CatalogoModule],
  controllers: [StockController, FraccionesController],
  providers: [StockService, FraccionesService, supabaseProvider],
})
export class StockModule {}

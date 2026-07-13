import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { supabaseProvider } from '../supabase.provider';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [CajaModule],
  controllers: [StockController],
  providers: [StockService, supabaseProvider],
})
export class StockModule {}

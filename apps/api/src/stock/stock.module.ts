import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [StockController],
  providers: [StockService, supabaseProvider],
})
export class StockModule {}

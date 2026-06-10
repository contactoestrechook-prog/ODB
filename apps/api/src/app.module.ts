import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogoModule } from './catalogo/catalogo.module';
import { StockModule } from './stock/stock.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CatalogoModule, StockModule],
})
export class AppModule {}

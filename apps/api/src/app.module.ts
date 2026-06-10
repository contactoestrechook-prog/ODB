import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogoModule } from './catalogo/catalogo.module';
import { StockModule } from './stock/stock.module';
import { DescuentosModule } from './descuentos/descuentos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CatalogoModule,
    StockModule,
    DescuentosModule,
  ],
})
export class AppModule {}

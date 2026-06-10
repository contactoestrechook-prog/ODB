import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogoModule } from './catalogo/catalogo.module';
import { StockModule } from './stock/stock.module';
import { DescuentosModule } from './descuentos/descuentos.module';
import { ComprasModule } from './compras/compras.module';
import { VentasModule } from './ventas/ventas.module';
import { AuthModule } from './auth/auth.module';
import { ListasModule } from './listas/listas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CatalogoModule,
    StockModule,
    DescuentosModule,
    ComprasModule,
    VentasModule,
    AuthModule,
    ListasModule,
  ],
})
export class AppModule {}

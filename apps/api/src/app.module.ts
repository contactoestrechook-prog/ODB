import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CatalogoModule } from './catalogo/catalogo.module';
import { StockModule } from './stock/stock.module';
import { DescuentosModule } from './descuentos/descuentos.module';
import { ComprasModule } from './compras/compras.module';
import { VentasModule } from './ventas/ventas.module';
import { AuthModule } from './auth/auth.module';
import { ListasModule } from './listas/listas.module';
import { CajaModule } from './caja/caja.module';
import { SommelierModule } from './sommelier/sommelier.module';
import { AnalistaModule } from './analista/analista.module';
import { ExtrasModule } from './estadisticas/extras.module';
import { PedidosModule } from './pedidos/pedidos.module';

@Module({
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  imports: [
    // límite global de tráfico por IP (anti-abuso); los endpoints de IA
    // tienen límites más estrictos en sus controllers
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ConfigModule.forRoot({ isGlobal: true }),
    CatalogoModule,
    StockModule,
    DescuentosModule,
    ComprasModule,
    VentasModule,
    AuthModule,
    ListasModule,
    CajaModule,
    SommelierModule,
    AnalistaModule,
    ExtrasModule,
    PedidosModule,
  ],
})
export class AppModule {}

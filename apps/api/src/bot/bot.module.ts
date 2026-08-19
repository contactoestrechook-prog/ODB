import { Module } from '@nestjs/common';
import { BotController, BotPruebaController } from './bot.controller';
import { RespondeAppController } from './responde-app.controller';
import { BotService } from './bot.service';
import { supabaseProvider } from '../supabase.provider';
import { PedidosModule } from '../pedidos/pedidos.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ListasModule } from '../listas/listas.module';
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';

@Module({
  imports: [PedidosModule, CatalogoModule, ListasModule, MercadoPagoModule],
  controllers: [BotController, BotPruebaController, RespondeAppController],
  providers: [BotService, supabaseProvider],
})
export class BotModule {}

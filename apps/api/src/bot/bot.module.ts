import { Module } from '@nestjs/common';
import { BotController, BotPruebaController } from './bot.controller';
import { BotService } from './bot.service';
import { supabaseProvider } from '../supabase.provider';
import { PedidosModule } from '../pedidos/pedidos.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ListasModule } from '../listas/listas.module';

@Module({
  imports: [PedidosModule, CatalogoModule, ListasModule],
  controllers: [BotController, BotPruebaController],
  providers: [BotService, supabaseProvider],
})
export class BotModule {}

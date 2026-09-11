import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { AsistenteController } from './asistente.controller';
import { AsistenteService } from './asistente.service';

@Module({
  imports: [CatalogoModule],
  controllers: [AsistenteController],
  providers: [AsistenteService],
})
export class AsistenteModule {}

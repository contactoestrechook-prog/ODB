import { Module } from '@nestjs/common';
import { AnfitrionController } from './anfitrion.controller';
import { AnfitrionService } from './anfitrion.service';
import { CartaModule } from '../carta/carta.module';

@Module({
  imports: [CartaModule],
  controllers: [AnfitrionController],
  providers: [AnfitrionService],
})
export class AnfitrionModule {}

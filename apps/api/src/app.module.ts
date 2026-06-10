import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogoModule } from './catalogo/catalogo.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CatalogoModule],
})
export class AppModule {}

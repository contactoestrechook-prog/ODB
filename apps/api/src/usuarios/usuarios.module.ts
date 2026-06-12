import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService, supabaseProvider],
})
export class UsuariosModule {}

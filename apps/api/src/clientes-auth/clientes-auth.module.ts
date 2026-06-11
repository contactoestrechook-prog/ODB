import { Module } from '@nestjs/common';
import { ClientesAuthController } from './clientes-auth.controller';
import { ClientesAuthService } from './clientes-auth.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ClientesAuthController],
  providers: [ClientesAuthService, supabaseProvider],
})
export class ClientesAuthModule {}

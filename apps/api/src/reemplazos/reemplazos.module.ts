import { Module } from '@nestjs/common';
import { supabaseProvider } from '../supabase.provider';
import { ReemplazosService } from './reemplazos.service';

// «Tengo parecido» y la consulta al cliente (20/11/2026). Lo usan el armado
// (salón) y el bot (la respuesta del cliente). Un solo módulo: la misma
// instancia para los dos.
@Module({
  providers: [ReemplazosService, supabaseProvider],
  exports: [ReemplazosService],
})
export class ReemplazosModule {}

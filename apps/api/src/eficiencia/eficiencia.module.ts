import { Controller, Get, Inject } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE, supabaseProvider } from '../supabase.provider';
import { Roles } from '../auth/decorators';

@Roles('dueno', 'gerente')
@Controller('eficiencia')
export class EficienciaController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get('cajeros')
  async cajeros() {
    const { data, error } = await this.db.rpc('eficiencia_cajeros');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  @Get('preparadores')
  async preparadores() {
    const { data, error } = await this.db.rpc('eficiencia_preparadores');
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}

@Module({
  controllers: [EficienciaController],
  providers: [supabaseProvider],
})
export class EficienciaModule {}

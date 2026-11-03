import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { FrioLector } from './frio.lector';

// La pantalla /frio: los equipos, su serie y cómo anda el lector de QBIT.
@Controller('frio')
@Roles('dueno', 'gerente', 'deposito')
export class FrioController {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly lector: FrioLector,
  ) {}

  // ?horas=24 (de 1 a 744): la serie promediada por tramos. El tramo crece con
  // la ventana para que la pantalla reciba unos pocos miles de puntos por equipo.
  @Get()
  async pantalla(@Query('horas') horasTxt?: string) {
    const horas = Math.min(744, Math.max(1, Number(horasTxt) || 24));
    const paso = horas <= 48 ? 1 : horas <= 168 ? 5 : 30;
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();
    const [eq, serie] = await Promise.all([
      this.db.from('frio_equipos').select('idequipo, codigo, nombre, minimo, maximo, demora_min, orden, sucursal:sucursales(nombre)')
        .eq('activo', true).order('orden'),
      this.db.rpc('frio_serie', { p_desde: desde, p_paso: paso }),
    ]);
    if (eq.error) throw new BadRequestException(eq.error.message);
    if (serie.error) throw new BadRequestException(serie.error.message);
    // la de ahora es la última medición real, no el promedio del tramo
    const ultimas: Record<string, { medido_en: string; temperatura: number }> = {};
    await Promise.all((eq.data ?? []).map(async (e: any) => {
      const { data } = await this.db.from('frio_mediciones').select('medido_en, temperatura')
        .eq('idequipo', e.idequipo).order('medido_en', { ascending: false }).limit(1).maybeSingle();
      if (data) ultimas[e.idequipo] = { medido_en: data.medido_en, temperatura: Number(data.temperatura) };
    }));
    return { ahora: new Date().toISOString(), desde, horas, paso, equipos: eq.data ?? [], serie: serie.data ?? {}, ultimas, lector: this.lector.estado };
  }

  // El mes de un equipo día por día, para Bromatología: ?idequipo=2794&mes=2026-11
  @Get('planilla')
  async planilla(@Query('idequipo') idequipo: string, @Query('mes') mes: string) {
    if (!idequipo || !/^\d{4}-\d{2}$/.test(mes ?? '')) throw new BadRequestException('Falta el equipo o el mes (AAAA-MM)');
    const { data, error } = await this.db.rpc('frio_planilla', { p_idequipo: idequipo, p_mes: `${mes}-01` });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}

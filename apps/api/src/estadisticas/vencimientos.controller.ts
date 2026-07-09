import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

@Roles('deposito', 'comprador', 'gerente', 'dueno')
@Controller('vencimientos')
export class VencimientosController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get()
  async listar() {
    const { data, error } = await this.db
      .from('lotes')
      .select('lote, vencimiento, cantidad, producto:productos(sku, nombre, costo), sucursal:sucursales(nombre)')
      .gt('cantidad', 0)
      .order('vencimiento');
    if (error) throw new BadRequestException(error.message);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const filas = (data ?? [])
      .map((l: any) => {
        const dias = Math.round((new Date(l.vencimiento).getTime() - hoy.getTime()) / 86400_000);
        const estado =
          dias < 0 ? 'vencido' : dias <= 10 ? 'critico' : dias <= 30 ? 'pronto' : 'vigilar';
        // sugerencia comercial: liquidar antes de tirar
        const descuentoSugerido = dias < 0 ? null : dias <= 10 ? 40 : dias <= 30 ? 25 : null;
        const capital = Math.round(Number(l.cantidad) * Number(l.producto?.costo ?? 0));
        return {
          sku: l.producto?.sku,
          producto: l.producto?.nombre,
          sucursal: l.sucursal?.nombre,
          lote: l.lote,
          vencimiento: l.vencimiento,
          dias,
          cantidad: Math.round(Number(l.cantidad)),
          capitalEnRiesgo: capital,
          estado,
          descuentoSugerido,
        };
      })
      .filter((f) => f.dias <= 45);

    return {
      total: filas.length,
      capitalEnRiesgo: filas
        .filter((f) => f.estado === 'critico' || f.estado === 'vencido')
        .reduce((s, f) => s + f.capitalEnRiesgo, 0),
      lotes: filas,
    };
  }
}

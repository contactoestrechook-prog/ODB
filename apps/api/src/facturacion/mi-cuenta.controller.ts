import { BadRequestException, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// Lo que el cliente ve de SU cuenta en la app (token con rol 'cliente')
@Roles('cliente')
@Controller('mi')
export class MiCuentaController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get('cuenta')
  async cuenta(@Req() req: any) {
    const clienteId = req.usuario.sub;
    const [{ data: cliente }, { data: saldo }, { data: movimientos }] = await Promise.all([
      this.db
        .from('clientes')
        .select('cta_cte_habilitada, limite_credito, nombre, razon_social')
        .eq('id', clienteId)
        .single(),
      this.db.rpc('saldo_cuenta', { p_cliente: clienteId }),
      this.db
        .from('cuenta_corriente')
        .select('concepto, debe, haber, creado_en')
        .eq('cliente_id', clienteId)
        .order('id', { ascending: false })
        .limit(50),
    ]);
    if (!cliente) throw new BadRequestException('No existe el cliente');
    const limite = Number(cliente.limite_credito ?? 0);
    const deuda = Number(saldo ?? 0);
    return {
      habilitada: cliente.cta_cte_habilitada === true,
      saldo: deuda,
      limite,
      disponible: limite > 0 ? Math.max(limite - deuda, 0) : null,
      movimientos: movimientos ?? [],
    };
  }

  @Get('notificaciones')
  async notificaciones(@Req() req: any) {
    const { data, error } = await this.db
      .from('notificaciones')
      .select('id, titulo, cuerpo, leida, creado_en')
      .eq('cliente_id', req.usuario.sub)
      .order('id', { ascending: false })
      .limit(40);
    if (error) throw new BadRequestException(error.message);
    return {
      noLeidas: (data ?? []).filter((n) => !n.leida).length,
      notificaciones: data ?? [],
    };
  }

  @Post('notificaciones/leidas')
  async marcarLeidas(@Req() req: any) {
    await this.db
      .from('notificaciones')
      .update({ leida: true })
      .eq('cliente_id', req.usuario.sub)
      .eq('leida', false);
    return { ok: true };
  }
}

import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Controller('clientes')
export class ClientesController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get()
  async listar(
    @Query('tipo') tipo?: string,
    @Query('buscar') buscar?: string,
    @Query('pagina') paginaParam?: string,
  ) {
    const porPagina = 50;
    const pagina = Math.max(Number(paginaParam ?? 1), 1);

    let query = this.db
      .from('clientes')
      .select('id, dni, nombre, email, telefono, tipo, verificado, puntos, creado_en', {
        count: 'exact',
      });
    if (tipo) query = query.eq('tipo', tipo);
    if (buscar?.trim()) {
      const t = buscar.trim();
      query = query.or(`dni.ilike.%${t}%,nombre.ilike.%${t}%`);
    }
    query = query
      .order('creado_en', { ascending: false })
      .range((pagina - 1) * porPagina, pagina * porPagina - 1);

    const { data, count, error } = await query;
    if (error) throw new BadRequestException(error.message);

    // resumen de compras por cliente (los clientes identificados son pocos
    // relativos a las ventas; se agrega en memoria)
    const ids = (data ?? []).map((c: any) => c.id);
    const compras = new Map<string, { n: number; total: number; ultima: string }>();
    if (ids.length) {
      const { data: ventas } = await this.db
        .from('ventas')
        .select('cliente_id, total, vendida_en')
        .in('cliente_id', ids)
        .eq('estado', 'completada');
      for (const v of (ventas ?? []) as any[]) {
        const acc = compras.get(v.cliente_id) ?? { n: 0, total: 0, ultima: '' };
        acc.n += 1;
        acc.total += Number(v.total);
        if (v.vendida_en > acc.ultima) acc.ultima = v.vendida_en;
        compras.set(v.cliente_id, acc);
      }
    }

    return {
      total: count ?? 0,
      pagina,
      paginas: Math.max(Math.ceil((count ?? 0) / porPagina), 1),
      items: (data ?? []).map((c: any) => {
        const r = compras.get(c.id);
        return {
          ...c,
          compras: r?.n ?? 0,
          totalGastado: Math.round(r?.total ?? 0),
          ticketPromedio: r?.n ? Math.round(r.total / r.n) : 0,
          ultimaCompra: r?.ultima || null,
        };
      }),
    };
  }
}

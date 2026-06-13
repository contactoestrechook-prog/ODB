import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

@Controller('clientes')
export class ClientesController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Edición de datos del cliente: fiscales (para facturar A) y cuenta corriente
  @Roles('dueno', 'gerente')
  @Patch(':id')
  async editar(
    @Param('id') id: string,
    @Body()
    dto: {
      nombre?: string;
      razonSocial?: string;
      cuit?: string;
      condicionIva?: string;
      domicilio?: string;
      telefono?: string;
      email?: string;
      ctaCteHabilitada?: boolean;
      limiteCredito?: number;
    },
  ) {
    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.razonSocial !== undefined) cambios.razon_social = dto.razonSocial;
    if (dto.cuit !== undefined) cambios.cuit = dto.cuit || null;
    if (dto.condicionIva !== undefined) cambios.condicion_iva = dto.condicionIva;
    if (dto.domicilio !== undefined) cambios.domicilio = dto.domicilio;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    if (dto.email !== undefined) cambios.email = dto.email;
    if (dto.ctaCteHabilitada !== undefined) cambios.cta_cte_habilitada = dto.ctaCteHabilitada;
    if (dto.limiteCredito !== undefined) cambios.limite_credito = dto.limiteCredito;
    if (!Object.keys(cambios).length) return { ok: true };

    // habilitar cta cte para facturar A exige CUIT + condición RI
    if (cambios.cta_cte_habilitada === true || cambios.condicion_iva === 'responsable_inscripto') {
      const { data: actual } = await this.db
        .from('clientes')
        .select('cuit, condicion_iva')
        .eq('id', id)
        .single();
      const cuit = cambios.cuit ?? actual?.cuit;
      const cond = cambios.condicion_iva ?? actual?.condicion_iva;
      if (cond === 'responsable_inscripto' && !cuit) {
        throw new BadRequestException('Un responsable inscripto necesita CUIT cargado');
      }
    }

    const { error } = await this.db.from('clientes').update(cambios).eq('id', id);
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? 'Ese CUIT ya está en otro cliente' : error.message,
      );
    }
    return { ok: true };
  }

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
      .select('id, dni, cuit, nombre, razon_social, condicion_iva, domicilio, email, telefono, tipo, verificado, puntos, cta_cte_habilitada, limite_credito, creado_en', {
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

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
      aceptaMarketing?: boolean;
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
    if (dto.aceptaMarketing !== undefined) {
      cambios.acepta_marketing = dto.aceptaMarketing;
      cambios.marketing_optout_en = dto.aceptaMarketing ? null : new Date().toISOString();
    }
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

  @Get('resumen')
  async resumen() {
    const { data, error } = await this.db
      .from('clientes')
      .select('tipo, verificado, acepta_marketing, cta_cte_habilitada, fecha_nacimiento');
    if (error) throw new BadRequestException(error.message);
    const c = (data ?? []) as any[];
    const mesActual = new Date().getMonth();
    const porTipo: Record<string, number> = {};
    for (const x of c) porTipo[x.tipo] = (porTipo[x.tipo] ?? 0) + 1;
    return {
      total: c.length,
      comunidad: c.filter((x) => x.verificado).length,
      optInMarketing: c.filter((x) => x.acepta_marketing).length,
      conCtaCte: c.filter((x) => x.cta_cte_habilitada).length,
      cumpleMes: c.filter((x) => x.fecha_nacimiento && new Date(x.fecha_nacimiento).getMonth() === mesActual).length,
      porTipo,
    };
  }

  // Clientes a reactivar (sin compra hace >N días) y cumpleaños del mes
  @Get('reactivacion')
  async reactivacion(@Query('dias') diasParam?: string) {
    const dias = Number(diasParam ?? 60);
    const corte = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data: clientes } = await this.db
      .from('clientes')
      .select('id, dni, nombre, telefono, tipo, acepta_marketing, fecha_nacimiento')
      .limit(5000);
    const ids = (clientes ?? []).map((c: any) => c.id);
    const ultima = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: v } = await this.db
        .from('ventas')
        .select('cliente_id, vendida_en')
        .in('cliente_id', ids.slice(i, i + 200))
        .eq('estado', 'completada');
      for (const r of (v ?? []) as any[]) {
        if (!ultima.has(r.cliente_id) || r.vendida_en > ultima.get(r.cliente_id)!) ultima.set(r.cliente_id, r.vendida_en);
      }
    }
    const mes = new Date().getMonth();
    const reactivar = (clientes ?? [])
      .map((c: any) => ({ ...c, ultimaCompra: ultima.get(c.id) ?? null }))
      .filter((c: any) => c.ultimaCompra && c.ultimaCompra < corte)
      .sort((a: any, b: any) => (a.ultimaCompra < b.ultimaCompra ? -1 : 1))
      .slice(0, 100);
    const cumple = (clientes ?? [])
      .filter((c: any) => c.fecha_nacimiento && new Date(c.fecha_nacimiento).getMonth() === mes)
      .map((c: any) => ({ id: c.id, nombre: c.nombre, dni: c.dni, telefono: c.telefono, fecha_nacimiento: c.fecha_nacimiento }));
    return { dias, reactivar, cumple };
  }

  @Get()
  async listar(
    @Query('tipo') tipo?: string,
    @Query('buscar') buscar?: string,
    @Query('filtro') filtro?: string,
    @Query('pagina') paginaParam?: string,
  ) {
    const porPagina = 50;
    const pagina = Math.max(Number(paginaParam ?? 1), 1);

    let query = this.db
      .from('clientes')
      .select('id, dni, cuit, nombre, razon_social, condicion_iva, domicilio, email, telefono, tipo, verificado, puntos, cta_cte_habilitada, limite_credito, acepta_marketing, fecha_nacimiento, creado_en', {
        count: 'exact',
      });
    if (tipo) query = query.eq('tipo', tipo);
    if (filtro === 'comunidad') query = query.eq('verificado', true);
    if (filtro === 'marketing') query = query.eq('acepta_marketing', true);
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

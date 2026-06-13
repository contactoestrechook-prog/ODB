import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type CrearDescuentoDto = {
  nombre: string;
  alcance: 'global' | 'categoria' | 'marca' | 'producto';
  tipo: 'porcentaje' | 'monto_fijo' | 'precio_fijo';
  valor: number;
  desde: string;
  hasta: string;
  categoriaId?: string;
  marcaId?: string;
  sku?: string;
  segmento?: string;
  medioPago?: string;
  combinable?: boolean;
  soloComunidad?: boolean;
};

// Segmentos de comportamiento (no socioeconómicos): se derivan de la conducta
// de compra del cliente. El ticket promedio de cada uno guía qué promo conviene.
const SEGMENTOS = ['nuevo', 'ocasional', 'frecuente', 'mayorista', 'vip'] as const;

const ETIQUETA_SEGMENTO: Record<string, string> = {
  nuevo: 'Nuevos',
  ocasional: 'Ocasionales',
  frecuente: 'Frecuentes',
  mayorista: 'Mayoristas',
  vip: 'VIP',
};

@Injectable()
export class DescuentosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Ticket promedio y volumen por segmento, para decidir la promo de cada uno
  async segmentos() {
    // clientes por segmento (paginado; escala a miles)
    const clientes: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await this.db
        .from('clientes')
        .select('id, tipo')
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      clientes.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const idTipo = new Map(clientes.map((c) => [c.id, c.tipo]));
    const acc = new Map(SEGMENTOS.map((s) => [s, { clientes: 0, suma: 0, n: 0 }]));
    for (const c of clientes) {
      const a = acc.get(c.tipo);
      if (a) a.clientes += 1;
    }

    // ventas de clientes identificados (las anónimas no suman a ningún segmento)
    const ventas: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data } = await this.db
        .from('ventas')
        .select('total, cliente_id')
        .eq('estado', 'completada')
        .not('cliente_id', 'is', null)
        .range(desde, desde + 999);
      ventas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    for (const v of ventas) {
      const a = acc.get(idTipo.get(v.cliente_id));
      if (a) {
        a.suma += Number(v.total);
        a.n += 1;
      }
    }

    // referencia general: promedio de los últimos 1000 tickets
    const { data: recientes } = await this.db
      .from('ventas')
      .select('total')
      .eq('estado', 'completada')
      .order('vendida_en', { ascending: false })
      .limit(1000);
    const ticketGeneral = recientes?.length
      ? Math.round(recientes.reduce((s, v) => s + Number(v.total), 0) / recientes.length)
      : 0;

    return {
      ticketGeneral,
      segmentos: SEGMENTOS.map((s) => {
        const a = acc.get(s)!;
        return {
          segmento: s,
          etiqueta: ETIQUETA_SEGMENTO[s],
          clientes: a.clientes,
          ventasIdentificadas: a.n,
          ticketPromedio: a.n ? Math.round(a.suma / a.n) : null,
        };
      }),
    };
  }

  async listar() {
    const { data, error } = await this.db
      .from('descuentos')
      .select(
        '*, categoria:categorias(nombre), marca:marcas(nombre), producto:productos(sku, nombre)',
      )
      .order('desde', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const ahora = new Date().toISOString();
    return (data ?? []).map((d) => ({
      ...d,
      estado: !d.activo
        ? 'inactivo'
        : ahora < d.desde
          ? 'programado'
          : ahora > d.hasta
            ? 'vencido'
            : 'vigente',
    }));
  }

  async crear(dto: CrearDescuentoDto) {
    let productoId: string | null = null;
    if (dto.alcance === 'producto') {
      const { data } = await this.db
        .from('productos')
        .select('id')
        .eq('sku', dto.sku ?? '')
        .maybeSingle();
      if (!data) throw new BadRequestException(`No existe el producto ${dto.sku}`);
      productoId = data.id;
    }
    const { data, error } = await this.db
      .from('descuentos')
      .insert({
        nombre: dto.nombre,
        alcance: dto.alcance,
        tipo: dto.tipo,
        valor: dto.valor,
        desde: dto.desde,
        hasta: dto.hasta,
        categoria_id: dto.categoriaId ?? null,
        marca_id: dto.marcaId ?? null,
        producto_id: productoId,
        segmento: dto.segmento ?? null,
        medio_pago: dto.medioPago ?? null,
        combinable: dto.combinable ?? false,
        // solo se manda si es true: así no rompe antes de aplicar la migración
        ...(dto.soloComunidad ? { solo_comunidad: true } : {}),
      })
      .select('id')
      .single();
    if (error) {
      const msg = error.message.includes('row-level security')
        ? 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env'
        : error.message;
      throw new BadRequestException(msg);
    }
    return { descuentoId: data.id };
  }

  async cambiarEstado(id: string, activo: boolean) {
    const { error } = await this.db.from('descuentos').update({ activo }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}

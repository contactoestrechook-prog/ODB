import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

const SELECT_PRODUCTO = `
  id, sku, nombre, volumen_ml, unidades_pack, graduacion, es_alcohol, costo, activo,
  marca:marcas ( nombre ),
  categoria:categorias ( nombre ),
  stock ( sucursal_id, cantidad, stock_minimo ),
  precios ( precio, vigente_desde, lista_id ),
  codigos_barras ( codigo )
`;

@Injectable()
export class CatalogoService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async buscarProductos(buscar?: string, limite = 50) {
    let query = this.db
      .from('productos')
      .select(SELECT_PRODUCTO)
      .eq('activo', true)
      .order('nombre')
      .limit(Math.min(limite, 200));

    if (buscar?.trim()) {
      const termino = buscar.trim();
      // Si es numérico largo, asumimos código de barras
      if (/^\d{8,14}$/.test(termino)) {
        const { data: cb } = await this.db
          .from('codigos_barras')
          .select('producto_id')
          .eq('codigo', termino)
          .maybeSingle();
        query = query.eq('id', cb?.producto_id ?? '00000000-0000-0000-0000-000000000000');
      } else {
        query = query.ilike('nombre', `%${termino}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => this.formatear(p));
  }

  async obtenerPorSku(sku: string) {
    const { data, error } = await this.db
      .from('productos')
      .select(SELECT_PRODUCTO)
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException(`No existe el producto ${sku}`);
    return this.formatear(data);
  }

  async sucursales() {
    const { data, error } = await this.db
      .from('sucursales')
      .select('id, nombre, direccion, lat, lng')
      .eq('activa', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    return data;
  }

  private formatear(p: any) {
    // Precio vigente: el más reciente de la lista minorista
    const precioVigente = (p.precios ?? [])
      .sort((a: any, b: any) => b.vigente_desde.localeCompare(a.vigente_desde))[0]?.precio ?? null;
    const stockTotal = (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0);
    return {
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca?.nombre ?? null,
      categoria: p.categoria?.nombre ?? null,
      volumenMl: p.volumen_ml,
      unidadesPack: p.unidades_pack,
      esAlcohol: p.es_alcohol,
      precio: precioVigente,
      stockTotal,
      stockPorSucursal: p.stock ?? [],
      codigosBarras: (p.codigos_barras ?? []).map((c: any) => c.codigo),
    };
  }
}

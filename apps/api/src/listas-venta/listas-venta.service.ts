import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Gestión de las listas de precios de VENTA (Minorista, Por caja, Mayorista,
// Eventos). El nombre y el % sobre Minorista son editables; "regenerar" recalcula
// los precios de la lista desde el precio Minorista de cada producto.
@Injectable()
export class ListasVentaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db
      .from('listas_precios')
      .select('id, nombre, ajuste_pct, es_base, activa, orden')
      .order('orden');
    if (error) throw new BadRequestException(error.message);
    const listas = data ?? [];
    // cuántos productos tienen precio cargado en cada lista (informativo)
    const conteos = await Promise.all(
      listas.map(async (l: any) => {
        const { count } = await this.db
          .from('precios')
          .select('producto_id', { count: 'exact', head: true })
          .eq('lista_id', l.id);
        return [l.id, count ?? 0] as const;
      }),
    );
    const porLista = new Map(conteos);
    return listas.map((l: any) => ({
      id: l.id,
      nombre: l.nombre,
      ajustePct: Number(l.ajuste_pct ?? 0),
      esBase: l.es_base,
      activa: l.activa,
      productosConPrecio: porLista.get(l.id) ?? 0,
    }));
  }

  async editar(id: string, dto: { nombre?: string; ajustePct?: number; activa?: boolean }) {
    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) {
      if (!dto.nombre.trim()) throw new BadRequestException('El nombre no puede quedar vacío');
      cambios.nombre = dto.nombre.trim();
    }
    if (dto.ajustePct !== undefined) cambios.ajuste_pct = Number(dto.ajustePct) || 0;
    if (dto.activa !== undefined) cambios.activa = dto.activa;
    if (!Object.keys(cambios).length) return { ok: true };
    // no dejamos renombrar la base a algo que rompa precio_vigente si aún la referencia por nombre
    const { error } = await this.db.from('listas_precios').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.code === '23505' ? 'Ya existe una lista con ese nombre' : error.message);
    return { ok: true };
  }

  // Recalcula los precios de la lista desde Minorista × (1 + ajuste%).
  async regenerar(id: string) {
    const { data, error } = await this.db.rpc('regenerar_lista_precios', { p_lista: id });
    if (error) throw new BadRequestException(error.message);
    return { generados: Number(data ?? 0) };
  }
}

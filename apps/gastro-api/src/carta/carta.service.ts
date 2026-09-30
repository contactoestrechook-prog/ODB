import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type ItemCartaInput = {
  categoriaId: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  imagenUrl?: string;
  activo?: boolean;
  orden?: number;
  tiempoCoccionMin?: number | null;
};

@Injectable()
export class CartaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // La carta es igual para todos los que escanean el QR: caché corto (30 s) para
  // no golpear la base en el pico del sábado a la noche.
  private cache: { data: any; ts: number } | null = null;

  async publica() {
    if (this.cache && Date.now() - this.cache.ts < 30_000) return this.cache.data;
    const { data: categorias, error } = await this.db
      .from('carta_categorias')
      .select('id, nombre, orden, items:carta_items(id, nombre, descripcion, precio, imagen_url, orden, activo)')
      .order('orden');
    if (error) throw new BadRequestException(error.message);

    const resultado = {
      categorias: (categorias ?? []).map((c: any) => ({
        id: c.id,
        nombre: c.nombre,
        items: (c.items ?? [])
          .filter((i: any) => i.activo)
          .sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0))
          .map((i: any) => ({
            id: i.id,
            nombre: i.nombre,
            descripcion: i.descripcion,
            precio: Number(i.precio),
            imagenUrl: i.imagen_url,
          })),
      })),
    };
    this.cache = { data: resultado, ts: Date.now() };
    return resultado;
  }

  invalidarCache() {
    this.cache = null;
  }

  // --- administración (protegida por AdminKeyGuard) ---

  async listarCategorias() {
    const { data, error } = await this.db.from('carta_categorias').select('*').order('orden');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearCategoria(nombre: string, orden = 0) {
    const { data, error } = await this.db
      .from('carta_categorias')
      .insert({ nombre, orden })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    this.invalidarCache();
    return data;
  }

  async listarItems() {
    const { data, error } = await this.db
      .from('carta_items')
      .select('*, categoria:carta_categorias(nombre)')
      .order('orden');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearItem(input: ItemCartaInput) {
    const { data, error } = await this.db
      .from('carta_items')
      .insert({
        categoria_id: input.categoriaId,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        precio: input.precio,
        imagen_url: input.imagenUrl ?? null,
        activo: input.activo ?? true,
        orden: input.orden ?? 0,
        tiempo_coccion_min: input.tiempoCoccionMin ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    this.invalidarCache();
    return data;
  }

  async actualizarItem(id: string, input: Partial<ItemCartaInput>) {
    const patch: Record<string, any> = {};
    if (input.categoriaId !== undefined) patch.categoria_id = input.categoriaId;
    if (input.nombre !== undefined) patch.nombre = input.nombre;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion;
    if (input.precio !== undefined) patch.precio = input.precio;
    if (input.imagenUrl !== undefined) patch.imagen_url = input.imagenUrl;
    if (input.activo !== undefined) patch.activo = input.activo;
    if (input.orden !== undefined) patch.orden = input.orden;
    if (input.tiempoCoccionMin !== undefined) patch.tiempo_coccion_min = input.tiempoCoccionMin;

    const { data, error } = await this.db.from('carta_items').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese ítem de carta');
    this.invalidarCache();
    return data;
  }

  async eliminarItem(id: string) {
    const { error } = await this.db.from('carta_items').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    this.invalidarCache();
    return { ok: true };
  }
}

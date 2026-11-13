import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

// Los 14 alérgenos de declaración habitual, con la clave que guarda la base.
export const ALERGENOS = [
  'gluten', 'lacteos', 'huevo', 'pescado', 'crustaceos', 'moluscos', 'frutos_secos',
  'mani', 'soja', 'sesamo', 'mostaza', 'apio', 'sulfitos', 'altramuces',
] as const;
export const ETIQUETAS = ['sin_tacc', 'vegetariano', 'vegano', 'picante'] as const;

export type ItemCartaInput = {
  categoriaId: string;
  nombre: string;
  nombrePt?: string | null;
  nombreEn?: string | null;
  descripcion?: string | null;
  descripcionPt?: string | null;
  descripcionEn?: string | null;
  precio: number;
  costo?: number | null;
  imagenUrl?: string | null;
  alergenos?: string[];
  etiquetas?: string[];
  activo?: boolean;
  agotado?: boolean;
  orden?: number;
  tiempoCoccionMin?: number | null;
  corteId?: string | null;
  gramosPorcion?: number | null;
};

// nombre del campo que llega del panel → columna de la base
const COLUMNAS: Record<keyof ItemCartaInput, string> = {
  categoriaId: 'categoria_id', nombre: 'nombre', nombrePt: 'nombre_pt', nombreEn: 'nombre_en',
  descripcion: 'descripcion', descripcionPt: 'descripcion_pt', descripcionEn: 'descripcion_en',
  precio: 'precio', costo: 'costo', imagenUrl: 'imagen_url', alergenos: 'alergenos', etiquetas: 'etiquetas',
  activo: 'activo', agotado: 'agotado', orden: 'orden', tiempoCoccionMin: 'tiempo_coccion_min',
  corteId: 'corte_id', gramosPorcion: 'gramos_porcion',
};

function aColumnas(input: Partial<ItemCartaInput>) {
  const fila: Record<string, any> = {};
  for (const [campo, columna] of Object.entries(COLUMNAS)) {
    const valor = (input as any)[campo];
    if (valor === undefined) continue;
    if (campo === 'alergenos') fila[columna] = (valor as string[]).filter((a) => (ALERGENOS as readonly string[]).includes(a));
    else if (campo === 'etiquetas') fila[columna] = (valor as string[]).filter((e) => (ETIQUETAS as readonly string[]).includes(e));
    else fila[columna] = valor === '' ? null : valor;
  }
  return fila;
}

@Injectable()
export class CartaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // La carta es igual para todos los que escanean el QR: caché corto (30 s) para
  // no golpear la base en el pico del sábado a la noche.
  private cache: { data: any; ts: number } | null = null;

  // Trae los tres idiomas y el cambio de la casa: el teléfono del cliente
  // elige qué mostrar, así cambiar de idioma o de moneda no vuelve al servidor.
  async publica() {
    if (this.cache && Date.now() - this.cache.ts < 30_000) return this.cache.data;
    const [cats, cfg] = await Promise.all([
      this.db
        .from('carta_categorias')
        .select(
          'id, nombre, nombre_pt, nombre_en, orden, items:carta_items(id, nombre, nombre_pt, nombre_en, descripcion, descripcion_pt, descripcion_en, precio, imagen_url, alergenos, etiquetas, orden, activo, agotado)',
        )
        .order('orden'),
      this.db.from('configuracion').select('cambio_brl, cambio_usd, cambio_actualizado_en').eq('id', true).single(),
    ]);
    if (cats.error) throw new BadRequestException(cats.error.message);

    const resultado = {
      cambio: {
        BRL: cfg.data?.cambio_brl != null ? Number(cfg.data.cambio_brl) : null,
        USD: cfg.data?.cambio_usd != null ? Number(cfg.data.cambio_usd) : null,
        actualizadoEn: cfg.data?.cambio_actualizado_en ?? null,
      },
      categorias: (cats.data ?? []).map((c: any) => ({
        id: c.id,
        nombre: c.nombre,
        nombrePt: c.nombre_pt,
        nombreEn: c.nombre_en,
        items: (c.items ?? [])
          .filter((i: any) => i.activo)
          .sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0))
          .map((i: any) => ({
            id: i.id,
            nombre: i.nombre,
            nombrePt: i.nombre_pt,
            nombreEn: i.nombre_en,
            descripcion: i.descripcion,
            descripcionPt: i.descripcion_pt,
            descripcionEn: i.descripcion_en,
            precio: Number(i.precio),
            imagenUrl: i.imagen_url,
            alergenos: i.alergenos ?? [],
            etiquetas: i.etiquetas ?? [],
            agotado: !!i.agotado,
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
    const { data, error } = await this.db.from('carta_categorias').insert({ nombre, orden }).select().single();
    if (error) throw new BadRequestException(error.message);
    this.invalidarCache();
    return data;
  }

  async actualizarCategoria(id: string, patch: { nombre?: string; nombrePt?: string | null; nombreEn?: string | null; orden?: number }) {
    const fila: Record<string, any> = {};
    if (patch.nombre !== undefined) fila.nombre = patch.nombre;
    if (patch.nombrePt !== undefined) fila.nombre_pt = patch.nombrePt || null;
    if (patch.nombreEn !== undefined) fila.nombre_en = patch.nombreEn || null;
    if (patch.orden !== undefined) fila.orden = patch.orden;
    const { data, error } = await this.db.from('carta_categorias').update(fila).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe esa categoría');
    this.invalidarCache();
    return data;
  }

  async listarItems() {
    const { data, error } = await this.db
      .from('carta_items')
      .select('*, categoria:carta_categorias(nombre), corte:cortes(nombre)')
      .order('orden');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearItem(input: ItemCartaInput) {
    if (!input.categoriaId || !input.nombre?.trim()) throw new BadRequestException('Falta la categoría o el nombre');
    if (!(Number(input.precio) > 0)) throw new BadRequestException('Poné el precio en pesos');
    const { data, error } = await this.db.from('carta_items').insert(aColumnas(input)).select().single();
    if (error) throw new BadRequestException(error.message);
    this.invalidarCache();
    return data;
  }

  async actualizarItem(id: string, input: Partial<ItemCartaInput>) {
    const { data, error } = await this.db.from('carta_items').update(aColumnas(input)).eq('id', id).select().maybeSingle();
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

  // Propone el nombre y la descripción en portugués y en inglés. No guarda
  // nada: devuelve el texto para que lo revise quien carga la carta. Cada
  // toque es una llamada a la IA (centavos de dólar), por eso es un botón.
  async sugerirTraduccion(id: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Para traducir con IA falta ANTHROPIC_API_KEY. Podés escribir la traducción a mano.');
    }
    const { data: item, error } = await this.db.from('carta_items').select('nombre, descripcion').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!item) throw new NotFoundException('No existe ese ítem de carta');

    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 400,
      system:
        'Traducís la carta de un asador argentino de Puerto Iguazú para turistas. Devolvé SOLO un JSON con las claves nombrePt, descripcionPt, nombreEn, descripcionEn. Portugués de Brasil e inglés. Los cortes argentinos conservan su nombre y llevan el equivalente entre paréntesis (por ejemplo "Vacío (fraldinha)" en portugués, "Vacío (flank steak)" en inglés). No agregues ingredientes que no estén en el original. Si no hay descripción, devolvé cadena vacía.',
      messages: [{ role: 'user', content: JSON.stringify({ nombre: item.nombre, descripcion: item.descripcion ?? '' }) }],
    });
    const bloque = respuesta.content.find((b) => b.type === 'text');
    const texto = bloque && 'text' in bloque ? bloque.text : '';
    try {
      const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      return {
        nombrePt: String(json.nombrePt ?? ''), descripcionPt: String(json.descripcionPt ?? ''),
        nombreEn: String(json.nombreEn ?? ''), descripcionEn: String(json.descripcionEn ?? ''),
      };
    } catch {
      throw new BadRequestException('La IA no devolvió una traducción que se pueda leer. Probá de nuevo o escribila a mano.');
    }
  }
}

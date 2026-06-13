import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from './catalogo.service';

export type CrearProductoDto = {
  nombre: string;
  rubro?: string; // nombre de categoría: si no existe, se crea
  marca?: string; // ídem
  sku?: string; // vacío = se asigna el siguiente número libre
  codigoBarras?: string;
  esAlcohol?: boolean;
  volumenMl?: number | null;
  costo?: number | null;
  precio?: number | null;
  stockInicial?: { sucursalId: string; cantidad: number }[];
};

export type EditarProductoDto = {
  nombre?: string;
  rubro?: string;
  marca?: string | null;
  esAlcohol?: boolean;
  activo?: boolean;
  volumenMl?: number | null;
  costo?: number | null;
  precio?: number | null; // crea un nuevo precio vigente en la lista Minorista
  codigoBarras?: string; // agrega un código al producto
};

@Injectable()
export class ProductosAdminService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly catalogo: CatalogoService,
  ) {}

  async crear(dto: CrearProductoDto, usuarioId?: string) {
    if (!dto.nombre?.trim()) throw new BadRequestException('El nombre es obligatorio');

    const sku = dto.sku?.trim() || (await this.siguienteSku());
    const [categoriaId, marcaId] = await Promise.all([
      this.idCategoria(dto.rubro),
      this.idMarca(dto.marca),
    ]);

    const { data: producto, error } = await this.db
      .from('productos')
      .insert({
        sku,
        nombre: dto.nombre.trim(),
        categoria_id: categoriaId,
        marca_id: marcaId,
        es_alcohol: dto.esAlcohol ?? false,
        volumen_ml: dto.volumenMl ?? null,
        costo: dto.costo ?? null,
        activo: true,
      })
      .select('id, sku')
      .single();
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? `Ya existe un producto con el SKU ${sku}` : error.message,
      );
    }

    // renglones de stock en cero para ambas sucursales (el stock real entra por movimientos)
    const { data: sucursales } = await this.db.from('sucursales').select('id');
    await this.db
      .from('stock')
      .insert((sucursales ?? []).map((s) => ({ producto_id: producto.id, sucursal_id: s.id })));

    if (dto.codigoBarras?.trim()) {
      await this.db
        .from('codigos_barras')
        .insert({ codigo: dto.codigoBarras.trim(), producto_id: producto.id });
    }
    if (dto.precio != null && dto.precio > 0) {
      await this.fijarPrecio(producto.id, dto.precio, usuarioId);
    }
    for (const s of dto.stockInicial ?? []) {
      if (Number(s.cantidad) > 0) {
        const { error: errMov } = await this.db.rpc('registrar_movimiento', {
          p_producto_id: producto.id,
          p_sucursal_id: s.sucursalId,
          p_tipo: 'ajuste',
          p_cantidad: Number(s.cantidad),
          p_motivo: 'Stock inicial (alta manual)',
        });
        if (errMov) throw new BadRequestException(errMov.message);
      }
    }

    this.catalogo.invalidarFotos(); // limpia el caché del catálogo
    return { id: producto.id, sku: producto.sku };
  }

  async editar(id: string, dto: EditarProductoDto, usuarioId?: string) {
    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) {
      if (!dto.nombre.trim()) throw new BadRequestException('El nombre no puede quedar vacío');
      cambios.nombre = dto.nombre.trim();
    }
    if (dto.rubro !== undefined) cambios.categoria_id = await this.idCategoria(dto.rubro);
    if (dto.marca !== undefined) cambios.marca_id = await this.idMarca(dto.marca ?? undefined);
    if (dto.esAlcohol !== undefined) cambios.es_alcohol = dto.esAlcohol;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (dto.volumenMl !== undefined) cambios.volumen_ml = dto.volumenMl;
    if (dto.costo !== undefined) cambios.costo = dto.costo;

    if (Object.keys(cambios).length) {
      const { error } = await this.db.from('productos').update(cambios).eq('id', id);
      if (error) throw new BadRequestException(error.message);
    }
    if (dto.precio != null && dto.precio > 0) {
      await this.fijarPrecio(id, dto.precio, usuarioId);
    }
    if (dto.codigoBarras?.trim()) {
      const { error } = await this.db
        .from('codigos_barras')
        .insert({ codigo: dto.codigoBarras.trim(), producto_id: id });
      if (error && error.code !== '23505') throw new BadRequestException(error.message);
    }

    this.catalogo.invalidarFotos();
    return { ok: true };
  }

  // el precio canónico vive en la tabla precios: cada cambio es una vigencia nueva
  private async fijarPrecio(productoId: string, precio: number, usuarioId?: string) {
    const { data: lista } = await this.db
      .from('listas_precios')
      .select('id')
      .eq('nombre', 'Minorista')
      .single();
    if (!lista) throw new BadRequestException('No existe la lista de precios Minorista');
    const { error } = await this.db.from('precios').insert({
      lista_id: lista.id,
      producto_id: productoId,
      precio,
      creado_por: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
  }

  private async idCategoria(nombre?: string): Promise<string | null> {
    if (!nombre?.trim()) return null;
    const limpio = nombre.trim();
    const { data } = await this.db.from('categorias').select('id').ilike('nombre', limpio).maybeSingle();
    if (data) return data.id;
    const { data: nueva, error } = await this.db
      .from('categorias')
      .insert({ nombre: limpio })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return nueva.id;
  }

  private async idMarca(nombre?: string): Promise<string | null> {
    if (!nombre?.trim()) return null;
    const limpio = nombre.trim();
    const { data } = await this.db.from('marcas').select('id').ilike('nombre', limpio).maybeSingle();
    if (data) return data.id;
    const { data: nueva, error } = await this.db
      .from('marcas')
      .insert({ nombre: limpio })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return nueva.id;
  }

  // SKUs reales son numéricos: el siguiente es max + 1
  private async siguienteSku(): Promise<string> {
    const { data } = await this.db.rpc('siguiente_sku');
    if (data) return String(data);
    // fallback si la función no existe todavía
    return String(Date.now()).slice(-8);
  }
}

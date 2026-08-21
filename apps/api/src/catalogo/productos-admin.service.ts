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
  // varios códigos: el de la unidad y el del bulto suelen ser distintos
  codigosBarras?: string[];
  esAlcohol?: boolean;
  volumenMl?: number | null;
  costo?: number | null;
  precio?: number | null;
  stockInicial?: { sucursalId: string; cantidad: number; minimo?: number; reposicion?: number }[];
  // ficha completa
  descripcion?: string;
  unidadesPack?: number | null;
  graduacion?: number | null;
  controlaVencimiento?: boolean;
  alicuotaIva?: number | null;
  aliasBusqueda?: string; // cómo lo pide el cliente: lo usa el buscador y el bot
  // precios de las otras listas (la base es Minorista)
  precioCaja?: number | null;
  precioMayorista?: number | null;
  // qué proveedores lo traen, con su código y su último costo
  proveedores?: { proveedorId: string; codigoProveedor?: string; costo?: number | null; margenPct?: number | null }[];
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

  // Antes de crear: ¿ese código de barras ya es de alguien? ¿hay un producto que
  // se llama casi igual? Un catálogo con el mismo producto cargado dos veces
  // rompe el stock, los pedidos y lo que contesta el bot, y arreglarlo después
  // es a mano. Se avisa mientras escriben, no cuando ya está hecho.
  async revisar(dto: { codigo?: string; nombre?: string }) {
    const salida: {
      codigoDe: { sku: string; nombre: string; activo: boolean } | null;
      parecidos: { sku: string; nombre: string; marca: string | null; activo: boolean }[];
    } = { codigoDe: null, parecidos: [] };

    const codigo = dto.codigo?.trim();
    if (codigo) {
      const { data } = await this.db
        .from('codigos_barras')
        .select('productos(sku, nombre, activo)')
        .eq('codigo', codigo)
        .maybeSingle();
      const p: any = (data as any)?.productos;
      if (p) salida.codigoDe = { sku: p.sku, nombre: p.nombre, activo: p.activo };
    }

    const nombre = dto.nombre?.trim();
    if (nombre && nombre.length >= 3) {
      // las palabras cortas ("de", "x2") no distinguen nada: se buscan las
      // significativas y TODAS tienen que aparecer, si no trae medio catálogo
      const palabras = nombre.toLowerCase().split(/[\s,.]+/).filter((p) => p.length >= 3).slice(0, 3);
      if (palabras.length) {
        let q = this.db.from('productos').select('sku, nombre, activo, marcas(nombre)').limit(6);
        for (const p of palabras) q = q.ilike('nombre', `%${p}%`);
        const { data } = await q;
        salida.parecidos = (data ?? []).map((x: any) => ({
          sku: x.sku, nombre: x.nombre, activo: x.activo, marca: x.marcas?.nombre ?? null,
        }));
      }
    }
    return salida;
  }

  async crear(dto: CrearProductoDto, usuarioId?: string) {
    if (!dto.nombre?.trim()) throw new BadRequestException('El nombre es obligatorio');

    // el código se valida ANTES de insertar: si el producto queda creado y el
    // código falla, quedan dos altas del mismo artículo
    const codigos = [...new Set([dto.codigoBarras, ...(dto.codigosBarras ?? [])].map((c) => String(c ?? '').trim()).filter(Boolean))];
    for (const codigo of codigos) {
      const { data: dueno } = await this.db
        .from('codigos_barras')
        .select('productos(sku, nombre)')
        .eq('codigo', codigo)
        .maybeSingle();
      const p: any = (dueno as any)?.productos;
      if (p) {
        throw new BadRequestException(
          `El código ${codigo} ya es de "${p.nombre}" (SKU ${p.sku}). Si es el mismo artículo, cargá el stock ahí en lugar de crearlo de nuevo.`,
        );
      }
    }

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
        descripcion: dto.descripcion?.trim() || null,
        categoria_id: categoriaId,
        marca_id: marcaId,
        es_alcohol: dto.esAlcohol ?? false,
        volumen_ml: dto.volumenMl ?? null,
        unidades_pack: dto.unidadesPack && dto.unidadesPack > 0 ? Math.round(dto.unidadesPack) : 1,
        graduacion: dto.graduacion ?? null,
        controla_vencimiento: dto.controlaVencimiento ?? false,
        alicuota_iva: dto.alicuotaIva ?? 21,
        alias_busqueda: dto.aliasBusqueda?.trim() || null,
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

    // renglones de stock para ambas sucursales (el stock real entra por
    // movimientos; acá se fijan los mínimos con los que trabaja reposición)
    const { data: sucursales } = await this.db.from('sucursales').select('id');
    const pedido = new Map((dto.stockInicial ?? []).map((s) => [s.sucursalId, s]));
    await this.db.from('stock').insert(
      (sucursales ?? []).map((s) => ({
        producto_id: producto.id,
        sucursal_id: s.id,
        stock_minimo: Number(pedido.get(s.id)?.minimo) || 0,
        punto_reposicion: Number(pedido.get(s.id)?.reposicion) || 0,
      })),
    );

    if (codigos.length) {
      await this.db.from('codigos_barras').insert(codigos.map((codigo) => ({ codigo, producto_id: producto.id })));
    }

    // proveedores que lo traen: queda listo para que la próxima factura de ese
    // proveedor lo reconozca sola por su código
    const provs = (dto.proveedores ?? []).filter((p) => p?.proveedorId);
    if (provs.length) {
      await this.db.from('proveedor_productos').upsert(
        provs.map((p) => ({
          proveedor_id: p.proveedorId,
          producto_id: producto.id,
          codigo_proveedor: p.codigoProveedor?.trim() || null,
          ultimo_costo: p.costo != null ? Number(p.costo) : (dto.costo ?? null),
          margen_pct: p.margenPct != null ? Number(p.margenPct) : null,
          actualizado_en: new Date().toISOString(),
        })),
        { onConflict: 'proveedor_id,producto_id' },
      );
    }
    // el precio de venta va a la lista base; caja y mayorista son opcionales
    if (dto.precio != null && dto.precio > 0) await this.fijarPrecio(producto.id, dto.precio, usuarioId);
    if (dto.precioCaja != null && dto.precioCaja > 0) await this.fijarPrecio(producto.id, dto.precioCaja, usuarioId, 'Por caja');
    if (dto.precioMayorista != null && dto.precioMayorista > 0) await this.fijarPrecio(producto.id, dto.precioMayorista, usuarioId, 'Mayorista');

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
  private async fijarPrecio(productoId: string, precio: number, usuarioId?: string, listaNombre = 'Minorista') {
    const { data: lista } = await this.db
      .from('listas_precios')
      .select('id')
      .eq('nombre', listaNombre)
      .maybeSingle();
    if (!lista) throw new BadRequestException(`No existe la lista de precios ${listaNombre}`);
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

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

const SELECT_PRODUCTO = `
  id, sku, nombre, volumen_ml, unidades_pack, graduacion, es_alcohol, costo, activo, creado_en,
  marca:marcas ( id, nombre ),
  categoria:categorias ( id, nombre ),
  stock ( sucursal_id, cantidad, stock_minimo ),
  codigos_barras ( codigo )
`;

export type FiltrosCatalogo = {
  buscar?: string;
  categoriaId?: string;
  marcaId?: string;
  filtro?: 'bajo_minimo' | 'promo' | 'sin_stock' | '';
  orden?: 'nombre_asc' | 'nombre_desc' | 'recientes' | '';
  pagina?: string | number;
  porPagina?: string | number;
};

@Injectable()
export class CatalogoService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Fotos: viven en Storage como productos/{sku}.jpg; el set se cachea 5 minutos
  private fotosCache: { set: Set<string>; ts: number } | null = null;

  private async fotos(): Promise<Set<string>> {
    if (this.fotosCache && Date.now() - this.fotosCache.ts < 300_000) {
      return this.fotosCache.set;
    }
    const { data } = await this.db.storage.from('productos').list('', { limit: 20000 });
    const set = new Set((data ?? []).map((f) => f.name));
    this.fotosCache = { set, ts: Date.now() };
    return set;
  }

  invalidarFotos() {
    this.fotosCache = null;
    this.catalogoCache.clear();
  }

  async subirImagen(sku: string, archivo: Express.Multer.File) {
    const { error } = await this.db.storage
      .from('productos')
      .upload(`${sku}.jpg`, archivo.buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(error.message);
    this.invalidarFotos();
    return { imagenUrl: this.urlImagen(sku) };
  }

  private urlImagen(sku: string) {
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/productos/${encodeURIComponent(sku)}.jpg`;
  }

  async filtros() {
    const [categorias, marcas] = await Promise.all([
      this.db.from('categorias').select('id, nombre').order('nombre'),
      this.db.from('marcas').select('id, nombre').order('nombre'),
    ]);
    return { categorias: categorias.data ?? [], marcas: marcas.data ?? [] };
  }

  // El catálogo es idéntico para todos los visitantes: caché corto en memoria
  // (30 s) que absorbe la navegación masiva sin golpear la base
  private catalogoCache = new Map<string, { data: any; ts: number }>();

  async buscarProductos(q: FiltrosCatalogo, verificado = false) {
    const clave = JSON.stringify([verificado, q.buscar, q.categoriaId, q.marcaId, q.filtro, q.orden, q.pagina, q.porPagina]);
    const cacheado = this.catalogoCache.get(clave);
    if (cacheado && Date.now() - cacheado.ts < 30_000) return cacheado.data;

    const resultado = await this.buscarProductosSinCache(q, verificado);
    if (this.catalogoCache.size > 500) this.catalogoCache.clear();
    this.catalogoCache.set(clave, { data: resultado, ts: Date.now() });
    return resultado;
  }

  private async buscarProductosSinCache(q: FiltrosCatalogo, verificado = false) {
    const porPagina = Math.min(Math.max(Number(q.porPagina ?? 50), 1), 200);
    const pagina = Math.max(Number(q.pagina ?? 1), 1);

    let query = this.db
      .from('productos')
      .select(SELECT_PRODUCTO, { count: 'exact' })
      .eq('activo', true);

    const termino = q.buscar?.trim();
    if (termino) {
      if (/^\d{8,14}$/.test(termino)) {
        const { data: cb } = await this.db
          .from('codigos_barras')
          .select('producto_id')
          .eq('codigo', termino)
          .maybeSingle();
        query = query.eq('id', cb?.producto_id ?? '00000000-0000-0000-0000-000000000000');
      } else {
        // busca en nombre (sin importar tildes ni mayúsculas) y SKU
        const normalizado = termino
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
        query = query.or(`nombre_normalizado.ilike.%${normalizado}%,sku.ilike.%${termino}%`);
      }
    }
    if (q.categoriaId) query = query.eq('categoria_id', q.categoriaId);
    if (q.marcaId) query = query.eq('marca_id', q.marcaId);

    if (q.filtro === 'bajo_minimo') {
      const { data } = await this.db.from('stock_critico').select('sku');
      const skus = [...new Set((data ?? []).map((r: any) => r.sku))];
      query = query.in('sku', skus.length ? skus : ['__ninguno__']);
    } else if (q.filtro === 'promo') {
      const ids = await this.productosEnPromo();
      if (ids !== 'todos') {
        query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      }
    }

    if (q.orden === 'nombre_desc') query = query.order('nombre', { ascending: false });
    else if (q.orden === 'recientes') query = query.order('creado_en', { ascending: false });
    else query = query.order('nombre');

    query = query.range((pagina - 1) * porPagina, pagina * porPagina - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    let items = (data ?? []) as any[];
    if (q.filtro === 'sin_stock') {
      // filtro liviano sobre la página (caso de uso: control rápido)
      items = items.filter(
        (p) => (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) <= 0,
      );
    }

    const [precios, fotos] = await Promise.all([
      this.preciosVigentes(items.map((p: any) => p.id), verificado),
      this.fotos(),
    ]);
    return {
      total: count ?? items.length,
      pagina,
      porPagina,
      paginas: Math.max(Math.ceil((count ?? 0) / porPagina), 1),
      items: items.map((p) => this.formatear(p, precios.get(p.id), fotos)),
    };
  }

  async obtenerPorSku(sku: string) {
    const { data, error } = await this.db
      .from('productos')
      .select(SELECT_PRODUCTO)
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException(`No existe el producto ${sku}`);
    const [precios, fotos] = await Promise.all([this.preciosVigentes([data.id]), this.fotos()]);
    return this.formatear(data, precios.get(data.id), fotos);
  }

  async detalle(sku: string) {
    const base = await this.obtenerPorSku(sku);
    const { data: prod } = await this.db
      .from('productos')
      .select('id')
      .eq('sku', sku)
      .single();
    const id = prod!.id;
    const hace30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [movimientos, costos, precios, proveedores, ventas30, sucursales] = await Promise.all([
      this.db
        .from('movimientos_stock')
        .select('tipo, cantidad, motivo, creado_en, sucursal:sucursales(nombre)')
        .eq('producto_id', id)
        .order('id', { ascending: false })
        .limit(15),
      this.db
        .from('costos_historial')
        .select('costo, origen, creado_en, proveedor:proveedores(razon_social)')
        .eq('producto_id', id)
        .order('creado_en', { ascending: false })
        .limit(10),
      this.db
        .from('precios')
        .select('precio, vigente_desde')
        .eq('producto_id', id)
        .order('vigente_desde', { ascending: false })
        .limit(10),
      this.db
        .from('proveedor_productos')
        .select('codigo_proveedor, ultimo_costo, actualizado_en, proveedor:proveedores(razon_social, lead_time_dias)')
        .eq('producto_id', id),
      this.db
        .from('ventas_items')
        .select('cantidad, precio_unitario, costo_unitario, venta:ventas!inner(vendida_en, estado, sucursal_id)')
        .eq('producto_id', id)
        .gte('venta.vendida_en', hace30)
        .eq('venta.estado', 'completada')
        .limit(5000),
      this.db.from('sucursales').select('id, nombre'),
    ]);

    const sucPor = new Map((sucursales.data ?? []).map((s: any) => [s.id, s.nombre]));
    const items30 = (ventas30.data ?? []) as any[];
    const unidades30 = items30.reduce((s, r) => s + Number(r.cantidad), 0);
    const facturado30 = items30.reduce((s, r) => s + Number(r.cantidad) * Number(r.precio_unitario), 0);
    const margen30 = items30.reduce(
      (s, r) => s + Number(r.cantidad) * (Number(r.precio_unitario) - Number(r.costo_unitario ?? 0)),
      0,
    );

    return {
      ...base,
      stockPorSucursal: (base as any).stockPorSucursal.map((s: any) => ({
        ...s,
        sucursal: sucPor.get(s.sucursal_id) ?? '—',
      })),
      movimientos: movimientos.data ?? [],
      historialCostos: costos.data ?? [],
      historialPrecios: precios.data ?? [],
      proveedores: proveedores.data ?? [],
      ventas30dias: {
        unidades: Math.round(unidades30),
        facturado: Math.round(facturado30),
        margen: Math.round(margen30),
        porDia: Math.round((unidades30 / 30) * 100) / 100,
      },
    };
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

  private async productosEnPromo(): Promise<string[] | 'todos'> {
    const ahora = new Date().toISOString();
    const { data } = await this.db
      .from('descuentos')
      .select('alcance, categoria_id, marca_id, producto_id')
      .eq('activo', true)
      .lte('desde', ahora)
      .gte('hasta', ahora);
    const activos = (data ?? []) as any[];
    if (activos.some((d) => d.alcance === 'global')) return 'todos';

    const ids = new Set<string>(activos.filter((d) => d.producto_id).map((d) => d.producto_id));
    const categorias = activos.filter((d) => d.categoria_id).map((d) => d.categoria_id);
    const marcas = activos.filter((d) => d.marca_id).map((d) => d.marca_id);
    if (categorias.length) {
      const { data: porCat } = await this.db.from('productos').select('id').in('categoria_id', categorias);
      for (const p of porCat ?? []) ids.add(p.id);
    }
    if (marcas.length) {
      const { data: porMarca } = await this.db.from('productos').select('id').in('marca_id', marcas);
      for (const p of porMarca ?? []) ids.add(p.id);
    }
    return [...ids];
  }

  // ¿Está aplicada la migración de Comunidad ODB? (se detecta una sola vez)
  private soportaComunidad: boolean | null = null;

  private async comunidadActiva(): Promise<boolean> {
    if (this.soportaComunidad !== null) return this.soportaComunidad;
    const { error } = await this.db.from('descuentos').select('solo_comunidad').limit(1);
    this.soportaComunidad = !error;
    return this.soportaComunidad;
  }

  // Precios con descuentos aplicados, calculados por la función canónica de la base
  private async preciosVigentes(ids: string[], verificado = false) {
    const mapa = new Map<string, any>();
    if (ids.length === 0) return mapa;
    const params: any = { p_ids: ids };
    if (verificado && (await this.comunidadActiva())) params.p_verificado = true;
    const { data, error } = await this.db.rpc('catalogo_precios', params);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) mapa.set(r.producto_id, r);
    return mapa;
  }

  private formatear(p: any, precioVigente?: any, fotos?: Set<string>) {
    const stockTotal = (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0);
    return {
      imagenUrl: fotos?.has(`${p.sku}.jpg`) ? this.urlImagen(p.sku) : null,
      descuentoComunidad: precioVigente?.descuento_comunidad === true,
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca?.nombre ?? null,
      categoria: p.categoria?.nombre ?? null,
      volumenMl: p.volumen_ml,
      unidadesPack: p.unidades_pack,
      esAlcohol: p.es_alcohol,
      precioLista: precioVigente?.precio_lista ?? null,
      precio: precioVigente?.precio_final ?? precioVigente?.precio_lista ?? null,
      descuento: precioVigente?.descuento_nombre ?? null,
      costo: p.costo != null ? Number(p.costo) : null,
      stockTotal,
      stockPorSucursal: p.stock ?? [],
      codigosBarras: (p.codigos_barras ?? []).map((c: any) => c.codigo),
    };
  }
}

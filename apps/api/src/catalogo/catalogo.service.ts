import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

const SELECT_PRODUCTO = `
  id, sku, nombre, descripcion, volumen_ml, unidades_pack, graduacion, es_alcohol, costo, activo, creado_en, alicuota_iva,
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

  // Búsqueda LIVIANA para el POS del cajero: una sola query indexada (trigram +
  // código de barras exacto), sin pricing por segmento ni count → ultrarrápida.
  async posBuscar(q: string) {
    const t = (q ?? '').trim();
    if (t.length < 2) return { items: [] };
    const { data, error } = await this.db.rpc('pos_buscar', { p_q: t, p_limit: 8 });
    if (error) throw new BadRequestException(error.message);
    return {
      items: (data ?? []).map((r: any) => ({
        sku: r.sku, nombre: r.nombre,
        precio: r.precio != null ? Number(r.precio) : null,
        precioLista: null, descuento: null,
        esAlcohol: !!r.es_alcohol, imagenUrl: null,
        codigosBarras: r.codigos ?? [],
        codigo: r.codigo ?? null,
      })),
    };
  }

  // Catálogo "rápido" del POS: solo productos CON STOCK (≈ los que se venden en
  // mostrador). El cajero lo precarga al abrir la caja → búsqueda local instantánea.
  async posCatalogo() {
    const { data, error } = await this.db.rpc('pos_catalogo');
    if (error) throw new BadRequestException(error.message);
    return {
      items: (data ?? []).map((r: any) => ({
        sku: r.sku, nombre: r.nombre,
        precio: r.precio != null ? Number(r.precio) : null,
        precioLista: null, descuento: null,
        esAlcohol: !!r.es_alcohol, imagenUrl: null,
        codigosBarras: r.codigos ?? [],
        codigo: r.codigo ?? null,
      })),
    };
  }

  // El catálogo es idéntico para todos los visitantes: caché corto en memoria
  // (30 s) que absorbe la navegación masiva sin golpear la base
  private catalogoCache = new Map<string, { data: any; ts: number }>();

  async buscarProductos(q: FiltrosCatalogo, verificado = false, segmento?: string) {
    const clave = JSON.stringify([verificado, segmento ?? '', q.buscar, q.categoriaId, q.marcaId, q.filtro, q.orden, q.pagina, q.porPagina]);
    const cacheado = this.catalogoCache.get(clave);
    if (cacheado && Date.now() - cacheado.ts < 30_000) return cacheado.data;

    const resultado = await this.buscarProductosSinCache(q, verificado, segmento);
    if (this.catalogoCache.size > 500) this.catalogoCache.clear();
    this.catalogoCache.set(clave, { data: resultado, ts: Date.now() });
    return resultado;
  }

  private async buscarProductosSinCache(q: FiltrosCatalogo, verificado = false, segmento?: string) {
    const porPagina = Math.min(Math.max(Number(q.porPagina ?? 50), 1), 200);
    const pagina = Math.max(Number(q.pagina ?? 1), 1);
    let saltarRango = false; // true cuando el RPC ya devolvió la página exacta

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
        // busca en nombre (sin importar tildes ni mayúsculas) y SKU.
        // se sacan los caracteres que PostgREST usa para parsear filtros (anti-inyección)
        const limpio = termino.replace(/[,()*:\\]/g, '');
        const normalizado = limpio
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
        query = query.or(`nombre_normalizado.ilike.%${normalizado}%,sku.ilike.%${limpio}%`);
      }
    }
    if (q.categoriaId) query = query.eq('categoria_id', q.categoriaId);
    if (q.marcaId) query = query.eq('marca_id', q.marcaId);

    if (q.filtro === 'bajo_minimo') {
      const { data } = await this.db.from('stock_critico').select('sku');
      const skus = [...new Set((data ?? []).map((r: any) => r.sku))];
      query = query.in('sku', skus.length ? skus : ['__ninguno__']);
    } else if (q.filtro === 'promo') {
      // Feed de ofertas de la tienda: solo productos con precio cargado (para no
      // mostrar accesorios sin precio). La paginación la resuelve la base con un
      // RPC (evita enumerar cientos de IDs en la URL).
      const promo = await this.productosEnPromo();
      if (promo === 'todos') {
        const { data: of } = await this.db.rpc('ofertas_tienda', {
          p_limit: porPagina,
          p_offset: (pagina - 1) * porPagina,
        });
        const ids = (of ?? []).map((r: any) => r.id);
        query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
        saltarRango = true; // el RPC ya aplicó limit/offset
      } else {
        const precificados = new Set(await this.productosConPrecio());
        const ids = promo.filter((id) => precificados.has(id)).slice(0, 200);
        query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      }
    }

    if (q.orden === 'nombre_desc') query = query.order('nombre', { ascending: false });
    else if (q.orden === 'recientes') query = query.order('creado_en', { ascending: false });
    else query = query.order('nombre');

    if (!saltarRango) query = query.range((pagina - 1) * porPagina, pagina * porPagina - 1);

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
      this.preciosVigentes(items.map((p: any) => p.id), verificado, segmento),
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

  // Tarjetas de producto (mismo formato que el catálogo) para una lista de ids,
  // respetando el orden recibido. Lo usan favoritos, frecuentes y recompra.
  async cardsPorIds(ids: string[], verificado = false, segmento?: string) {
    if (!ids.length) return [];
    const { data, error } = await this.db.from('productos').select(SELECT_PRODUCTO).in('id', ids);
    if (error) throw new Error(error.message);
    const items = (data ?? []) as any[];
    const [precios, fotos] = await Promise.all([
      this.preciosVigentes(items.map((p) => p.id), verificado, segmento),
      this.fotos(),
    ]);
    const porId = new Map(items.map((p) => [p.id, this.formatear(p, precios.get(p.id), fotos)]));
    return ids.map((id) => porId.get(id)).filter(Boolean);
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

  // Nota de cata + maridaje del Somelier ODB para un producto (solo bebidas con
  // alcohol). Se genera una vez con IA (Haiku, barato) y se cachea por producto.
  async notaCata(sku: string) {
    const { data: prod } = await this.db
      .from('productos')
      .select('id, nombre, es_alcohol, graduacion, marca:marcas(nombre), categoria:categorias(nombre)')
      .eq('sku', sku)
      .maybeSingle();
    if (!prod || !prod.es_alcohol) return { nota: null, maridaje: null };

    const { data: cache } = await this.db
      .from('notas_cata')
      .select('nota, maridaje')
      .eq('producto_id', prod.id)
      .maybeSingle();
    if (cache) return { nota: cache.nota, maridaje: cache.maridaje };

    if (!process.env.ANTHROPIC_API_KEY) return { nota: null, maridaje: null };
    try {
      const marca = (prod.marca as any)?.nombre ?? '';
      const cat = (prod.categoria as any)?.nombre ?? '';
      const claude = new Anthropic();
      const r = await claude.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system:
          'Sos el Somelier ODB de O.D.B Premium Market. Escribís en español rioplatense, cercano y sin esnobismo. Para el producto dado generás una nota de cata breve (2-3 oraciones, sin puntajes ni premios inventados) y una sugerencia de maridaje (1 oración con 2-3 ideas concretas). Texto plano. Si no tenés datos suficientes, hacé una nota honesta y general del estilo. Respondé SOLO un JSON válido: {"nota":"...","maridaje":"..."}.',
        messages: [
          { role: 'user', content: `Producto: ${prod.nombre}${marca ? ` · marca ${marca}` : ''}${cat ? ` · ${cat}` : ''}${prod.graduacion ? ` · ${prod.graduacion}°` : ''}.` },
        ],
      });
      const blk = r.content.find((b) => b.type === 'text');
      const raw = blk && 'text' in blk ? blk.text : '';
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      const nota = typeof parsed.nota === 'string' ? parsed.nota : null;
      const maridaje = typeof parsed.maridaje === 'string' ? parsed.maridaje : null;
      if (nota) await this.db.from('notas_cata').insert({ producto_id: prod.id, nota, maridaje });
      return { nota, maridaje };
    } catch {
      return { nota: null, maridaje: null };
    }
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

  // IDs de productos con precio minorista cargado (caché 5 min: cambia poco)
  private precificadosCache: { ids: string[]; ts: number } | null = null;
  private async productosConPrecio(): Promise<string[]> {
    if (this.precificadosCache && Date.now() - this.precificadosCache.ts < 300_000) {
      return this.precificadosCache.ids;
    }
    const { data: listas } = await this.db
      .from('listas_precios')
      .select('id')
      .ilike('nombre', 'minorista');
    const listaIds = (listas ?? []).map((l: any) => l.id);
    let ids: string[] = [];
    if (listaIds.length) {
      const { data } = await this.db
        .from('precios')
        .select('producto_id')
        .in('lista_id', listaIds)
        .limit(50000);
      ids = [...new Set((data ?? []).map((r: any) => r.producto_id))];
    }
    this.precificadosCache = { ids, ts: Date.now() };
    return ids;
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
  // tipo (segmento de comportamiento) de un cliente por id
  async tipoCliente(clienteId: string): Promise<{ data: string | null }> {
    const { data } = await this.db.from('clientes').select('tipo').eq('id', clienteId).maybeSingle();
    return { data: data?.tipo ?? null };
  }

  private async preciosVigentes(ids: string[], verificado = false, segmento?: string) {
    const mapa = new Map<string, any>();
    if (ids.length === 0) return mapa;
    const params: any = { p_ids: ids };
    if (verificado && (await this.comunidadActiva())) params.p_verificado = true;
    if (segmento) params.p_segmento = segmento;
    const { data, error } = await this.db.rpc('catalogo_precios', params);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) mapa.set(r.producto_id, r);
    return mapa;
  }

  private formatear(p: any, precioVigente?: any, fotos?: Set<string>) {
    const stockTotal = (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0);
    return {
      id: p.id,
      activo: p.activo,
      imagenUrl: fotos?.has(`${p.sku}.jpg`) ? this.urlImagen(p.sku) : null,
      descuentoComunidad: precioVigente?.descuento_comunidad === true,
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca?.nombre ?? null,
      categoria: p.categoria?.nombre ?? null,
      volumenMl: p.volumen_ml,
      unidadesPack: p.unidades_pack,
      graduacion: p.graduacion != null ? Number(p.graduacion) : null,
      descripcion: p.descripcion ?? null,
      categoriaId: p.categoria?.id ?? null,
      esAlcohol: p.es_alcohol,
      precioLista: precioVigente?.precio_lista ?? null,
      precio: precioVigente?.precio_final ?? precioVigente?.precio_lista ?? null,
      descuento: precioVigente?.descuento_nombre ?? null,
      costo: p.costo != null ? Number(p.costo) : null,
      alicuotaIva: p.alicuota_iva != null ? Number(p.alicuota_iva) : 21,
      stockTotal,
      stockPorSucursal: p.stock ?? [],
      codigosBarras: (p.codigos_barras ?? []).map((c: any) => c.codigo),
    };
  }
}

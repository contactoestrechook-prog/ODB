import { BotService } from './bot.service';
import { MARGEN_SIN_RECORTE, NOMBRES_DEL_RESTO, recortarBusqueda, TOPE_BUSQUEDA_POR_DEFECTO, topeDeBusqueda } from './tope-busqueda';

// TOPE DE LA BÚSQUEDA DEL BOT (Leandro, 6/10/2026: «sí, arreglalo»). La charla
// de Jimena costó USD 4,70: «queso» devolvía 144 fichas y «tita» 119, y cada
// vuelta del modelo las volvía a escribir en la caché. Estas pruebas fijan que
// van con ficha las 20 más relevantes, que el resto queda nombrado con la nota
// de que hay más, y que lo que el cliente nombró exacto nunca queda afuera.

process.env.ANTHROPIC_API_KEY ??= 'test';

type Prod = { sku: string; nombre: string; vendidas: number; categoria?: string; codigo?: string; porDefecto?: boolean };

// 144 con «queso» (como el 6/10): 40 los trae stock_consulta (orden alfabético,
// tope 40) y el resto la categoría «quesos»
function quesos(): Prod[] {
  const marcas = ['Barraza', 'La Paulina', 'Punta del Agua', 'Santa Rosa', 'Sancor', 'Fermier', 'Vaquero', 'Milkaut', 'Tregar', 'Ilolay', 'Verónica', 'Cremon'];
  const tipos = ['Cremoso', 'Danbo', 'Pategras', 'Muzzarella', 'Reggiano', 'Tybo', 'Port Salut', 'Provoleta', 'Fontina', 'Azul', 'Sardo', 'Gouda'];
  const out: Prod[] = [];
  for (const tipo of tipos) for (const marca of marcas) out.push({ sku: `Q${out.length}`, nombre: `Queso ${tipo} ${marca} x fraccion`, vendidas: (out.length * 37) % 97, categoria: 'c-quesos' });
  return out; // 144
}

describe('el tope de la búsqueda: cuántas fichas', () => {
  const guardada = process.env.ODB_BOT_TOPE_BUSQUEDA;
  afterEach(() => { if (guardada === undefined) delete process.env.ODB_BOT_TOPE_BUSQUEDA; else process.env.ODB_BOT_TOPE_BUSQUEDA = guardada; });

  it('encendido por defecto en 20 (lo eligió la medición del 6/10/2026)', () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    expect(TOPE_BUSQUEDA_POR_DEFECTO).toBe(20);
    expect(topeDeBusqueda()).toBe(20);
  });

  it('ODB_BOT_TOPE_BUSQUEDA lo cambia; 0 es sin tope; un valor inválido no lo apaga', () => {
    process.env.ODB_BOT_TOPE_BUSQUEDA = '15';
    expect(topeDeBusqueda()).toBe(15);
    process.env.ODB_BOT_TOPE_BUSQUEDA = '0';
    expect(topeDeBusqueda()).toBe(0);
    for (const malo of ['', '  ', 'veinte', '-3', 'NaN']) {
      process.env.ODB_BOT_TOPE_BUSQUEDA = malo;
      expect(topeDeBusqueda()).toBe(20);
    }
  });

  it('con tope 0 van todas, en el orden de siempre y sin nota', () => {
    const items = quesos();
    expect(recortarBusqueda(items, 'queso', () => 0, 0)).toEqual({ visibles: items, otros: null });
  });

  it('si sobran 5 o menos no se recorta (la nota ocuparía casi lo mismo)', () => {
    const items = quesos().slice(0, 20 + MARGEN_SIN_RECORTE);
    expect(recortarBusqueda(items, 'queso', () => 0, 20)).toEqual({ visibles: items, otros: null });
    expect(recortarBusqueda(quesos().slice(0, 26), 'queso', () => 0, 20).visibles).toHaveLength(20);
  });
});

describe('el tope de la búsqueda: qué queda con ficha', () => {
  const vendidasDe = (items: Prod[]) => (sku: string) => items.find((x) => x.sku === sku)?.vendidas ?? 0;

  it('«queso» con 144: 20 fichas, las más vendidas primero, y el resto nombrado con la nota de que hay más', () => {
    const items = quesos();
    const r = recortarBusqueda(items, 'queso', vendidasDe(items), 20);
    expect(r.visibles).toHaveLength(20);
    const v = r.visibles.map((x) => x.vendidas);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(Math.max(...items.filter((x) => !r.visibles.includes(x)).map((x) => x.vendidas)));
    expect(r.otros).toMatch(/^Hay 124 productos más con stock en esta búsqueda/);
    expect(r.otros).toMatch(/buscá con más precisión \(marca, tamaño, sabor\)/);
    expect(r.otros).toMatch(/NO quiere decir que no los tengamos/);
    // los nombres (hasta 40) y la cuenta del resto
    expect(r.otros).toContain(`+${124 - NOMBRES_DEL_RESTO} más`);
    const nombrados = items.filter((x) => !r.visibles.includes(x) && r.otros!.includes(x.nombre));
    expect(nombrados).toHaveLength(NOMBRES_DEL_RESTO);
    // ninguna ficha se repite en los nombres
    for (const x of r.visibles) expect(r.otros).not.toContain(x.nombre);
  });

  it('la coincidencia exacta del nombre nunca queda afuera, aunque no se venda y venga última', () => {
    const items = [...quesos(), { sku: 'L4468', nombre: 'Queso Danbo La Serenisima x fraccion', vendidas: 0 }];
    const r = recortarBusqueda(items, 'queso danbo la serenisima', vendidasDe(items), 20);
    expect(r.visibles[0].sku).toBe('L4468');
    // y si pidió un tamaño, la del tamaño pedido
    const cocas = [
      ...Array.from({ length: 40 }, (_, i) => ({ sku: `G${i}`, nombre: `Gaseosa Cola Marca${i} x2.25L`, vendidas: 100 + i })),
      { sku: 'L7044', nombre: 'Coca Cola Zero 1.5L', vendidas: 0 },
      { sku: 'L10952', nombre: 'Coca Cola Zero x1.75L', vendidas: 1 },
    ];
    const z = recortarBusqueda(cocas, 'coca cola zero 1,5 litros', vendidasDe(cocas), 20);
    expect(z.visibles[0].sku).toBe('L7044');
    expect(z.visibles.map((x) => x.sku)).toContain('L10952');
  });

  it('la búsqueda de un SKU o de un código devuelve esa ficha aunque esté última y no se venda', () => {
    const items = [...quesos(), { sku: 'L1063', nombre: 'Hielo Bolsa 2KG', vendidas: 0 }];
    expect(recortarBusqueda(items, 'L1063', vendidasDe(items), 20).visibles.map((x) => x.sku)).toContain('L1063');
    expect(recortarBusqueda(items, 'l1063', vendidasDe(items), 20).visibles.map((x) => x.sku)).toContain('L1063');
    // por código (legacy o de barras): lo marca buscarProductos como exacto
    expect(recortarBusqueda(items, '7790001234567', vendidasDe(items), 20, { exactos: new Set(['L1063']) }).visibles.map((x) => x.sku)).toContain('L1063');
  });

  it('el producto por defecto (el más vendido de lo que pidió) va primero y nunca se recorta', () => {
    const items = quesos().map((x, i) => (i === 143 ? { ...x, porDefecto: true, vendidas: 0 } : x));
    const r = recortarBusqueda(items, 'queso', vendidasDe(items), 20);
    expect(r.visibles[0].sku).toBe('Q143');
  });

  it('lo que tiene la marca pedida va antes que lo más vendido de la categoría («tita» trae todas las galletitas)', () => {
    const items: Prod[] = [
      ...Array.from({ length: 100 }, (_, i) => ({ sku: `G${i}`, nombre: `Galletitas Marca${i} x 200 gr`, vendidas: 1000 + i })),
      { sku: 'L3569', nombre: 'Galletita Tita x3u', vendidas: 34 },
    ];
    const r = recortarBusqueda(items, 'tita', vendidasDe(items), 20);
    expect(r.visibles[0].sku).toBe('L3569');
  });

  it('con todas las palabras, primero lo que empieza por lo pedido («Leche La Serenísima» antes que la crema)', () => {
    const items: Prod[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ sku: `C${i}`, nombre: `Crema de Leche La Serenisima tetra ${200 + i} cc`, vendidas: 500 + i })),
      ...Array.from({ length: 12 }, (_, i) => ({ sku: `L${i}`, nombre: `Leche La Serenisima variedad ${i} botella x 1LT`, vendidas: 10 + i })),
      ...Array.from({ length: 12 }, (_, i) => ({ sku: `D${i}`, nombre: `Dulce de Leche Otra Marca ${i}`, vendidas: 900 + i })),
    ];
    const r = recortarBusqueda(items, 'leche la serenisima', vendidasDe(items), 20);
    expect(r.visibles.slice(0, 12).every((x) => x.sku.startsWith('L'))).toBe(true);
    // lo que tiene una sola de las palabras va al final, aunque se venda más
    expect(r.visibles.some((x) => x.sku.startsWith('D'))).toBe(false);
  });

  it('si pidió un tamaño, primero ese tamaño', () => {
    const items: Prod[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ sku: `A${i}`, nombre: `Agua Marca${i} x 500cc`, vendidas: 100 + i })),
      { sku: 'B1', nombre: 'Agua Mineral Glaciar x2Lt', vendidas: 1 },
      { sku: 'B2', nombre: 'Agua Villavicencio sin gas x2lt', vendidas: 2 },
    ];
    const r = recortarBusqueda(items, 'agua 2 litros', vendidasDe(items), 20);
    expect(r.visibles.slice(0, 2).map((x) => x.sku).sort()).toEqual(['B1', 'B2']);
  });

  it('la palabra de la búsqueda también la cubre la categoría: «agua 2 litros» trae el Villavicencio de 2 L aunque su nombre no diga «agua»', () => {
    // los datos reales del 6/10/2026: con solo el nombre quedaba 32º, detrás de todas las «Agua Saborizada» de 1,5 L
    const items: (Prod & { cat: string })[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ sku: `S${i}`, nombre: `Agua Saborizada Marca${i} 1.5l`, vendidas: 100 + i, cat: 'Aguas Saborizadas' })),
      { sku: 'L261', nombre: 'Villavicencio sin gas x2lt', vendidas: 397, cat: 'Aguas Minerales' },
      { sku: 'L9999', nombre: 'Gaseosa Naranja x2lt', vendidas: 900, cat: 'Gaseosas' },
    ];
    const categoria = (sku: string) => items.find((x) => x.sku === sku)?.cat;
    const r = recortarBusqueda(items, 'agua 2 litros', vendidasDe(items), 20, { categoria });
    expect(r.visibles[0].sku).toBe('L261');
    // sin la categoría, el Villavicencio quedaba afuera de las fichas
    expect(recortarBusqueda(items, 'agua 2 litros', vendidasDe(items), 20).visibles.map((x) => x.sku)).not.toContain('L261');
    // lo que no es de la categoría (ni dice «agua») va después, aunque sea del tamaño y se venda más
    expect(r.visibles.map((x) => x.sku)).not.toContain('L9999');
  });
});

// ---- buscarProductos de verdad, con el catálogo y la base de mentira ----

function servicioConCatalogo(productos: Prod[], porTexto: (q: string) => Prod[]) {
  const precioDe = (id: string) => 1000 + Number(String(id).replace(/\D/g, '') || 0);
  const db: any = {
    rpc: jest.fn(async (fn: string, args: any) => fn === 'catalogo_precios_bot'
      ? { data: (args.p_ids ?? []).map((id: string) => ({ producto_id: id, precio_final: precioDe(id), precio_lista: precioDe(id) })), error: null }
      : { data: null, error: null }),
    from(tabla: string) {
      const filtros: any[] = [];
      const res = () => {
        if (tabla === 'categorias') return { data: [{ id: 'c-quesos', nombre: 'quesos' }, { id: 'c-galletitas', nombre: 'Galletitas Dulces' }], error: null };
        if (tabla === 'sucursales') return { data: { nombre: 'Suc Sant Thomas' }, error: null };
        if (tabla === 'productos') {
          const enSku = filtros.find((f) => f[0] === 'in' && f[1] === 'sku');
          const enCat = filtros.find((f) => f[0] === 'in' && f[1] === 'categoria_id');
          if (enSku) return { data: productos.filter((p) => enSku[2].includes(p.sku)).map((p) => ({ id: `id-${p.sku}`, sku: p.sku, es_alcohol: false, unidades_pack: 1, vendido_por_peso: true, unidades_vendidas: p.vendidas, categoria: { nombre: 'quesos' } })), error: null };
          if (enCat) return { data: productos.filter((p) => p.categoria && enCat[2].includes(p.categoria)).map((p) => ({ sku: p.sku, nombre: p.nombre, stock: [{ cantidad: 5, sucursal: { nombre: 'Suc Sant Thomas' } }] })), error: null };
        }
        return { data: null, error: null };
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (k === 'select') return () => b;
          return (...args: any[]) => { filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  const catalogo: any = {
    consultarStock: jest.fn(async (q: string, limite = 10) => ({
      items: porTexto(q).slice(0, limite).map((p) => ({ sku: p.sku, nombre: p.nombre, codigo: p.codigo ?? null, total: 5, sucursales: [{ sucursal: 'Suc Sant Thomas', cantidad: 5 }] })),
    })),
  };
  const s: any = new BotService(db, {} as any, catalogo, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  return { s, catalogo };
}

describe('buscarProductos con el tope (la búsqueda del bot de punta a punta)', () => {
  const guardada = process.env.ODB_BOT_TOPE_BUSQUEDA;
  afterEach(() => { if (guardada === undefined) delete process.env.ODB_BOT_TOPE_BUSQUEDA; else process.env.ODB_BOT_TOPE_BUSQUEDA = guardada; });
  const productos = quesos();
  const porNombre = (q: string) => productos
    .filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase().replace(/%/g, ' ').trim()) || p.sku.toLowerCase() === q.toLowerCase() || p.codigo === q)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  it('«queso» (144 con stock): 20 fichas, la nota con los demás y bastante menos texto para la caché', async () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const { s } = servicioConCatalogo(productos, porNombre);
    const r: any = await s.buscarProductos('queso');
    expect(r.items).toHaveLength(20);
    expect(r.otros).toMatch(/^Hay 124 productos más con stock en esta búsqueda/);
    expect(r.otros).toMatch(/buscá con más precisión \(marca, tamaño, sabor\)/);
    // las fichas siguen completas (precio, presentación, medida…)
    expect(r.items[0]).toEqual(expect.objectContaining({ sku: expect.any(String), nombre: expect.any(String), precio: expect.any(Number), disponible: true }));
    // el de por defecto (el más vendido) va primero
    expect(r.items[0].porDefecto).toBe(true);
    process.env.ODB_BOT_TOPE_BUSQUEDA = '0';
    const sinTope: any = await servicioConCatalogo(productos, porNombre).s.buscarProductos('queso');
    expect(sinTope.items).toHaveLength(144);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(sinTope).length * 0.35);
  });

  it('ODB_BOT_TOPE_BUSQUEDA=0 vuelve a la búsqueda de antes: todas las fichas y sin nota', async () => {
    process.env.ODB_BOT_TOPE_BUSQUEDA = '0';
    const { s } = servicioConCatalogo(productos, porNombre);
    const r: any = await s.buscarProductos('queso');
    expect(r.items).toHaveLength(144);
    expect(r.otros).toBeUndefined();
  });

  it('una búsqueda chica no cambia nada (ni el orden)', async () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const { s } = servicioConCatalogo(productos, porNombre);
    process.env.ODB_BOT_TOPE_BUSQUEDA = '0';
    const antes: any = await servicioConCatalogo(productos, porNombre).s.buscarProductos('queso danbo');
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const ahora: any = await s.buscarProductos('queso danbo');
    expect(ahora).toEqual(antes);
    expect(ahora.otros).toBeUndefined();
  });

  it('la búsqueda de un SKU devuelve esa ficha', async () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const { s } = servicioConCatalogo(productos, porNombre);
    const r: any = await s.buscarProductos('Q77');
    expect(r.items.map((x: any) => x.sku)).toEqual(['Q77']);
  });

  it('la búsqueda de un código que trae muchos resultados igual devuelve la ficha de ese código', async () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const conCodigo = productos.map((p) => (p.sku === 'Q143' ? { ...p, codigo: '7790001234567', vendidas: 0 } : p));
    // stock_consulta pone primero la coincidencia exacta del código y después lo que se le parece
    const { s } = servicioConCatalogo(conCodigo, (q) => (q === '7790001234567' ? [conCodigo[143], ...conCodigo.slice(0, 39)] : []));
    const r: any = await s.buscarProductos('7790001234567');
    expect(r.items.map((x: any) => x.sku)).toContain('Q143');
  });

  it('lo que va en la herramienta del turno son solo las fichas visibles (los SKU del resto no se dan por vistos)', async () => {
    delete process.env.ODB_BOT_TOPE_BUSQUEDA;
    const { s } = servicioConCatalogo(productos, porNombre);
    const out: any = await s.ejecutarHerramienta({ type: 'tool_use', id: 'b1', name: 'buscar_productos', input: { q: 'queso' } }, '5491100000000');
    const r = JSON.parse(String(out.content));
    expect(r.items).toHaveLength(20);
    expect(r.otros).toMatch(/^Hay 124 productos más/);
    expect(s.skusDe('5491100000000').size).toBe(20);
  });
});

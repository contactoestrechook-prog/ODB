import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROLES } from '../auth/decorators';
import {
  alcanzaPara,
  armarHistorial,
  costoSegunLleva,
  describirArmadas,
  errorDeFraccionamiento,
  explicarFaltante,
  faltaParaCero,
  leerCantidad,
  leerPrecio,
  textoSistemaViejo,
  type FilaMovimiento,
} from './fracciones';
import { FraccionesService } from './fracciones.service';
import { FraccionesController } from './fracciones.controller';
import { StockService } from './stock.service';
import { CajaController } from '../caja/caja.controller';
import { StockController } from './stock.controller';

// Fraccionar "bien pro" (21/10/2026). Antes la pantalla solo armaba contra un
// pozo que nadie podía cargar ni configurar desde ahí; ahora se suman pozos y
// presentaciones, se editan y se quitan, se carga el pozo con las mismas
// reglas que un ajuste (PIN de supervisor arriba del tope) y hay historial.

// ------------------------------------------------------------ base en memoria
// Lo justo de Supabase para estas pruebas: filtra por eq/in/not null/gt/lte,
// aplica los update e insert sobre las filas y cuenta con head: true.
type Filtro = [string, string, any];
function baseFalsa(inicial: Record<string, any[]>, rpcs: Record<string, (args: any) => { data?: any; error?: any }> = {}) {
  const tablas: Record<string, any[]> = JSON.parse(JSON.stringify(inicial));
  const ops: any[] = [];
  // "pedido.estado" (tabla embebida) y "datos_despues->>sucursal_id" (JSON)
  const valor = (fila: any, col: string) => col.split(/->>|->|\./).reduce((o, k) => (o == null ? undefined : o[k]), fila);
  const cumple = (fila: any, filtros: Filtro[]) =>
    filtros.every(([tipo, col, val]) => {
      const v = valor(fila, col);
      if (tipo === 'eq') return v != null && String(v) === String(val);
      if (tipo === 'in') return (val as any[]).map(String).includes(String(v));
      if (tipo === 'noNulo') return v != null;
      if (tipo === 'gt') return Number(v) > Number(val);
      if (tipo === 'lte') return String(v) <= String(val);
      if (tipo === 'gte') return String(v) >= String(val);
      return true;
    });
  const db: any = {
    from: (tabla: string) => {
      const op: any = { tabla, accion: 'select', filtros: [] as Filtro[] };
      ops.push(op);
      const ejecutar = (modo: 'uno' | 'lista') => {
        const filas = (tablas[tabla] ??= []);
        if (op.accion === 'insert') {
          const nuevas = ([] as any[]).concat(op.valores);
          filas.push(...nuevas);
          return { data: modo === 'uno' ? nuevas[0] : nuevas, error: null };
        }
        if (op.accion === 'update') {
          for (const f of filas.filter((f) => cumple(f, op.filtros))) Object.assign(f, op.valores);
          return { data: null, error: null };
        }
        // copias, como Supabase: un update posterior no cambia lo que ya se leyó
        const hallados = filas.filter((f) => cumple(f, op.filtros)).map((f) => ({ ...f }));
        if (op.opciones?.head) return { data: null, error: null, count: hallados.length };
        return { data: modo === 'uno' ? (hallados[0] ?? null) : hallados, error: null };
      };
      const q: any = {
        select: (s?: string, o?: any) => { if (op.accion === 'select') { op.select = s; op.opciones = o; } return q; },
        insert: (v: any) => { op.accion = 'insert'; op.valores = v; return q; },
        update: (v: any) => { op.accion = 'update'; op.valores = v; return q; },
        eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
        in: (c: string, v: any) => { op.filtros.push(['in', c, v]); return q; },
        not: (c: string, _o: string, _v: any) => { op.filtros.push(['noNulo', c, null]); return q; },
        gt: (c: string, v: any) => { op.filtros.push(['gt', c, v]); return q; },
        lte: (c: string, v: any) => { op.filtros.push(['lte', c, v]); return q; },
        gte: (c: string, v: any) => { op.filtros.push(['gte', c, v]); return q; },
        order: () => q,
        limit: () => q,
        maybeSingle: () => Promise.resolve(ejecutar('uno')),
        single: () => Promise.resolve(ejecutar('uno')),
        then: (ok: any, mal: any) => Promise.resolve(ejecutar('lista')).then(ok, mal),
      };
      return q;
    },
    rpc: jest.fn((nombre: string, args: any) => {
      ops.push({ rpc: nombre, args });
      return Promise.resolve({ data: null, error: null, ...(rpcs[nombre]?.(args) ?? {}) });
    }),
  };
  return { db, tablas, ops };
}

const SUC_A = 's-santa-ines';
const SUC_B = 's-saint-thomas';
const POZO = { id: 'p-pozo', sku: 'HUEVOS-GRANEL', nombre: 'Huevos x unidad', fraccion_de: null, vendido_por_peso: false, costo: 100, categoria_id: 'cat-huevos', alicuota_iva: 21, es_alcohol: false, activo: true };
const DOCENA = { id: 'p-doc', sku: 'HUEVOS-DOC', nombre: 'Huevos x docena', fraccion_de: 'p-pozo', unidades_por_fraccion: 12, vendido_por_peso: false, activo: true };
const MAPLE = { id: 'p-maple', sku: 'L3412', nombre: 'Maple x 30', fraccion_de: 'p-pozo', unidades_por_fraccion: 30, vendido_por_peso: false, activo: true, codigo_legacy: '3412' };
const SUELTO = { id: 'p-suelto', sku: 'L999', nombre: 'Huevos x 18', fraccion_de: null, vendido_por_peso: false, activo: true };
const QUESO = { id: 'p-queso', sku: 'Q-KG', nombre: 'Reggianito x kg', fraccion_de: null, vendido_por_peso: true, costo: 20000, activo: true };

function armar(extra: Record<string, any[]> = {}, rpcs: Record<string, (args: any) => any> = {}) {
  const base = baseFalsa(
    {
      productos: [POZO, DOCENA, MAPLE, SUELTO, QUESO],
      sucursales: [
        { id: SUC_A, nombre: 'Santa Inés', activa: true },
        { id: SUC_B, nombre: 'Saint Thomas', activa: true },
      ],
      stock: [],
      listas_precios: [{ id: 'l-min', nombre: 'Minorista' }],
      precios: [],
      auditoria: [],
      ...extra,
    },
    rpcs,
  );
  const productos = {
    crear: jest.fn(async (dto: any) => {
      const fila = { id: 'p-nuevo', sku: '90001', nombre: dto.nombre, fraccion_de: null, vendido_por_peso: false, activo: true, costo: dto.costo };
      base.tablas.productos.push(fila);
      return { id: fila.id, sku: fila.sku };
    }),
    editar: jest.fn(async () => ({ ok: true })),
  };
  const caja = { consumirAutorizacion: jest.fn().mockResolvedValue({ usuarioId: 'sup-real', nombre: 'Gerente', rol: 'gerente' }) };
  const stock = new StockService(base.db, caja as any);
  const svc = new FraccionesService(base.db, stock, productos as any);
  const producto = (id: string) => base.tablas.productos.find((p) => p.id === id);
  return { ...base, svc, stock, productos, caja, producto };
}

// ------------------------------------------------------------------ cuentas

describe('alcanzaPara', () => {
  it('cuenta presentaciones enteras con lo que hay en el pozo', () => {
    expect(alcanzaPara(360, 12)).toBe(30);
    expect(alcanzaPara(365, 30)).toBe(12);
    expect(alcanzaPara(11, 12)).toBe(0);
  });
  it('en kilos no pierde una por la coma flotante (0,3 kg / 0,1 kg = 3)', () => {
    expect(alcanzaPara(0.3, 0.1)).toBe(3);
    expect(alcanzaPara('1.000', '0.250')).toBe(4);
  });
  it('pozo vacío, negativo o sin unidades: 0', () => {
    expect(alcanzaPara(0, 12)).toBe(0);
    expect(alcanzaPara(-5, 12)).toBe(0);
    expect(alcanzaPara(100, 0)).toBe(0);
    expect(alcanzaPara(null, 12)).toBe(0);
  });
});

describe('leerCantidad', () => {
  it('pozo por kilo: acepta coma decimal y redondea al gramo', () => {
    expect(leerCantidad('0,25', true)).toEqual({ ok: true, valor: 0.25 });
    expect(leerCantidad(1.23456, true)).toEqual({ ok: true, valor: 1.235 });
  });
  it('pozo por unidad: solo enteros', () => {
    expect(leerCantidad('12', false)).toEqual({ ok: true, valor: 12 });
    expect(leerCantidad('1,5', false).ok).toBe(false);
  });
  it('rechaza cero, negativos, vacío y lo que pasa el máximo', () => {
    expect(leerCantidad('0', false).ok).toBe(false);
    expect(leerCantidad(-3, false).ok).toBe(false);
    expect(leerCantidad('', true).ok).toBe(false);
    expect(leerCantidad('abc', true).ok).toBe(false);
    expect(leerCantidad(0.0001, true).ok).toBe(false);
    expect(leerCantidad(5000, false, { maximo: 1000 }).ok).toBe(false);
  });
});

describe('leerPrecio', () => {
  it('lee el precio como se escribe acá: el punto separa miles', () => {
    expect(leerPrecio('2.500')).toBe(2500);
    expect(leerPrecio('$ 12.500,50')).toBe(12500.5);
    expect(leerPrecio('2500,5')).toBe(2500.5);
    expect(leerPrecio('12.5')).toBe(12.5);
    expect(leerPrecio(4800)).toBe(4800);
  });
  it('vacío, cero o texto: null', () => {
    expect(leerPrecio('')).toBeNull();
    expect(leerPrecio('0')).toBeNull();
    expect(leerPrecio('abc')).toBeNull();
    expect(leerPrecio(null)).toBeNull();
  });
});

describe('errorDeFraccionamiento', () => {
  it('traduce el "Stock insuficiente" de la base según se arme o se abra', () => {
    expect(errorDeFraccionamiento('Stock insuficiente: la operación dejaría -24 unidades', 2)).toMatch(/No alcanza lo que hay en el pozo/);
    expect(errorDeFraccionamiento('Stock insuficiente: la operación dejaría -1 unidades', -1)).toMatch(/No hay tantas armadas/);
    expect(errorDeFraccionamiento('otra cosa', 1)).toBe('otra cosa');
  });
});

describe('explicarFaltante y faltaParaCero', () => {
  it('armar: dice cuánto hay y cuánto hace falta', () => {
    expect(explicarFaltante({ cantidad: 2, unidades: 12, stockPozo: 10, stockPresentacion: 0, porPeso: false })).toMatch(/hay 10 unidades y para esa cantidad hacen falta 24 unidades/);
  });
  it('armar con el pozo en negativo: primero dejarlo en cero', () => {
    expect(explicarFaltante({ cantidad: 1, unidades: 0.25, stockPozo: -0.86, stockPresentacion: 0, porPeso: true })).toMatch(/El pozo está en -0,86 kg/);
  });
  it('abrir sin armadas suficientes: cuántas hay', () => {
    expect(explicarFaltante({ cantidad: -3, unidades: 12, stockPozo: 5, stockPresentacion: 1, porPeso: false })).toMatch(/No hay tantas armadas.*hay 1\./);
  });
  it('abrir con el pozo en negativo: no es culpa de las armadas', () => {
    const t = explicarFaltante({ cantidad: -1, unidades: 0.25, stockPozo: -0.86, stockPresentacion: 1, porPeso: true });
    expect(t).toMatch(/quedaría en -0,61 kg/);
    expect(t).toMatch(/Cargá al menos 0,61 kg/);
    expect(t).not.toMatch(/No hay tantas armadas/);
  });
  it('faltaParaCero', () => {
    expect(faltaParaCero(-0.86, 0.5)).toBe(0.36);
    expect(faltaParaCero(-0.86, 0.86)).toBe(0);
    expect(faltaParaCero(10, 1)).toBe(0);
  });
});

describe('describirArmadas', () => {
  const nombre = (id: string) => ({ a: 'Santa Inés', b: 'Saint Thomas' })[id] ?? id;
  it('suma stock positivo y reservas, y dice dónde', () => {
    const r = describirArmadas(
      [{ cantidad: 20, sucursal_id: 'b' }, { cantidad: '1.000', sucursal_id: 'a' }, { cantidad: -3, sucursal_id: 'a' }],
      [{ cantidad: 2, pedido: { sucursal_id: 'a' } }],
      nombre,
    );
    expect(r).toEqual({ total: 23, reservadas: 2, donde: '20 en Saint Thomas, 1 en Santa Inés y 2 reservadas en pedidos de Santa Inés' });
  });
  it('sin nada: 0', () => {
    expect(describirArmadas([], [], nombre)).toEqual({ total: 0, reservadas: 0, donde: '' });
  });
});

describe('costoSegunLleva', () => {
  it('con costo del pozo: lo que lleva × ese costo', () => {
    expect(costoSegunLleva({ costoPozo: 200, costoActual: 6000, antes: 30, nuevo: 12 })).toBe(2400);
    expect(costoSegunLleva({ costoPozo: '25282', costoActual: null, antes: 1, nuevo: 0.25 })).toBe(6320.5);
  });
  it('sin costo del pozo: escala el que tenía; sin ninguno, null', () => {
    expect(costoSegunLleva({ costoPozo: 0, costoActual: 6000, antes: 30, nuevo: 12 })).toBe(2400);
    expect(costoSegunLleva({ costoPozo: null, costoActual: null, antes: 30, nuevo: 12 })).toBeNull();
    expect(costoSegunLleva({ costoPozo: null, costoActual: 0, antes: 30, nuevo: 12 })).toBeNull();
  });
});

describe('textoSistemaViejo', () => {
  it('nombra la sucursal, los productos y la carga', () => {
    const t = textoSistemaViejo('Suc Sant Thomas', ['Maple Huevos x 30un'], { referencia: 'st-0110', fecha: '2026-10-01T14:46:07Z' });
    expect(t).toMatch(/^En Suc Sant Thomas el stock de «Maple Huevos x 30un» lo trae la planilla del sistema viejo \(última carga st-0110, el 1\/10\)/);
  });
});

describe('armarHistorial', () => {
  const fila = (o: Partial<FilaMovimiento>): FilaMovimiento => ({
    id: 1, cantidad: 0, motivo: null, referencia_tipo: 'fraccionamiento', referencia_id: 'op', creado_en: '2026-10-21T12:00:00Z',
    producto: null, usuario: { nombre: 'Lucía' }, ...o,
  });
  const pozo = { sku: 'HUEVOS-GRANEL', nombre: 'Huevos x unidad', fraccion_de: null, vendido_por_peso: false };
  const docena = { sku: 'HUEVOS-DOC', nombre: 'Huevos x docena', fraccion_de: 'p-pozo', vendido_por_peso: false };

  it('un armado (dos renglones) es una entrada: cuántas presentaciones y cuánto salió del pozo', () => {
    const h = armarHistorial([
      fila({ id: 2, referencia_id: 'op1', cantidad: 2, producto: docena, motivo: 'Fraccionamiento: armado desde Huevos x unidad (24 unidades)' }),
      fila({ id: 1, referencia_id: 'op1', cantidad: -24, producto: pozo, motivo: 'Fraccionamiento: se armaron 2 × Huevos x docena (24 unidades)' }),
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ tipo: 'armado', paquetes: 2, unidades: 24, quien: 'Lucía', presentacion: { sku: 'HUEVOS-DOC' }, pozo: { sku: 'HUEVOS-GRANEL' } });
  });

  it('abrir y pasar al pozo es una "apertura"; la carga del pozo va con su motivo', () => {
    const h = armarHistorial([
      fila({ id: 5, referencia_tipo: 'carga_pozo', referencia_id: 'c1', cantidad: 360, producto: pozo, motivo: 'Carga del pozo: entró sin factura' }),
      fila({ id: 4, referencia_id: 'op2', cantidad: 30, producto: pozo, motivo: 'Desarme: vuelven 30 unidades desde Maple' }),
      fila({ id: 3, referencia_id: 'op2', cantidad: -1, producto: { ...docena, sku: 'L3412', nombre: 'Maple' }, motivo: 'Desarme: 1 × Maple vuelven al pozo de Huevos x unidad' }),
    ]);
    expect(h.map((e) => e.tipo)).toEqual(['carga', 'apertura']);
    expect(h[0]).toMatchObject({ unidades: 360, motivo: 'entró sin factura', presentacion: null, paquetes: null });
    expect(h[1]).toMatchObject({ paquetes: 1, unidades: 30, presentacion: { nombre: 'Maple' } });
  });

  it('una presentación que ya no está en el grupo se reconoce por el motivo', () => {
    const h = armarHistorial([
      fila({ id: 2, referencia_id: 'op1', cantidad: 1, producto: { ...docena, fraccion_de: null }, motivo: 'Fraccionamiento: armado desde Huevos x unidad (12 unidades)' }),
      fila({ id: 1, referencia_id: 'op1', cantidad: -12, producto: pozo, motivo: 'Fraccionamiento: se armaron 1 × Huevos x docena (12 unidades)' }),
    ]);
    expect(h[0]).toMatchObject({ tipo: 'armado', paquetes: 1, unidades: 12, presentacion: { sku: 'HUEVOS-DOC' } });
  });

  it('descarta la operación que quedó cortada por el límite y respeta el tope', () => {
    const h = armarHistorial([
      fila({ id: 3, referencia_tipo: 'carga_pozo', referencia_id: 'c1', cantidad: 10, producto: pozo, motivo: 'Carga del pozo: x' }),
      fila({ id: 2, referencia_tipo: 'carga_pozo', referencia_id: 'c2', cantidad: 20, producto: pozo, motivo: 'Carga del pozo: y' }),
      fila({ id: 1, referencia_id: 'op-cortada', cantidad: -12, producto: pozo, motivo: 'Fraccionamiento: se armaron 1 × Huevos x docena (12 unidades)' }),
    ]);
    expect(h.map((e) => e.unidades)).toEqual([10, 20]);
    expect(armarHistorial([
      fila({ id: 3, referencia_tipo: 'carga_pozo', referencia_id: 'c1', cantidad: 10, producto: pozo }),
      fila({ id: 2, referencia_tipo: 'carga_pozo', referencia_id: 'c2', cantidad: 20, producto: pozo }),
    ], 1)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- servicio

describe('FraccionesService.listar', () => {
  it('trae cada pozo con sus presentaciones, el precio vigente y "alcanza para" por sucursal', async () => {
    const { svc } = armar({
      stock: [
        { producto_id: 'p-pozo', sucursal_id: SUC_A, cantidad: 65 },
        { producto_id: 'p-maple', sucursal_id: SUC_B, cantidad: 20 },
      ],
      precios: [
        { producto_id: 'p-doc', lista_id: 'l-min', precio: 4500, vigente_desde: '2026-10-01T00:00:00Z' },
        { producto_id: 'p-doc', lista_id: 'l-min', precio: 4000, vigente_desde: '2026-09-01T00:00:00Z' },
      ],
    });
    const r = await svc.listar('gerente');
    expect(r.sucursales).toHaveLength(2);
    expect(r.grupos).toHaveLength(1);
    const g = r.grupos[0];
    expect(g.pozo.costo).toBe(100);
    expect(g.pozo).toMatchObject({ sku: 'HUEVOS-GRANEL', porPeso: false, stock: { [SUC_A]: 65, [SUC_B]: 0 } });
    const doc = g.presentaciones.find((p) => p.sku === 'HUEVOS-DOC')!;
    expect(doc.precio).toBe(4500);
    expect(doc.alcanza).toEqual({ [SUC_A]: 5, [SUC_B]: 0 });
    const maple = g.presentaciones.find((p) => p.sku === 'L3412')!;
    expect(maple.stock[SUC_B]).toBe(20);
    expect(maple.alcanza[SUC_A]).toBe(2);
  });

  it('el costo del pozo solo lo ve quien configura (gerencia y dueño)', async () => {
    const { svc } = armar();
    expect((await svc.listar('cajero')).grupos[0].pozo.costo).toBeNull();
    expect((await svc.listar('dueno')).grupos[0].pozo.costo).toBe(100);
  });

  it('sin fraccionables igual devuelve las sucursales (para poder sumar el primero)', async () => {
    const { svc } = armar({ productos: [SUELTO] });
    const r = await svc.listar();
    expect(r.grupos).toEqual([]);
    expect(r.sucursales).toHaveLength(2);
  });
});

describe('FraccionesService.vincular (sumar presentación / fraccionable nuevo)', () => {
  it('vincula un producto existente: queda como presentación del pozo, con auditoría', async () => {
    const { svc, producto, tablas } = armar();
    const r = await svc.vincular({ pozoSku: 'HUEVOS-GRANEL', sku: 'L999', unidades: '18' }, 'u-gerente');
    expect(r).toMatchObject({ sku: 'L999', unidades: 18, nuevo: false });
    expect(producto('p-suelto')).toMatchObject({ fraccion_de: 'p-pozo', unidades_por_fraccion: 18 });
    expect(tablas.auditoria[0]).toMatchObject({ accion: 'fraccion_vinculada', usuario_id: 'u-gerente', entidad_id: 'p-suelto' });
  });

  it('crea una presentación nueva por el alta de productos, con precio y el costo que sale del pozo', async () => {
    const { svc, productos, producto } = armar();
    const r = await svc.vincular({ pozoSku: 'HUEVOS-GRANEL', unidades: 6, nuevo: { nombre: 'Huevos x 1/2 docena', precio: '2500' } }, 'u-1');
    expect(productos.crear).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Huevos x 1/2 docena', precio: 2500, costo: 600, vendidoPorPeso: false, alicuotaIva: 21 }),
      'u-1',
    );
    expect(r).toMatchObject({ nuevo: true, sku: '90001' });
    expect(producto('p-nuevo')).toMatchObject({ fraccion_de: 'p-pozo', unidades_por_fraccion: 6, categoria_id: 'cat-huevos' });
  });

  it('una presentación nueva sin precio no se crea', async () => {
    const { svc, productos } = armar();
    await expect(svc.vincular({ pozoSku: 'HUEVOS-GRANEL', unidades: 6, nuevo: { nombre: 'Media', precio: '' } })).rejects.toThrow(/precio/);
    expect(productos.crear).not.toHaveBeenCalled();
  });

  it('pozo por kilo: la presentación lleva kilos (0,250)', async () => {
    const { svc, producto } = armar();
    await svc.vincular({ pozoSku: 'Q-KG', sku: 'L999', unidades: '0,250' });
    expect(producto('p-suelto')).toMatchObject({ fraccion_de: 'p-queso', unidades_por_fraccion: 0.25 });
  });

  it.each([
    ['decimales en un pozo por unidad', { pozoSku: 'HUEVOS-GRANEL', sku: 'L999', unidades: '1,5' }, /unidades enteras/],
    ['el pozo es presentación de otro', { pozoSku: 'HUEVOS-DOC', sku: 'L999', unidades: 2 }, /no puede ser pozo/],
    ['presentación de sí mismo', { pozoSku: 'HUEVOS-GRANEL', sku: 'HUEVOS-GRANEL', unidades: 2 }, /sí mismo/],
    ['ya está en el grupo', { pozoSku: 'HUEVOS-GRANEL', sku: 'HUEVOS-DOC', unidades: 12 }, /ya está en este grupo/],
    ['es presentación de otro pozo', { pozoSku: 'Q-KG', sku: 'HUEVOS-DOC', unidades: 1 }, /ya es presentación de "Huevos x unidad"/],
    ['es el pozo de otro grupo', { pozoSku: 'Q-KG', sku: 'HUEVOS-GRANEL', unidades: 1 }, /es el pozo de otro/],
    ['se vende por kilo', { pozoSku: 'HUEVOS-GRANEL', sku: 'Q-KG', unidades: 1 }, /se vende por kilo/],
    ['sin presentación', { pozoSku: 'HUEVOS-GRANEL', unidades: 1 }, /Elegí un producto/],
    ['sin unidades', { pozoSku: 'HUEVOS-GRANEL', sku: 'L999', unidades: '' }, /mayor que 0/],
  ])('rechaza: %s', async (_caso, dto, mensaje) => {
    const { svc, producto } = armar();
    await expect(svc.vincular(dto as any)).rejects.toThrow(mensaje);
    expect(producto('p-suelto').fraccion_de).toBeNull();
  });
});

describe('FraccionesService.editar', () => {
  it('no cambia lo que lleva si hay armadas (al abrirlas volverían con la cuenta nueva)', async () => {
    const { svc, producto } = armar({ stock: [{ producto_id: 'p-maple', sucursal_id: SUC_B, cantidad: 20 }] });
    await expect(svc.editar('p-maple', { unidades: 24 })).rejects.toThrow(/Hay armadas/);
    expect(producto('p-maple').unidades_por_fraccion).toBe(30);
  });

  // Hallazgo 21/10: la reserva de un pedido baja el stock a 0 y el candado no
  // la veía; al cancelar, cancelar_pedido devolvía 2 "docenas" de 6 huevos.
  it('las armadas reservadas en un pedido abierto también frenan el cambio', async () => {
    const { svc, producto } = armar({
      stock: [{ producto_id: 'p-doc', sucursal_id: SUC_A, cantidad: 0 }],
      pedidos_items: [{ producto_id: 'p-doc', cantidad: 2, pedido: { sucursal_id: SUC_A, estado: 'en_preparacion', reserva_stock: true } }],
    });
    await expect(svc.editar('p-doc', { unidades: 6 })).rejects.toThrow(/2 reservadas en pedidos de Santa Inés.*esperá que se entreguen o se cancelen/);
    expect(producto('p-doc').unidades_por_fraccion).toBe(12);
  });

  it('un pedido ya entregado, cancelado o sin reserva no frena', async () => {
    const { svc, producto } = armar({
      pedidos_items: [
        { producto_id: 'p-doc', cantidad: 2, pedido: { sucursal_id: SUC_A, estado: 'entregado', reserva_stock: true } },
        { producto_id: 'p-doc', cantidad: 2, pedido: { sucursal_id: SUC_A, estado: 'cancelado', reserva_stock: true } },
        { producto_id: 'p-doc', cantidad: 2, pedido: { sucursal_id: SUC_A, estado: 'recibido', reserva_stock: false } },
      ],
    });
    await svc.editar('p-doc', { unidades: 6 });
    expect(producto('p-doc').unidades_por_fraccion).toBe(6);
  });

  // Hallazgo 21/10: el costo quedaba con el número viejo y la caja pedía PIN
  // por "venta bajo costo" (o dejaba vender bajo costo sin PIN).
  it('al cambiar lo que lleva, el costo se recalcula con el del pozo (auditado)', async () => {
    const { svc, producto, tablas } = armar({ productos: [POZO, { ...DOCENA, costo: 1200 }] });
    const r = await svc.editar('p-doc', { unidades: 30 }, 'u-1');
    expect(r).toEqual({ ok: true, costo: 3000 });
    expect(producto('p-doc')).toMatchObject({ unidades_por_fraccion: 30, costo: 3000 });
    expect(tablas.auditoria[0]).toMatchObject({ datos_antes: { unidades: 12, costo: 1200 }, datos_despues: { unidades: 30, costo: 3000 } });
  });

  it('si el pozo no tiene costo, escala el que tenía; si no hay ninguno, no lo toca', async () => {
    const sinCosto = { ...POZO, costo: null };
    const a = armar({ productos: [sinCosto, { ...DOCENA, costo: 1200 }] });
    expect(await a.svc.editar('p-doc', { unidades: 6 })).toEqual({ ok: true, costo: 600 });
    const b = armar({ productos: [sinCosto, { ...DOCENA, costo: null }] });
    expect(await b.svc.editar('p-doc', { unidades: 6 })).toEqual({ ok: true });
    expect(b.producto('p-doc').costo).toBeNull();
  });

  it('sin armadas cambia las unidades (auditado) y nombre/precio van por la ficha de productos', async () => {
    const { svc, producto, productos, tablas } = armar({ stock: [{ producto_id: 'p-doc', sucursal_id: SUC_A, cantidad: 0 }] });
    await svc.editar('p-doc', { unidades: '6', nombre: 'Huevos x 1/2 docena', precio: '2.500' }, 'u-1');
    expect(producto('p-doc').unidades_por_fraccion).toBe(6);
    expect(tablas.auditoria[0]).toMatchObject({ accion: 'fraccion_editada', datos_antes: { unidades: 12 }, datos_despues: { unidades: 6 } });
    expect(productos.editar).toHaveBeenCalledWith('p-doc', { nombre: 'Huevos x 1/2 docena', precio: 2500 }, 'u-1');
  });

  it('solo edita presentaciones', async () => {
    const { svc } = armar();
    await expect(svc.editar('p-suelto', { nombre: 'x' })).rejects.toThrow(/no es una presentación/);
  });
});

describe('FraccionesService.quitar', () => {
  it('sin armadas desvincula sin borrar: el producto sigue activo en el catálogo', async () => {
    const { svc, producto, tablas } = armar({ stock: [{ producto_id: 'p-maple', sucursal_id: SUC_B, cantidad: 0 }] });
    const r = await svc.quitar('p-maple', 'u-1');
    expect(r).toMatchObject({ ok: true, nombre: 'Maple x 30' });
    expect(producto('p-maple')).toMatchObject({ fraccion_de: null, unidades_por_fraccion: null, activo: true });
    expect(tablas.auditoria[0]).toMatchObject({ accion: 'fraccion_quitada', datos_antes: { pozo: 'p-pozo', unidades: 30 } });
  });

  // Hallazgo 21/10: quitar y volver a sumar con otro número esquivaba el
  // candado de editar. 20 maples armados devueltos como "de 24" = 120 huevos
  // que desaparecen al abrirlos.
  it('con armadas no se saca del grupo (si no, se esquiva el candado de lo que lleva)', async () => {
    const { svc, producto } = armar({
      stock: [
        { producto_id: 'p-maple', sucursal_id: SUC_B, cantidad: 20 },
        { producto_id: 'p-maple', sucursal_id: SUC_A, cantidad: 1 },
      ],
    });
    await expect(svc.quitar('p-maple', 'u-1')).rejects.toThrow(/Hay armadas \(20 en Saint Thomas y 1 en Santa Inés\)/);
    expect(producto('p-maple')).toMatchObject({ fraccion_de: 'p-pozo', unidades_por_fraccion: 30 });
  });

  it('las reservadas en un pedido abierto también cuentan', async () => {
    const { svc, producto } = armar({
      pedidos_items: [{ producto_id: 'p-maple', cantidad: 2, pedido: { sucursal_id: SUC_A, estado: 'recibido', reserva_stock: true } }],
    });
    await expect(svc.quitar('p-maple')).rejects.toThrow(/2 reservadas en pedidos de Santa Inés/);
    expect(producto('p-maple').fraccion_de).toBe('p-pozo');
  });
});

describe('FraccionesService.cargarPozo (mismas reglas que un ajuste de stock)', () => {
  const movimiento = { registrar_movimiento: () => ({ data: 77 }) };

  it('una carga chica entra como ajuste del pozo, marcada "carga_pozo" para el historial', async () => {
    const { svc, db } = armar({}, movimiento);
    await svc.cargarPozo('p-pozo', { sucursalId: SUC_A, cantidad: '30', motivo: 'entró sin factura' }, undefined, 'u-dep');
    const args = db.rpc.mock.calls.find((c: any[]) => c[0] === 'registrar_movimiento')[1];
    expect(args).toMatchObject({
      p_producto_id: 'p-pozo', p_sucursal_id: SUC_A, p_tipo: 'ajuste', p_cantidad: 30,
      p_motivo: 'Carga del pozo: entró sin factura', p_referencia_tipo: 'carga_pozo', p_usuario_id: 'u-dep',
    });
    expect(args.p_referencia_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('depósito, arriba del tope y sin PIN: se rechaza pidiendo supervisor', async () => {
    const { svc, db } = armar({}, movimiento);
    await expect(
      svc.cargarPozo('p-pozo', { sucursalId: SUC_A, cantidad: 360, motivo: 'llegaron 12 maples' }, undefined, 'u-dep'),
    ).rejects.toThrow(/supervisor \(PIN\)/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('depósito con el token del PIN: lo valida CajaService y queda auditado a nombre del supervisor', async () => {
    const { svc, caja, tablas } = armar({}, movimiento);
    await svc.cargarPozo('p-pozo', { sucursalId: SUC_A, cantidad: 360, motivo: 'llegaron 12 maples', autorizacionToken: 'tok-1' }, undefined, 'u-dep');
    expect(caja.consumirAutorizacion).toHaveBeenCalledWith('tok-1');
    expect(tablas.auditoria[0]).toMatchObject({ accion: 'ajuste_autorizado', usuario_id: 'sup-real' });
  });

  it('gerencia se autoriza sola', async () => {
    const { svc, caja, db } = armar({}, movimiento);
    await svc.cargarPozo('p-pozo', { sucursalId: SUC_A, cantidad: 360, motivo: 'llegaron 12 maples' }, 'u-gerente', 'u-gerente');
    expect(caja.consumirAutorizacion).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('registrar_movimiento', expect.objectContaining({ p_cantidad: 360 }));
  });

  // Hallazgo 21/10: con el pozo en negativo, la base rechazaba hasta una
  // carga ("Stock insuficiente: la operación dejaría -0.360 unidades").
  it('con el pozo en negativo dice cuánto hay que cargar para dejarlo en cero', async () => {
    const { svc, db } = armar({ productos: [QUESO, { ...SUELTO, fraccion_de: 'p-queso', unidades_por_fraccion: 0.25 }], stock: [{ producto_id: 'p-queso', sucursal_id: SUC_A, cantidad: -0.86 }] }, movimiento);
    await expect(svc.cargarPozo('p-queso', { sucursalId: SUC_A, cantidad: '0,5', motivo: 'entró sin factura' }, 'u-ger', 'u-ger')).rejects.toThrow(
      /está en -0,86 kg .*cargá al menos 0,86 kg para dejarlo en cero/,
    );
    expect(db.rpc).not.toHaveBeenCalled();
    await svc.cargarPozo('p-queso', { sucursalId: SUC_A, cantidad: '0,86', motivo: 'entró sin factura' }, 'u-ger', 'u-ger');
    expect(db.rpc).toHaveBeenCalledWith('registrar_movimiento', expect.objectContaining({ p_cantidad: 0.86 }));
  });

  it.each([
    ['un producto que no es pozo', 'p-suelto', { cantidad: 5, motivo: 'xxx' }, /no es el pozo/],
    ['una presentación', 'p-doc', { cantidad: 5, motivo: 'xxx' }, /es una presentación/],
    ['decimales en un pozo por unidad', 'p-pozo', { cantidad: '2,5', motivo: 'xxx' }, /unidades enteras/],
    ['sin motivo', 'p-pozo', { cantidad: 5, motivo: ' ' }, /motivo/],
    ['cantidad negativa', 'p-pozo', { cantidad: -5, motivo: 'xxx' }, /mayor que 0/],
  ])('rechaza: %s', async (_caso, pozoId, dto, mensaje) => {
    const { svc, db } = armar({}, movimiento);
    await expect(svc.cargarPozo(pozoId, { sucursalId: SUC_A, ...dto } as any, 'u-gerente', 'u-gerente')).rejects.toThrow(mensaje);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('FraccionesService.fraccionar', () => {
  const sinStock = { fraccionar_producto: () => ({ error: { message: 'Stock insuficiente: la operación dejaría -12 unidades' } }) };

  it('pasa a la RPC y traduce el stock insuficiente', async () => {
    const { svc, db } = armar({}, sinStock);
    await expect(svc.fraccionar({ destinoId: 'p-doc', cantidad: 1, sucursalId: SUC_A }, 'u-1')).rejects.toThrow(/No alcanza lo que hay en el pozo: hay 0 unidades/);
    expect(db.rpc).toHaveBeenCalledWith('fraccionar_producto', { p_destino: 'p-doc', p_cantidad: 1, p_sucursal: SUC_A, p_usuario: 'u-1' });
  });

  it('abrir con el pozo en negativo no se atribuye a las armadas', async () => {
    const { svc } = armar(
      { stock: [{ producto_id: 'p-pozo', sucursal_id: SUC_A, cantidad: -20 }, { producto_id: 'p-doc', sucursal_id: SUC_A, cantidad: 1 }] },
      sinStock,
    );
    await expect(svc.fraccionar({ destinoId: 'p-doc', cantidad: -1, sucursalId: SUC_A })).rejects.toThrow(
      /El pozo está en -20 unidades .*quedaría en -8 unidades.*Cargá al menos 8 unidades/,
    );
  });

  // Hallazgo 21/10: Sant Thomas vende con el sistema viejo y la carga de la
  // planilla pisa el stock de los productos con código viejo (L3412, L3430)
  // pero no el del pozo: armar o abrir ahí duplica o borra huevos.
  describe('sucursal que todavía toma el stock del sistema viejo', () => {
    const carga = { id: 800, entidad: 'sistema_viejo', accion: 'importacion_sistema_viejo', entidad_id: 'st-0110', creado_en: new Date(Date.now() - 20 * 86_400_000).toISOString(), datos_despues: { sucursal_id: SUC_B } };

    it('no arma ni abre lo que trae la planilla', async () => {
      const { svc, db } = armar({ auditoria: [carga] });
      await expect(svc.fraccionar({ destinoId: 'p-maple', cantidad: -1, sucursalId: SUC_B })).rejects.toThrow(
        /En Saint Thomas el stock de «Maple x 30» lo trae la planilla del sistema viejo \(última carga st-0110/,
      );
      expect(db.rpc).not.toHaveBeenCalled();
    });

    it('en la otra sucursal, o con productos que la planilla no trae, sigue igual', async () => {
      const { svc, db } = armar({ auditoria: [carga] }, { fraccionar_producto: () => ({ data: { stock_madre: 0 } }) });
      await svc.fraccionar({ destinoId: 'p-maple', cantidad: -1, sucursalId: SUC_A });
      await svc.fraccionar({ destinoId: 'p-doc', cantidad: 1, sucursalId: SUC_B });
      expect(db.rpc).toHaveBeenCalledTimes(2);
    });

    it('una carga vieja (más de 45 días) ya no frena', async () => {
      const vieja = { ...carga, creado_en: new Date(Date.now() - 60 * 86_400_000).toISOString() };
      const { svc, db } = armar({ auditoria: [vieja] }, { fraccionar_producto: () => ({ data: {} }) });
      await svc.fraccionar({ destinoId: 'p-maple', cantidad: -1, sucursalId: SUC_B });
      expect(db.rpc).toHaveBeenCalled();
    });

    it('la lista marca la sucursal y los productos con código viejo', async () => {
      const { svc } = armar({ auditoria: [carga] });
      const r = await svc.listar('gerente');
      expect(r.sucursales.find((x) => x.id === SUC_B)?.sistemaViejo).toMatchObject({ referencia: 'st-0110' });
      expect(r.sucursales.find((x) => x.id === SUC_A)?.sistemaViejo).toBeNull();
      const g = r.grupos[0];
      expect(g.pozo.sistemaViejo).toBe(false);
      expect(g.presentaciones.find((p) => p.sku === 'L3412')?.sistemaViejo).toBe(true);
      expect(g.presentaciones.find((p) => p.sku === 'HUEVOS-DOC')?.sistemaViejo).toBe(false);
    });

    it('tampoco se carga ahí un pozo que trae la planilla', async () => {
      const { svc, db } = armar({ auditoria: [carga], productos: [{ ...POZO, codigo_legacy: '9999' }, DOCENA] }, { registrar_movimiento: () => ({ data: 1 }) });
      await expect(svc.cargarPozo('p-pozo', { sucursalId: SUC_B, cantidad: 5, motivo: 'entró sin factura' }, 'u-ger', 'u-ger')).rejects.toThrow(/sistema viejo/);
      expect(db.rpc).not.toHaveBeenCalled();
    });
  });

  it('las presentaciones van enteras', async () => {
    const { svc } = armar();
    await expect(svc.fraccionar({ destinoId: 'p-doc', cantidad: 1.5, sucursalId: SUC_A })).rejects.toThrow(BadRequestException);
  });
});

// --------------------------------------------------------------- controlador

describe('FraccionesController', () => {
  const roles = (metodo: keyof FraccionesController) =>
    Reflect.getMetadata(ROLES, FraccionesController.prototype[metodo] as any) ?? Reflect.getMetadata(ROLES, FraccionesController);

  it('configurar es solo de gerencia y dueño; cargar el pozo, de los mismos roles que un ajuste', () => {
    expect(roles('vincular')).toEqual(['gerente', 'dueno']);
    expect(roles('editar')).toEqual(['gerente', 'dueno']);
    expect(roles('quitar')).toEqual(['gerente', 'dueno']);
    expect(roles('cargarPozo')).toEqual(['deposito', 'gerente', 'dueno']);
    expect(roles('fraccionar')).toEqual(['cajero', 'deposito', 'gerente', 'dueno']);
  });

  it('depósito puede pedir el token del PIN de supervisor (si no, el tope le cerraba la puerta)', () => {
    expect(Reflect.getMetadata(ROLES, CajaController.prototype.autorizar)).toContain('deposito');
  });

  // Hallazgo 21/10 (anterior a Fraccionar): administrativo entra a ajustes,
  // mermas y conteos heredando depósito, y la cuenta "rol !== 'deposito'" lo
  // dejaba autorizado por sí mismo, sin tope ni PIN.
  it('ajustes, mermas y conteos: administrativo necesita el PIN como depósito', async () => {
    const stock = { registrarAjuste: jest.fn(), finalizarConteo: jest.fn() } as any;
    const ctrl = new StockController(stock);
    const dto = { sku: 'X', sucursalId: SUC_A, cantidad: 5000, motivo: 'x', autorizadoPor: 'trucho' } as any;
    for (const rol of ['administrativo', 'deposito', 'gerente', 'dueno']) {
      const req = { usuario: { sub: `u-${rol}`, rol } };
      ctrl.ajuste(dto, req);
      ctrl.merma(dto, req);
      if (rol === 'administrativo' || rol === 'deposito') {
        expect(() => ctrl.finalizarConteo('c-1', {}, req)).toThrow(/supervisor \(PIN\)/);
      } else {
        ctrl.finalizarConteo('c-1', {}, req);
      }
    }
    expect(stock.registrarAjuste.mock.calls.map((c: any[]) => c[0].autorizadoPor)).toEqual([
      undefined, undefined, undefined, undefined, 'u-gerente', 'u-gerente', 'u-dueno', 'u-dueno',
    ]);
    expect(stock.finalizarConteo.mock.calls.map((c: any[]) => c[1])).toEqual(['u-gerente', 'u-dueno']);
  });

  it('cargar el pozo: solo gerencia/dueño se autorizan solos, el resto necesita el PIN', () => {
    const svc = { cargarPozo: jest.fn() } as any;
    const ctrl = new FraccionesController(svc);
    const dto = { sucursalId: SUC_A, cantidad: 5, motivo: 'x', autorizadoPor: 'trucho' } as any;
    ctrl.cargarPozo('p-pozo', dto, { usuario: { sub: 'u-dep', rol: 'deposito' } });
    ctrl.cargarPozo('p-pozo', dto, { usuario: { sub: 'u-adm', rol: 'administrativo' } });
    ctrl.cargarPozo('p-pozo', dto, { usuario: { sub: 'u-ger', rol: 'gerente' } });
    expect(svc.cargarPozo.mock.calls.map((c: any[]) => c[2])).toEqual([undefined, undefined, 'u-ger']);
  });
});

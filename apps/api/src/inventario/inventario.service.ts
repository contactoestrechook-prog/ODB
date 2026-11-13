import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { leerAbastecimiento, leerCostos } from '../abastecimiento/motor';
import { ordenarPorRelevancia } from '../catalogo/relevancia';
import {
  escalones, margenSobreCosto, nivelEnElTiempo, nombreSucursal, origenDelCosto, ventasPorPeriodo,
  type MovimientoCrudo, type Periodo,
} from './series';
import { armarEntrada, esVista, type FilaMotor } from './entrada';

// Los períodos de venta que tiene cargados cada sucursal (los del sistema
// viejo). `ventas_historicas` tiene ~50.000 renglones y PostgREST no agrupa: se
// camina de a un período hacia atrás (hoy son 16) y se guarda diez minutos.
const MEMO_PERIODOS_MS = 600_000;
const TOPE_PERIODOS = 80;
let memoPeriodos: { en: number; porSucursal: Map<string, Periodo[]> } | null = null;
// los productos que se venden por peso (son pocos y casi no cambian)
let memoPorPeso: { en: number; ids: Set<string> } | null = null;
// La lectura completa del motor para la entrada: son ~10 páginas de ~1 s cada
// una. Fresca vale un minuto (lo mismo que la memo del motor); hasta 15 minutos
// se muestra la última mientras se renueva por detrás, así la pantalla no
// espera. Pasado eso, se espera la lectura nueva.
const MOTOR_FRESCO_MS = 60_000;
const MOTOR_VIEJO_MS = 15 * 60_000;
let memoMotor: { en: number; filas: FilaMotor[] } | null = null;
let renovandoMotor: Promise<FilaMotor[]> | null = null;

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numONada = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
/** las cantidades van con tres decimales (se vende por peso) */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

// El inventario de un producto: cuánto hay en cada sucursal, cómo llegó ahí,
// cuánto se vende y a cuánto se compra. Las cuentas están en series.ts; el
// ritmo, la cobertura y la alerta son los del motor de Mesa de compras (una
// sola fuente de números, ver abastecimiento/motor.ts).
@Injectable()
export class InventarioService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private async sucursales(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.db.from('sucursales').select('id, nombre, activa').order('nombre');
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).filter((s) => s.activa !== false).map((s) => ({ id: s.id, nombre: nombreSucursal(s.nombre) }));
  }

  // ---------- el buscador: nombre, SKU o código de barras ----------
  async buscar(q: string) {
    const t = (q ?? '').trim();
    if (t.length < 2) return [];
    const TOPE = 12;
    const CANDIDATOS = 40; // se ordenan acá por relevancia y quedan los 12 primeros
    let orden: string[] = [];

    if (/^\d{8,14}$/.test(t)) {
      const { data } = await this.db.from('codigos_barras').select('producto_id').eq('codigo', t).limit(5);
      orden = ((data ?? []) as any[]).map((r) => r.producto_id);
    }
    if (!orden.length) {
      // las mismas reglas que el buscador de arriba (todas las palabras, sin
      // tildes ni plurales, con errores de tipeo si no hay nada): los activos
      // primero y, si son pocos, también los dados de baja, que pueden tener stock
      const parecidos = async (soloActivos: boolean) => {
        const { data, error } = await this.db
          .rpc('buscar_productos', { p_q: t, p_solo_activos: soloActivos })
          .order('nivel')
          .order('en_nombre', { ascending: false })
          .order('parecido', { ascending: false })
          .limit(CANDIDATOS);
        if (error) throw new Error(error.message);
        return ((data ?? []) as any[]).map((r) => r.producto_id as string);
      };
      // el SKU escrito entero entra siempre (la base ordena por parecido del nombre)
      const [exacto, activos] = await Promise.all([
        /^[a-z]{0,3}\d{1,8}$/i.test(t) ? this.db.from('productos').select('id').ilike('sku', t).limit(1) : Promise.resolve({ data: [] as any[] }),
        parecidos(true),
      ]);
      orden = [...((exacto.data ?? []) as any[]).map((r) => r.id as string), ...activos];
      if (orden.length < 4) orden.push(...(await parecidos(false)));
      orden = [...new Set(orden)];
    }
    // la regla del catálogo: gana el que empieza con lo escrito y el nombre más
    // corto; los dados de baja, al final (catalogo/relevancia.ts)
    return ordenarPorRelevancia(await this.conStock(orden), t).slice(0, TOPE);
  }

  // ---------- la entrada: los que más se venden, para abrirlos con un toque ----------
  async masVendidos() {
    const { data, error } = await this.db
      .from('productos')
      .select('id')
      .eq('activo', true)
      .gt('unidades_vendidas', 0)
      .order('unidades_vendidas', { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return this.conStock(((data ?? []) as any[]).map((r) => r.id as string));
  }

  // ---------- la entrada: cómo está el stock y las listas para recorrer ----------
  // La primera lectura del motor tarda unos segundos (después queda un minuto en
  // memoria, compartida con Mesa de compras, el Analista y los informes); por eso
  // la pantalla la pide aparte y el buscador anda mientras tanto.
  async entrada(opciones: { sucursal?: string; vista?: string; desde?: string | number; conPlata: boolean }) {
    const [filas, sucursales, costos, porPeso] = await Promise.all([
      this.filasDelMotor(),
      this.sucursales(),
      opciones.conPlata ? leerCostos(this.db) : Promise.resolve(new Map<string, number>()),
      this.porPeso(),
    ]);
    const soloVista = esVista(opciones.vista) ? opciones.vista : undefined;
    return armarEntrada({
      filas, sucursales, porPeso, costos,
      sucursal: opciones.sucursal?.trim() || null,
      conPlata: opciones.conPlata,
      soloVista,
      desde: Number(opciones.desde) || 0,
    });
  }

  private filasDelMotor(): Promise<FilaMotor[]> {
    const renovar = () => {
      renovandoMotor ??= (leerAbastecimiento(this.db) as Promise<FilaMotor[]>)
        .then((filas) => {
          memoMotor = { en: Date.now(), filas };
          return filas;
        })
        .finally(() => { renovandoMotor = null; });
      return renovandoMotor;
    };
    const edad = memoMotor ? Date.now() - memoMotor.en : Infinity;
    if (memoMotor && edad < MOTOR_FRESCO_MS) return Promise.resolve(memoMotor.filas);
    if (memoMotor && edad < MOTOR_VIEJO_MS) {
      renovar().catch(() => undefined); // si falla, la próxima vuelve a probar
      return Promise.resolve(memoMotor.filas);
    }
    return renovar();
  }

  private async porPeso(): Promise<Set<string>> {
    if (memoPorPeso && Date.now() - memoPorPeso.en < MEMO_PERIODOS_MS) return memoPorPeso.ids;
    const { data, error } = await this.db.from('productos').select('id').eq('vendido_por_peso', true).limit(5000);
    if (error) throw new Error(error.message);
    const ids = new Set(((data ?? []) as any[]).map((r) => r.id as string));
    memoPorPeso = { en: Date.now(), ids };
    return ids;
  }

  /** Los productos de la lista, en ese orden, con lo que hay en cada sucursal. */
  private async conStock(orden: string[]) {
    if (!orden.length) return [];
    const [{ data: productos, error }, { data: stock }, sucursales] = await Promise.all([
      this.db.from('productos').select('id, sku, nombre, activo, categoria:categorias(nombre), marca:marcas(nombre)').in('id', orden),
      this.db.from('stock').select('producto_id, sucursal_id, cantidad').in('producto_id', orden),
      this.sucursales(),
    ]);
    if (error) throw new Error(error.message);
    const cantidad = new Map<string, number>();
    for (const s of (stock ?? []) as any[]) cantidad.set(`${s.producto_id}|${s.sucursal_id}`, num(s.cantidad));
    return ((productos ?? []) as any[])
      .sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))
      .map((p) => {
        const porSucursal = sucursales.map((s) => ({ sucursalId: s.id, sucursal: s.nombre, cantidad: cantidad.get(`${p.id}|${s.id}`) ?? 0 }));
        return {
          sku: p.sku as string, nombre: p.nombre as string, rubro: (p.categoria?.nombre as string) ?? null, marca: (p.marca?.nombre as string) ?? null,
          activo: p.activo !== false,
          total: r3(porSucursal.reduce((t2, s) => t2 + s.cantidad, 0)),
          stock: porSucursal,
        };
      });
  }

  private async periodos(sucursalIds: string[]): Promise<Map<string, Periodo[]>> {
    if (memoPeriodos && Date.now() - memoPeriodos.en < MEMO_PERIODOS_MS) return memoPeriodos.porSucursal;
    const deUna = async (sucursalId: string): Promise<Periodo[]> => {
      const lista: Periodo[] = [];
      let antesDe: string | null = null;
      for (let i = 0; i < TOPE_PERIODOS; i++) {
        let consulta = this.db.from('ventas_historicas').select('desde, hasta').eq('sucursal_id', sucursalId);
        if (antesDe) consulta = consulta.lt('hasta', antesDe);
        const { data, error } = await consulta.order('hasta', { ascending: false }).order('desde', { ascending: false }).limit(1);
        if (error) throw new Error(error.message);
        const p = (data ?? [])[0] as Periodo | undefined;
        if (!p) break;
        lista.push({ desde: String(p.desde).slice(0, 10), hasta: String(p.hasta).slice(0, 10) });
        antesDe = p.hasta;
      }
      return lista.reverse();
    };
    const listas = await Promise.all(sucursalIds.map(deUna));
    const porSucursal = new Map(sucursalIds.map((id, i) => [id, listas[i]]));
    memoPeriodos = { en: Date.now(), porSucursal };
    return porSucursal;
  }

  // El motor no filtra por producto: se le pasa el SKU con el nombre (tienen que
  // estar todas las palabras) y se dejan las filas de este producto. Probado con
  // 60 productos al azar: 60 de 60, y nunca más de dos filas.
  private async motor(productoId: string, sku: string, nombre: string, conRed: boolean): Promise<any[]> {
    const { data, error } = await this.db.rpc('abastecimiento', {
      p_sucursal: null, p_solo_alertas: false, p_proveedor: null, p_q: `${sku} ${nombre}`, p_limite: 200,
    });
    const filas = error ? [] : ((data ?? []) as any[]).filter((f) => f.producto_id === productoId);
    if (filas.length || !conRed) return filas;
    // red de seguridad: la lectura completa que comparten el Analista y los informes
    try {
      return (await leerAbastecimiento(this.db)).filter((f) => f.producto_id === productoId);
    } catch {
      return [];
    }
  }

  // ---------- la ficha ----------
  // `conPlata`: la caja ve el stock y las ventas, no los costos ni el margen.
  async producto(sku: string, conPlata: boolean) {
    const { data: p, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, activo, costo, vendido_por_peso, marca:marcas(nombre), categoria:categorias(nombre), codigos_barras(codigo)')
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new NotFoundException(`No existe el producto ${sku}`);
    const prod = p as any;
    const sucursales = await this.sucursales();

    const [stock, movs, ventas, periodos, costos, precios, compras] = await Promise.all([
      this.db.from('stock').select('sucursal_id, cantidad, stock_minimo, ubicacion').eq('producto_id', prod.id),
      this.db
        .from('movimientos_stock')
        .select('id, sucursal_id, tipo, cantidad, motivo, referencia_tipo, referencia_id, creado_en, usuario:usuarios!movimientos_stock_usuario_id_fkey(nombre)')
        .eq('producto_id', prod.id)
        .order('id', { ascending: true })
        .limit(1000),
      this.db.from('ventas_historicas').select('sucursal_id, desde, hasta, unidades').eq('producto_id', prod.id).limit(1000),
      this.periodos(sucursales.map((s) => s.id)),
      conPlata
        ? this.db.from('costos_historial').select('costo, origen, creado_en, proveedor:proveedores(razon_social)').eq('producto_id', prod.id).order('creado_en').limit(500)
        : Promise.resolve({ data: [] as any[], error: null }),
      conPlata
        ? this.db.from('precios').select('precio, vigente_desde, lista:listas_precios(nombre, es_base)').eq('producto_id', prod.id).order('vigente_desde').limit(500)
        : Promise.resolve({ data: [] as any[], error: null }),
      conPlata
        ? this.db
            .from('compras_historial')
            .select('fecha, numero, unidades, costo_unitario, proveedor:proveedores(razon_social)')
            .eq('producto_id', prod.id)
            .order('fecha', { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    for (const r of [stock, movs, ventas, costos, precios, compras]) if (r.error) throw new Error(r.error.message);

    const filasStock = (stock.data ?? []) as any[];
    const motor = await this.motor(prod.id, prod.sku, prod.nombre, prod.activo !== false && filasStock.length > 0);

    // cuánto hay y cómo llegó ahí, sucursal por sucursal
    const movimientos = (movs.data ?? []) as unknown as MovimientoCrudo[];
    const niveles = sucursales.map((s) => {
      const fila = filasStock.find((f) => f.sucursal_id === s.id);
      const nivel = nivelEnElTiempo(movimientos.filter((m) => m.sucursal_id === s.id), num(fila?.cantidad));
      return { sucursal: s, fila, ...nivel };
    });
    const pasos = niveles.flatMap((nv) => nv.pasos).sort((a, b) => a.id - b.id);

    const delMotor = (id: string) => motor.find((f) => f.sucursal_id === id);
    const filaProveedor = motor.find((f) => f.proveedor);

    const preciosBase = ((precios.data ?? []) as any[]).filter((r) => r.lista?.es_base);
    const mayorista = ((precios.data ?? []) as any[]).filter((r) => r.lista?.nombre === 'Mayorista');
    const serieCostos = escalones(((costos.data ?? []) as any[]).map((r) => ({
      en: r.creado_en as string, valor: r.costo, proveedor: (r.proveedor?.razon_social as string) ?? null, origen: origenDelCosto(r.origen),
    })));
    const seriePrecios = escalones(preciosBase.map((r) => ({ en: r.vigente_desde as string, valor: r.precio })));
    const precioHoy = seriePrecios.length ? seriePrecios[seriePrecios.length - 1].valor : null;
    const costoHoy = numONada(prod.costo) || (serieCostos.length ? serieCostos[serieCostos.length - 1].valor : null);

    return {
      producto: {
        sku: prod.sku, nombre: prod.nombre, marca: prod.marca?.nombre ?? null, rubro: prod.categoria?.nombre ?? null,
        activo: prod.activo !== false, porPeso: !!prod.vendido_por_peso,
        codigos: ((prod.codigos_barras ?? []) as any[]).map((c) => c.codigo as string),
      },
      total: r3(niveles.reduce((t, nv) => t + num(nv.fila?.cantidad), 0)),
      sucursales: niveles.map((nv) => {
        const m = delMotor(nv.sucursal.id);
        return {
          id: nv.sucursal.id, nombre: nv.sucursal.nombre,
          stock: num(nv.fila?.cantidad), ubicacion: (nv.fila?.ubicacion as string) ?? null, minimo: num(nv.fila?.stock_minimo),
          enCamino: num(m?.en_camino), ritmoDia: numONada(m?.ritmo_dia), ritmoFuente: (m?.ritmo_fuente as string) ?? null,
          coberturaDias: numONada(m?.cobertura_dias), tendenciaPct: numONada(m?.tendencia_pct),
          alerta: (m?.alerta as string) ?? null, sugerido: num(m?.cantidad_sugerida),
        };
      }),
      proveedor: filaProveedor
        ? { nombre: filaProveedor.proveedor as string, plazoDias: num(filaProveedor.plazo_dias), plazoFuente: (filaProveedor.plazo_fuente as string) ?? null }
        : null,
      nivel: {
        desde: pasos.length ? pasos[0].en : null,
        hasta: new Date().toISOString(),
        series: niveles.map((nv) => ({
          sucursalId: nv.sucursal.id, inicial: nv.inicial,
          // un punto por cambio de verdad: la apertura no mueve el nivel
          puntos: nv.pasos.filter((ps) => ps.cambio !== 0).map((ps) => ({ en: ps.en, saldo: ps.saldo })),
        })),
      },
      movimientos: [...pasos].reverse(),
      ventas: sucursales.map((s) => ({
        sucursalId: s.id,
        periodos: ventasPorPeriodo(periodos.get(s.id) ?? [], ((ventas.data ?? []) as any[]).filter((v) => v.sucursal_id === s.id)),
      })),
      plata: conPlata
        ? {
            costos: serieCostos,
            precios: seriePrecios,
            costoHoy,
            precioHoy,
            mayoristaHoy: mayorista.length ? num(mayorista[mayorista.length - 1].precio) : null,
            margenPct: margenSobreCosto(precioHoy, costoHoy),
            compras: ((compras.data ?? []) as any[]).map((c) => ({
              fecha: String(c.fecha).slice(0, 10), numero: (c.numero as string) ?? null, unidades: num(c.unidades),
              costo: numONada(c.costo_unitario), proveedor: (c.proveedor?.razon_social as string) ?? null,
            })),
          }
        : null,
    };
  }
}

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { filtrarPorBusqueda, normalizarTexto } from '../comun/busqueda';
import { pesosPlaca, productosEnResultado, separarDetalle, type DetallePlaca, type ProductoVisto } from '../comun/detalle-productos';
import { ComprasService } from '../compras/compras.service';
import { TONO_ODB } from '../comun/tono-odb';
import { costoUSD, usoDeRespuesta } from '../bot/tarifas';
import { enLotes, traerTodo } from '../comun/lotes';
import { armarPropuestas, cantidadPedible, type Propuesta } from './propuesta';
import { esfuerzo, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { unirConLoDicho } from '../comun/sin-repetir';

// ============================================================
// ABASTECIMIENTO (1/10/2026): el agente de la mesa de compras.
//
// Pedido de Leandro: que sepa todo el stock y el ritmo de ventas, que diga qué
// falta, qué queda por debajo de 12 y, sobre todo, qué NO LLEGA: un producto
// que vende 3 por día con un proveedor que tarda 10 días tiene que avisar con
// 40 unidades, no con 12. Que proponga qué comprar y, al ir a comprar, que
// administración cargue bien al proveedor sí o sí.
//
// Las cuentas las hace la base (función abastecimiento(), db/migracion-
// abastecimiento.sql): ritmo, cobertura, plazo aprendido de las compras,
// alerta y cantidad sugerida. El agente consulta, prioriza, explica y arma la
// orden; nunca inventa un número. El freno del proveedor también vive en la
// base (proveedor_faltantes y el trigger de ordenes_compra): acá solo se
// informa.
// ============================================================

export type MensajeAbastecimiento = { rol: 'usuario' | 'asistente'; texto: string };

// el modelo de todas las funciones vive en comun/modelos.ts (6/10/2026);
// ABASTECIMIENTO_MODELO sigue mandando
export const MODELO_ABASTECIMIENTO = process.env.ABASTECIMIENTO_MODELO ?? MODELO_PRINCIPAL;

const NOMBRE_ALERTA: Record<string, string> = {
  sin_stock: 'sin stock',
  no_llega: 'no llega a tiempo',
  menos_de_12: 'menos de 12',
};

// Fila de abastecimiento() achicada a lo que el agente necesita leer: cada
// campo viaja en cada vuelta del modelo.
// Los productos que el agente detalló, como Placa roja (ver comun/detalle-productos.ts):
// en el círculo, lo que conviene pedir; abajo, el stock y el ritmo de cada
// sucursal; en rojo, la alerta; a la derecha, el último costo por unidad.
export function placaDeAbastecimiento(productos: ProductoVisto[], todos: ProductoVisto[]): DetallePlaca {
  const dec = (n: unknown) => Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const renglones = productos.map((p) => {
    const filas = todos.filter((v) => v.sku === p.sku).map((v) => v.fila as any);
    const varias = new Set(filas.map((f) => f.sucursal).filter(Boolean)).size > 1;
    const sugerido = filas.reduce((s, f) => s + (Number(f.sugerido) || Number(f.cantidad) || 0), 0);
    const detalle = filas
      .filter((f) => f.stock != null || f.ritmo_dia != null)
      .map((f) => [
        varias && f.sucursal ? `${f.sucursal}:` : '',
        f.stock != null ? `${dec(f.stock)} en stock` : '',
        f.en_camino ? `+ ${dec(f.en_camino)} en camino` : '',
        f.ritmo_dia != null ? `· vende ${dec(f.ritmo_dia)} por día` : '',
      ].filter(Boolean).join(' '))
      .join(' — ');
    const alertas = [...new Set(filas.filter((f) => f.alerta).map((f) => (varias && f.sucursal ? `${f.alerta} en ${f.sucursal}` : String(f.alerta))))];
    const costo = filas.map((f) => f.costo).find((c) => c != null);
    return {
      clave: p.sku,
      cantidad: sugerido > 0 ? sugerido : null,
      nombre: p.nombre,
      detalle: detalle || undefined,
      destacado: alertas.length ? alertas.join(' · ') : undefined,
      importe: pesosPlaca(costo),
    };
  });
  return {
    titulo: 'PRODUCTOS',
    sub: `${renglones.length} productos`,
    renglones,
    pie: 'En el círculo, lo que conviene pedir. A la derecha, el último costo por unidad.',
  };
}

export function filaCorta(f: any) {
  const n = (v: any, d = 1) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
  return {
    sku: f.sku,
    producto: f.nombre,
    sucursal: String(f.sucursal ?? '').replace(/^Suc /, '').replace(/^Sant Thomas/, 'Saint Thomas'),
    stock: n(f.stock, 2),
    en_camino: n(f.en_camino) || undefined,
    ritmo_dia: n(f.ritmo_dia, 2),
    cobertura_dias: n(f.cobertura_dias),
    tendencia_pct: f.tendencia_pct ?? undefined,
    proveedor: f.proveedor ?? null,
    plazo_dias: n(f.plazo_dias),
    plazo: f.plazo_fuente,
    alerta: f.alerta ? NOMBRE_ALERTA[f.alerta] ?? f.alerta : null,
    sugerido: n(f.cantidad_sugerida, 0),
    costo: f.ultimo_costo != null ? Math.round(Number(f.ultimo_costo)) : undefined,
    ultima_compra: f.ultima_compra ? `${f.ultima_compra} (${n(f.ultima_cantidad, 0)} u)` : undefined,
  };
}

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'ver_faltantes',
    description:
      'Lista priorizada de lo que hay que comprar (lo más urgente primero), con stock, en camino, ritmo de venta diario, días de cobertura, proveedor habitual, plazo de entrega y cantidad sugerida. Alertas: "sin_stock", "no_llega" (los días de cobertura no alcanzan para el plazo de entrega más un margen) y "menos_de_12". Filtrá por sucursal, alerta, proveedor o rubro para trabajar de a tandas; trae también los totales del filtro.',
    input_schema: {
      type: 'object',
      properties: {
        sucursal: { type: 'string', description: '"Saint Thomas", "Santa Inés" o "todas" (por defecto todas)' },
        alerta: { type: 'string', enum: ['sin_stock', 'no_llega', 'menos_de_12', 'todas'] },
        proveedor: { type: 'string', description: 'Nombre (o parte) del proveedor' },
        rubro: { type: 'string', description: 'Rubro o categoría (o parte del nombre)' },
        limite: { type: 'integer', description: 'Cuántos renglones traer, hasta 60 (por defecto 25)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ver_producto',
    description: 'Todo lo de un producto en las dos sucursales: stock, en camino, ritmo, tendencia, cobertura, proveedor, plazo, última compra y sugerido. Buscá por nombre, marca o SKU.',
    input_schema: {
      type: 'object',
      properties: { busqueda: { type: 'string', description: 'Nombre, marca o SKU' } },
      required: ['busqueda'],
      additionalProperties: false,
    },
  },
  {
    name: 'ver_proveedor',
    description: 'Ficha de un proveedor: datos cargados y lo que le FALTA para poder comprarle, plazo de entrega (aprendido de sus entregas o declarado), órdenes abiertas y sus productos con alerta.',
    input_schema: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre o parte de la razón social' } },
      required: ['nombre'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_compra',
    description:
      'Muestra en la pantalla una propuesta de compra para UN proveedor y UNA sucursal, como nota de pedido con casillas para tildar y cantidades editables. El comprador la revisa y la arma desde ahí con un botón. Stock, ritmo, días que alcanza y costo los pone el sistema: vos elegís productos y cantidades. Para varios proveedores, una llamada por proveedor. Si volvés a llamarla para el mismo proveedor y sucursal, la nota nueva REEMPLAZA a la anterior: mandá la lista completa, no solo lo que corregís.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor: { type: 'string', description: 'Razón social del proveedor, como figura en ver_proveedor' },
        sucursal: { type: 'string', description: '"Saint Thomas" o "Santa Inés"' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              cantidad: { type: 'number' },
              motivo: { type: 'string', description: 'Opcional, muy corto: por qué esa cantidad si no es la sugerida (bulto cerrado, última compra, tendencia)' },
            },
            required: ['sku', 'cantidad'],
            additionalProperties: false,
          },
        },
      },
      required: ['proveedor', 'sucursal', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'armar_orden',
    description:
      'Crea la orden de compra (queda "a aprobar" por el dueño). SOLO después de que el comprador aceptó la propuesta exacta: proveedor, sucursal, productos y cantidades. Si al proveedor le faltan datos, la orden igual se crea pero NO se puede aprobar: administración recibe el pedido de completarlo y el sistema avisa cuando esté.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor: { type: 'string', description: 'Razón social del proveedor, como figura en ver_proveedor' },
        sucursal: { type: 'string', description: '"Saint Thomas" o "Santa Inés"' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, cantidad: { type: 'number' } },
            required: ['sku', 'cantidad'],
            additionalProperties: false,
          },
        },
        observaciones: { type: 'string' },
      },
      required: ['proveedor', 'sucursal', 'items'],
      additionalProperties: false,
    },
  },
];

const SISTEMA = `Sos el agente de abastecimiento de O.D.B (almacén y vinoteca premium, sucursales Saint Thomas y Santa Inés, Canning). Trabajás con el comprador y con los dueños en la mesa de compras.

Tu trabajo: que no falte lo que se vende y que no se compre de más. La clave es ritmo de venta contra stock contra plazo de entrega. Un producto que vende 3 por día y tarda 10 días en llegar está en alerta con 40 unidades; uno que no se vende no está en alerta con 2.

Cómo trabajás:
- Todos los números salen de tus herramientas. Nunca inventes stock, ritmo, plazos, costos ni proveedores. Cuando contestás sin proponer una compra (un producto, un proveedor, una duda), citá los números que importan (stock, vende X por día, le quedan N días, el proveedor tarda M).
- Prioridad: 1) sin stock de lo que se vende; 2) lo que no llega a tiempo (los días que le quedan no alcanzan para el plazo de entrega); 3) lo que quedó por debajo de 12. Lo que no se vende no se repone por reponer.
- Son miles de renglones: trabajá de a tandas y agrupá por proveedor, que es como se compra. Empezá por lo más urgente y preguntá si sigue.
- La cantidad sugerida ya cubre el plazo de entrega, un margen y 14 días más. Podés ajustarla con criterio (bultos cerrados, la cantidad de la última compra, una tendencia fuerte); el porqué va en el motivo de ese renglón, no en el texto.
- El plazo de entrega se aprende de las compras reales: cuando se aprueba o envía una orden y cuando entra. Si dice "sin confirmar: 7 días por defecto", decí que ese número es provisorio.
- Si un producto no tiene proveedor habitual, preguntá a quién se le compra. Al armar la orden con ese proveedor, el sistema lo aprende para la próxima.
- Si el ritmo viene del sistema viejo y el período terminó hace más de un mes, decilo una vez: las cantidades son orientativas hasta que se cargue el reporte de ventas reciente del sistema viejo.
- Las propuestas de compra van SIEMPRE por proponer_compra: la pantalla las dibuja como nota de pedido para tildar, con stock, días que alcanza y costo, y el comprador la arma desde ahí. En tu texto NO repitas los productos ni sus números: una o dos líneas con lo que importa (qué es lo urgente, si el plazo es provisorio, qué le falta al proveedor).
- armar_orden solo si el comprador te pide por escrito que la armes vos, con la propuesta exacta (proveedor, sucursal, productos y cantidades) ya acordada. Nunca armes una orden sin ese sí.
- Proveedor bien cargado, sí o sí: para comprarle tiene que tener CUIT, razón social, teléfono o WhatsApp, condición de pago y plazo de entrega confirmado. Si le falta algo, decilo al proponer la compra. Si igual se arma la orden, queda a aprobar y frenada: administración ya recibe el pedido de completarlo y el sistema avisa cuando está.
- Respuestas cortas y concretas, en castellano rioplatense, sin markdown pesado. Si hace falta una lista, guiones simples; nunca la lista de productos de una propuesta (esa la dibuja la pantalla).
- Cuando detalles varios productos, un renglón por producto: guion, el nombre como figura en el sistema y, después de dos puntos, lo que hay que hacer con él ("- Cafe Cabrales Brasil x 500g: pedir 12"). La pantalla dibuja esos renglones como tarjeta con el stock, el ritmo, la alerta y el costo de cada uno.
- El comprador te cuenta al principio de su mensaje cómo están las notas en pantalla (qué tildó, qué cantidades cambió, qué órdenes ya armó). Eso manda sobre lo que propusiste antes: no vuelvas a proponer ni a armar lo que ya está armado.
- Lo que el comprador lee es tu ÚLTIMO mensaje, después de la última herramienta: lo que escribas antes de llamar una herramienta no le llega. La explicación (qué es lo urgente, si el plazo es provisorio, qué le falta al proveedor) va ahí, al final.

${TONO_ODB}`;
// 6/10/2026 (Opus 5.5): lo que el agente escribe ENTRE herramientas («lo urgente
// es Luvik…» y después proponer_compra) ya no vuelve como texto sino dentro de un
// bloque de razonamiento, vacío. El cierre juntaba esos textos (dichos) y, sin
// ellos, caía en «Te dejé la propuesta abajo para tildar». Pasaba desde que este
// agente está en 5.5: el prompt pide la explicación en el último mensaje.

@Injectable()
export class AbastecimientoService {
  private readonly log = new Logger(AbastecimientoService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly compras: ComprasService,
  ) {}

  // ---------- datos ----------

  private async sucursales(): Promise<{ id: string; nombre: string }[]> {
    const { data } = await this.db.from('sucursales').select('id, nombre').eq('activa', true);
    return (data ?? []) as any[];
  }

  // "Saint Thomas", "st", "Santa Ines"… → id. Vacío o "todas" → null.
  async sucursalId(texto?: string | null): Promise<string | null> {
    const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (!t || t === 'todas' || t === 'ambas') return null;
    const suc = await this.sucursales();
    const llave = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^suc\s+/, '').replace('sant ', 'saint ');
    const hit = suc.find((s) => llave(s.nombre).includes(t.replace('sant ', 'saint ')) || (t === 'st' && /thomas/.test(llave(s.nombre))) || (t === 'si' && /ines/.test(llave(s.nombre))));
    if (!hit) throw new BadRequestException(`No conozco la sucursal "${texto}". Son: ${suc.map((s) => s.nombre).join(', ')}`);
    return hit.id;
  }

  async situacion(f: { sucursalId?: string | null; soloAlertas?: boolean; proveedorId?: string | null; q?: string | null; limite?: number }) {
    const args = {
      p_sucursal: f.sucursalId ?? null,
      p_solo_alertas: f.soloAlertas !== false,
      p_proveedor: f.proveedorId ?? null,
      p_q: f.q?.trim() || null,
      p_limite: f.limite ?? 200,
    };
    // PostgREST corta en 1.000 filas también las funciones, sin avisar: el
    // p_limite no manda. Saint Thomas tiene 2.154 alertas y llegaban las 1.000
    // más urgentes (1/10/2026: la nota de pedido mostraba 133 productos de 388).
    // De a páginas; una consulta chica es una sola vuelta.
    try {
      return await traerTodo<any>((desde, hasta) => this.db.rpc('abastecimiento', args).range(desde, hasta) as any);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }

  // Totales por sucursal y alerta + de cuándo son los datos. Lo usan la pantalla,
  // el aviso diario y el contexto del agente.
  async resumen() {
    const filas = await this.situacion({ limite: 20000 });
    const porSucursal: Record<string, Record<string, number>> = {};
    const porProveedor = new Map<string, { proveedor: string; urgentes: number; faltan: string[] }>();
    let sinProveedor = 0;
    let ritmoHasta: string | null = null;
    for (const f of filas) {
      const suc = filaCorta(f).sucursal;
      porSucursal[suc] ??= { sin_stock: 0, no_llega: 0, menos_de_12: 0 };
      porSucursal[suc][f.alerta] = (porSucursal[suc][f.alerta] ?? 0) + 1;
      if (!f.proveedor_id) sinProveedor++;
      else if (f.alerta !== 'menos_de_12') {
        const p = porProveedor.get(f.proveedor_id) ?? { proveedor: f.proveedor, urgentes: 0, faltan: f.proveedor_faltan ?? [] };
        p.urgentes++;
        porProveedor.set(f.proveedor_id, p);
      }
      if (f.ritmo_hasta && (!ritmoHasta || f.ritmo_hasta > ritmoHasta)) ritmoHasta = f.ritmo_hasta;
    }
    const { data: imp } = await this.db.from('movimientos_stock').select('creado_en').eq('referencia_tipo', 'importacion')
      .order('creado_en', { ascending: false }).limit(1).maybeSingle();
    return {
      porSucursal,
      proveedoresUrgentes: [...porProveedor.values()].sort((a, b) => b.urgentes - a.urgentes).slice(0, 8),
      sinProveedor,
      ventasHasta: ritmoHasta,
      stockActualizado: (imp as any)?.creado_en ?? null,
    };
  }

  private async buscarProveedor(nombre: string) {
    const t = String(nombre ?? '').trim();
    if (!t) throw new BadRequestException('Falta el nombre del proveedor');
    // Son pocos (59): se traen todos y se filtran con la regla de
    // comun/busqueda.ts (sin tildes, plurales ni orden; con errores de tipeo
    // si no hay nada). Antes "cerveceria" no encontraba "Cervecería".
    const { data } = await this.db.from('proveedores')
      .select('id, razon_social, cuit, telefono, email, condicion_pago, lead_time_dias, lead_time_confirmado, activo')
      .eq('activo', true);
    const lista = filtrarPorBusqueda((data ?? []) as any[], t, (p) => `${p.razon_social} ${p.cuit ?? ''}`).slice(0, 6);
    const exacto = lista.filter((p) => normalizarTexto(p.razon_social).trim() === normalizarTexto(t));
    return exacto.length === 1 ? exacto : lista;
  }

  // ---------- herramientas del agente ----------

  async verFaltantes(input: any) {
    const sucursalId = await this.sucursalId(input?.sucursal);
    let proveedorId: string | null = null;
    if (input?.proveedor) {
      const provs = await this.buscarProveedor(input.proveedor);
      if (provs.length !== 1) return { error: provs.length ? `Hay varios proveedores con "${input.proveedor}": ${provs.map((p) => p.razon_social).join(', ')}` : `No hay un proveedor activo con "${input.proveedor}"` };
      proveedorId = provs[0].id;
    }
    let filas = await this.situacion({ sucursalId, proveedorId, limite: 20000 });
    if (input?.alerta && input.alerta !== 'todas') filas = filas.filter((f) => f.alerta === input.alerta);
    if (input?.rubro) filas = filtrarPorBusqueda(filas, input.rubro, (f) => f.categoria);
    const totales: Record<string, number> = {};
    for (const f of filas) totales[NOMBRE_ALERTA[f.alerta] ?? f.alerta] = (totales[NOMBRE_ALERTA[f.alerta] ?? f.alerta] ?? 0) + 1;
    const limite = Math.max(1, Math.min(60, Number(input?.limite) || 25));
    return { totales, mostrando: Math.min(limite, filas.length), de: filas.length, renglones: filas.slice(0, limite).map(filaCorta) };
  }

  async verProducto(input: any) {
    const q = String(input?.busqueda ?? '').trim();
    if (q.length < 2) return { error: 'Buscá con al menos 2 letras' };
    const filas = await this.situacion({ soloAlertas: false, q, limite: 12 });
    return filas.length ? { renglones: filas.map(filaCorta) } : { error: `No encontré "${q}" en el catálogo activo` };
  }

  async verProveedor(input: any) {
    const provs = await this.buscarProveedor(input?.nombre);
    if (!provs.length) return { error: `No hay un proveedor activo con "${input?.nombre}"` };
    if (provs.length > 1) return { varios: provs.map((p) => p.razon_social) };
    const p = provs[0];
    const [{ data: faltan }, { data: ordenes }, filas] = await Promise.all([
      this.db.rpc('proveedor_faltantes', { p_id: p.id }),
      this.db.from('ordenes_compra').select('numero, estado, total, creado_en, sucursal:sucursales(nombre)')
        .eq('proveedor_id', p.id).in('estado', ['borrador', 'pendiente_aprobacion', 'aprobada', 'enviada', 'recibida_parcial'])
        .order('creado_en', { ascending: false }).limit(10),
      this.situacion({ proveedorId: p.id, limite: 40 }),
    ]);
    return {
      proveedor: {
        razon_social: p.razon_social, cuit: p.cuit, telefono: p.telefono, email: p.email,
        condicion_pago: p.condicion_pago,
        plazo_declarado: p.lead_time_confirmado ? `${p.lead_time_dias} días` : 'sin confirmar (7 por defecto)',
        plazo_que_usa_el_calculo: filas[0] ? `${filas[0].plazo_dias} días (${filas[0].plazo_fuente})` : undefined,
      },
      le_falta_para_comprarle: (faltan as string[] | null) ?? [],
      ordenes_abiertas: (ordenes ?? []).map((o: any) => ({ numero: o.numero, estado: o.estado, total: Math.round(Number(o.total)), sucursal: o.sucursal?.nombre })),
      productos_con_alerta: filas.map(filaCorta),
    };
  }

  async armarOrden(input: any, usuarioId?: string) {
    const provs = await this.buscarProveedor(input?.proveedor);
    if (provs.length !== 1) return { error: provs.length ? `Hay varios proveedores con "${input?.proveedor}": ${provs.map((p) => p.razon_social).join(', ')}` : `No hay un proveedor activo con "${input?.proveedor}"` };
    const sucursalId = await this.sucursalId(input?.sucursal);
    if (!sucursalId) return { error: 'La orden es para una sucursal: "Saint Thomas" o "Santa Inés"' };
    const items = (Array.isArray(input?.items) ? input.items : [])
      .map((i: any) => ({ sku: String(i?.sku ?? '').trim(), cantidad: Math.ceil(Number(i?.cantidad)) }))
      .filter((i: any) => i.sku && i.cantidad > 0);
    if (!items.length) return { error: 'La orden no tiene renglones con cantidad' };
    const oc = await this.crearOrden({
      proveedorId: provs[0].id, sucursalId, items, usuarioId,
      // las observaciones viajan al proveedor en la nota de pedido: solo las que dictó el comprador
      observaciones: input?.observaciones ? String(input.observaciones) : undefined,
    });
    const faltanLista = oc.faltan;
    return {
      orden: oc.numero, total: oc.total, estado: 'a aprobar por el dueño',
      proveedor_completo: faltanLista.length === 0,
      aviso: faltanLista.length
        ? `La orden quedó creada pero FRENADA: no se puede aprobar hasta que administración cargue del proveedor: ${faltanLista.join(', ')}. Ya les llegó el pedido a la campanita; cuando lo completen, el sistema avisa.`
        : 'Proveedor completo: la orden queda para que el dueño la apruebe en Aprobaciones.',
    };
  }

  // ---------- la propuesta para tildar ----------

  private urlFoto(sku: string) {
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/productos/${encodeURIComponent(sku)}.jpg?v=${process.env.FOTOS_VERSION ?? '1'}`;
  }

  // Qué productos tienen foto: la nota de pedido se lee mejor con la cara del
  // producto, pero una foto rota (cuadro vacío) se ve peor que ninguna.
  private async conFoto(productoIds: string[]): Promise<Set<string>> {
    const filas = await enLotes<{ id: string }>(productoIds, (lote) =>
      this.db.from('productos').select('id').in('id', lote).eq('tiene_foto', true) as any,
    ).catch(() => [] as { id: string }[]);
    return new Set(filas.map((f) => f.id));
  }

  private async propuestasDe(filas: any[], pedidos?: Map<string, { cantidad: number; motivo?: string | null }>): Promise<Propuesta[]> {
    const fotos = await this.conFoto(filas.map((f) => f.producto_id));
    return armarPropuestas(filas, { pedidos, conFoto: fotos, urlFoto: (sku) => this.urlFoto(sku) });
  }

  // Vista directa de "Qué comprar": todo lo que tiene sugerido y proveedor,
  // agrupado como se compra. Sin pasar por el agente: es lo mismo que él vería.
  async propuestas(f: { sucursal?: string | null }) {
    const sucursalId = await this.sucursalId(f.sucursal);
    const filas = await this.situacion({ sucursalId, limite: 20000 });
    const conProveedor = filas.filter((x) => x.proveedor_id && Number(x.cantidad_sugerida) > 0);
    const sinProveedor = filas.filter((x) => !x.proveedor_id && Number(x.cantidad_sugerida) > 0 && x.alerta !== 'menos_de_12').length;
    let ventasHasta: string | null = null;
    for (const x of filas) if (x.ritmo_hasta && (!ventasHasta || x.ritmo_hasta > ventasHasta)) ventasHasta = x.ritmo_hasta;
    return { propuestas: await this.propuestasDe(conProveedor), sinProveedor, ventasHasta };
  }

  // Herramienta del agente: arma la nota de pedido que se dibuja en pantalla.
  // Al modelo le vuelve un resumen corto (cada campo viaja en cada vuelta); la
  // versión con fotos y números va a la pantalla.
  async proponerCompra(input: any): Promise<{ propuesta?: Propuesta; resultado: Record<string, unknown> }> {
    const provs = await this.buscarProveedor(input?.proveedor);
    if (provs.length !== 1) {
      return { resultado: { error: provs.length ? `Hay varios proveedores con "${input?.proveedor}": ${provs.map((p) => p.razon_social).join(', ')}` : `No hay un proveedor activo con "${input?.proveedor}"` } };
    }
    const sucursalId = await this.sucursalId(input?.sucursal);
    if (!sucursalId) return { resultado: { error: 'La propuesta es para una sucursal: "Saint Thomas" o "Santa Inés"' } };
    const pedidos = new Map<string, { cantidad: number; motivo?: string | null }>();
    for (const i of Array.isArray(input?.items) ? input.items : []) {
      const sku = String(i?.sku ?? '').trim();
      const cantidad = cantidadPedible(i?.cantidad);
      if (sku && cantidad) pedidos.set(sku, { cantidad, motivo: i?.motivo ? String(i.motivo).slice(0, 120) : null });
    }
    if (!pedidos.size) return { resultado: { error: 'La propuesta no tiene renglones con cantidad' } };
    if (pedidos.size > 60) return { resultado: { error: `Son ${pedidos.size} renglones: partila en notas de hasta 60 (por rubro o por urgencia)` } };

    // lo habitual de ese proveedor; lo que no es suyo se busca uno por uno
    let filas = (await this.situacion({ proveedorId: provs[0].id, sucursalId, soloAlertas: false, limite: 2000 }))
      .filter((f) => pedidos.has(f.sku));
    const propias = filas.length;
    const faltanSku = [...pedidos.keys()].filter((sku) => !filas.some((f) => f.sku === sku));
    for (const sku of faltanSku) {
      const hit = (await this.situacion({ sucursalId, soloAlertas: false, q: sku, limite: 5 })).find((f) => f.sku === sku);
      if (hit) filas.push(hit);
    }
    // Un producto que nunca tuvo stock ni ventas en esa sucursal no sale en
    // abastecimiento(), pero existe y se puede pedir (es justo el caso de
    // traerlo por primera vez): va con stock 0 y sin ritmo, no como "no existe".
    const sinDatos = [...pedidos.keys()].filter((sku) => !filas.some((f) => f.sku === sku));
    if (sinDatos.length) {
      const prods = await enLotes<any>(sinDatos, (lote) =>
        this.db.from('productos').select('id, sku, nombre, costo').in('sku', lote).eq('activo', true) as any,
      );
      const costos = await enLotes<any>(prods.map((p) => p.id), (lote) =>
        this.db.from('proveedor_productos').select('producto_id, ultimo_costo').eq('proveedor_id', provs[0].id).in('producto_id', lote) as any,
      ).catch(() => [] as any[]);
      const sucNombre = (await this.sucursales()).find((x) => x.id === sucursalId)?.nombre ?? input?.sucursal;
      for (const p of prods) {
        const pp = costos.find((c) => c.producto_id === p.id);
        filas.push({
          producto_id: p.id, sku: p.sku, nombre: p.nombre, sucursal_id: sucursalId, sucursal: sucNombre,
          stock: 0, en_camino: 0, ritmo_dia: 0, cobertura_dias: null, alerta: null, cantidad_sugerida: 0,
          ultimo_costo: pp?.ultimo_costo ?? p.costo ?? null,
        });
      }
    }
    // la nota es de ESTE proveedor aunque el producto se le compre a otro; el
    // plazo, el de este proveedor (si ningún renglón es suyo, el de su ficha)
    const plazoPropio = propias
      ? null
      : { plazo_dias: provs[0].lead_time_dias ?? 7, plazo_fuente: provs[0].lead_time_confirmado ? 'declarado por el proveedor' : 'sin confirmar: 7 días por defecto' };
    filas = filas.map((f) => ({ ...f, proveedor_id: provs[0].id, proveedor: provs[0].razon_social, ...(plazoPropio ?? {}) }));
    const [propuesta] = await this.propuestasDe(filas, pedidos);
    if (!propuesta) return { resultado: { error: `Ninguno de esos SKU existe en ${input?.sucursal}` } };
    const { data: faltan } = await this.db.rpc('proveedor_faltantes', { p_id: provs[0].id });
    propuesta.faltan = (faltan as string[] | null) ?? [];
    const noEncontrados = [...pedidos.keys()].filter((sku) => !propuesta.items.some((i) => i.sku === sku));
    return {
      propuesta,
      resultado: {
        mostrada: true, proveedor: propuesta.proveedor, sucursal: propuesta.sucursal,
        renglones: propuesta.items.length, total_estimado: Math.round(propuesta.total),
        ...(noEncontrados.length ? { no_encontrados: noEncontrados } : {}),
        ...(propuesta.faltan.length ? { para_comprarle_falta: propuesta.faltan } : {}),
      },
    };
  }

  // La orden que sale de la nota tildada (o de armar_orden). Queda a aprobar
  // por el dueño; si al proveedor le faltan datos, se crea igual y la base la
  // frena y le pide a administración que lo complete.
  async crearOrden(f: { proveedorId: string; sucursalId: string; items: { sku: string; cantidad: number }[]; usuarioId?: string; observaciones?: string | null }) {
    const items = (f.items ?? [])
      .map((i) => ({ sku: String(i?.sku ?? '').trim(), cantidad: cantidadPedible(i?.cantidad) }))
      .filter((i) => i.sku && i.cantidad > 0);
    if (!f.proveedorId || !f.sucursalId) throw new BadRequestException('Falta el proveedor o la sucursal');
    if (!items.length) throw new BadRequestException('Tildá al menos un producto con cantidad');
    const { ordenCompraId } = await this.compras.crear({
      proveedorId: f.proveedorId, sucursalId: f.sucursalId, items, usuarioId: f.usuarioId,
      observaciones: f.observaciones ? String(f.observaciones).slice(0, 500) : undefined,
    } as any);
    const [{ data: oc }, { data: faltan }] = await Promise.all([
      this.db.from('ordenes_compra').select('numero, total, estado').eq('id', ordenCompraId).maybeSingle(),
      this.db.rpc('proveedor_faltantes', { p_id: f.proveedorId }),
    ]);
    return {
      id: ordenCompraId,
      numero: (oc as any)?.numero ?? null,
      total: Math.round(Number((oc as any)?.total ?? 0)),
      renglones: items.length,
      faltan: (faltan as string[] | null) ?? [],
    };
  }

  private async ejecutar(nombre: string, input: any, usuarioId?: string): Promise<unknown> {
    switch (nombre) {
      case 'ver_faltantes': return this.verFaltantes(input);
      case 'ver_producto': return this.verProducto(input);
      case 'ver_proveedor': return this.verProveedor(input);
      case 'armar_orden': return this.armarOrden(input, usuarioId);
      case 'proponer_compra': return (await this.proponerCompra(input)).resultado;
      default: return { error: `Herramienta desconocida: ${nombre}` };
    }
  }

  // ---------- la charla ----------

  async charlar(mensajes: MensajeAbastecimiento[], usuarioId?: string) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('Falta ANTHROPIC_API_KEY');
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje tiene que ser del comprador');
    }
    const claude = new Anthropic();
    const resumen = await this.resumen().catch(() => null);
    // Lo fijo va primero y con caché; la foto del día va aparte, después.
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Hoy es ${new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. Situación al abrir la charla: ${JSON.stringify(resumen)}` },
    ];
    // la API exige que el primer mensaje sea del usuario: el recorte de 20 puede
    // dejar una respuesta del agente adelante (pasaba en la pregunta 11)
    const ultimos = mensajes.slice(-20);
    while (ultimos.length > 1 && ultimos[0].rol !== 'usuario') ultimos.shift();
    const historial: Anthropic.MessageParam[] = ultimos.map((m) => ({
      role: m.rol === 'usuario' ? 'user' : 'assistant',
      content: m.texto?.trim() || '(sin texto)',
    }));
    const usadas: string[] = [];
    let ordenes: number[] = [];
    const propuestas: Propuesta[] = [];
    // los productos que devolvieron las herramientas: si la respuesta los lista,
    // van a la Placa roja con los datos del sistema
    const vistos: ProductoVisto[] = [];
    let costo = 0;
    const limite = Date.now() + 170_000; // el proxy del panel corta a los 4,5 min
    // lo que el agente escribe en cada vuelta: suele explicar ANTES de llamar a
    // proponer_compra y cerrar sin texto después
    const dichos: string[] = [];
    // el texto de la ÚLTIMA vuelta (revisión del 6/10/2026): el prompt pide la
    // explicación al final, y pegarle todo lo dicho antes repetía la frase corta
    // que el agente había escrito antes de proponer_compra. Va la última; de lo
    // de antes, solo lo que ella no dice (unirConLoDicho, el mismo criterio que el
    // bot); sin texto en la última vuelta, todo lo dicho, como siempre. En un
    // corte (motivo) no hay mensaje final: va todo lo dicho.
    let ultimoDicho = '';
    const cierre = (motivo?: string) => {
      const texto = motivo || !ultimoDicho
        ? dichos.join('\n\n').trim()
        : unirConLoDicho(dichos.slice(0, -1), ultimoDicho);
      const aviso = ordenes.length
        ? `La orden ${ordenes.map((n) => `#${n}`).join(', ')} ya quedó creada y está a aprobar: no la pidas de nuevo.`
        : '';
      const respuesta = motivo
        ? [motivo, aviso, propuestas.length ? 'Te dejo abajo lo que alcancé a armar.' : ''].filter(Boolean).join(' ')
        : texto || aviso || (propuestas.length ? 'Te dejé la propuesta abajo para tildar.' : 'No encontré nada para proponer con eso.');
      const final = motivo && texto ? `${texto}\n\n${respuesta}` : respuesta;
      const { respuesta: sinLista, detalle } = separarDetalle(final, vistos, (ps) => placaDeAbastecimiento(ps, vistos));
      return { respuesta: sinLista, detalle, herramientas: usadas, ordenes, propuestas };
    };
    for (let vuelta = 0; vuelta < 10; vuelta++) {
      const queda = limite - Date.now();
      if (queda < 10_000) break;
      let res: Anthropic.Message;
      try {
        res = await claude.messages.stream({
          model: MODELO_ABASTECIMIENTO,
          max_tokens: 16000,
          thinking: RAZONAMIENTO,
          output_config: { effort: esfuerzo('ABASTECIMIENTO_ESFUERZO') },
          system,
          tools: HERRAMIENTAS,
          messages: historial,
          // caché sobre la charla (6/10/2026): hasta 10 vueltas que reenviaban
          // enteros los resultados de las herramientas; con la marca automática al
          // final, cada vuelta lee lo anterior de la caché (0,05× en Opus 5.5)
          cache_control: { type: 'ephemeral' },
        } as any, { signal: AbortSignal.timeout(queda) }).finalMessage();
      } catch (e) {
        // un corte a mitad de la charla no puede tirar lo que ya se armó: las
        // órdenes creadas existen y las notas sirven igual
        this.log.warn(`abastecimiento: se cortó la vuelta ${vuelta}: ${e instanceof Error ? e.message : String(e)}`);
        if (!ordenes.length && !propuestas.length) throw new BadRequestException('El agente no pudo contestar. Probá de nuevo o pedile una tanda más chica (un proveedor o un rubro).');
        return cierre('Se me cortó la respuesta antes de terminar.');
      }
      costo += costoUSD(MODELO_ABASTECIMIENTO, usoDeRespuesta(res.usage));
      historial.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'refusal') return { respuesta: 'No puedo ayudar con eso. Probá reformularlo.', herramientas: usadas, ordenes, propuestas };
      const texto = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (texto) dichos.push(texto);
      ultimoDicho = texto;
      if (res.stop_reason !== 'tool_use') {
        this.log.log(`abastecimiento: ${usadas.length} herramientas · ≈ USD ${costo.toFixed(3)}`);
        return cierre();
      }
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== 'tool_use') continue;
        usadas.push(b.name);
        let salida: unknown;
        try {
          if (b.name === 'proponer_compra') {
            const r = await this.proponerCompra(b.input);
            if (r.propuesta) {
              // una sola nota por proveedor y sucursal: la nueva reemplaza a la anterior
              const previa = propuestas.findIndex((p) => p.clave === r.propuesta!.clave);
              if (previa >= 0) propuestas[previa] = r.propuesta;
              else propuestas.push(r.propuesta);
            }
            salida = r.resultado;
          } else {
            salida = await this.ejecutar(b.name, b.input, usuarioId);
          }
          if (b.name === 'armar_orden' && (salida as any)?.orden) ordenes = [...ordenes, (salida as any).orden];
        } catch (e) {
          salida = { error: e instanceof Error ? e.message : String(e) };
        }
        vistos.push(...productosEnResultado(salida));
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(salida), is_error: !!(salida as any)?.error });
      }
      historial.push({ role: 'user', content: resultados });
    }
    return cierre('Se me fue el tiempo armando la respuesta. Para seguir, pedime una tanda más chica (un proveedor o un rubro).');
  }

  // ---------- el aviso del día ----------

  // A las 8:30, UN aviso en la campanita de los dueños con lo que no llega (se
  // actualiza el del día anterior si nadie lo leyó: nunca uno por producto).
  @Cron('0 30 8 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async avisoDiario() {
    const r = await this.resumen().catch((e) => { this.log.warn(`aviso de abastecimiento: ${e?.message ?? e}`); return null; });
    if (!r) return;
    const lineas = Object.entries(r.porSucursal).map(([suc, a]) =>
      `${suc}: ${a.sin_stock ?? 0} sin stock, ${a.no_llega ?? 0} no llegan a tiempo, ${a.menos_de_12 ?? 0} con menos de 12`);
    const urgentes = r.proveedoresUrgentes.slice(0, 5).map((p) => `${p.proveedor} (${p.urgentes})`).join(', ');
    const detalle = [
      ...lineas,
      urgentes ? `Proveedores con más urgencias: ${urgentes}.` : '',
      r.ventasHasta ? `Ritmo de venta con datos hasta ${new Date(r.ventasHasta).toLocaleDateString('es-AR')}.` : 'Sin datos de ventas cargados.',
    ].filter(Boolean).join('\n');
    const total = Object.values(r.porSucursal).reduce((s, a) => s + (a.sin_stock ?? 0) + (a.no_llega ?? 0), 0);
    const titulo = `Compras: ${total} productos sin stock o que no llegan a tiempo`;
    const referencia = { link: '/mesa-compras?tab=abastecer', fecha: new Date().toISOString().slice(0, 10) };
    const { data: previo } = await this.db.from('alertas_internas').select('id').eq('tipo', 'abastecimiento').is('leida_en', null).limit(1).maybeSingle();
    if (previo) await this.db.from('alertas_internas').update({ titulo, detalle, referencia, creada_en: new Date().toISOString() }).eq('id', (previo as any).id);
    else await this.db.from('alertas_internas').insert({ tipo: 'abastecimiento', titulo, detalle, referencia });
  }
}


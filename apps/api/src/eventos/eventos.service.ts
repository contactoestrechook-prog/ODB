import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';
import { generarPresupuesto } from './presupuesto';
import { esfuerzo, jsonDe, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { enLotes, traerTodo } from '../comun/lotes';
import {
  COMPRA_GRANDE,
  ESTADOS,
  TIPOS,
  comprasGrandes,
  empresasFinDeAno,
  esEmpresa,
  eventoDeCumple,
  faltaColumna,
  hoyBA,
  limpiarDatosEvento,
  nombreSugerido,
  pasarExtrasANotas,
  resumenEventos,
  sumarDias,
  umbralCompraGrande,
  type ClienteEmpresa,
  type Compra,
  type EventoLiviano,
} from './eventos.logica';

/** El evento con lo justo del cliente para la tarjeta y el detalle. */
const CON_CLIENTE = '*, cliente:clientes(nombre, razon_social, dni, tipo, telefono)';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const TIPO_LABEL: Record<string, string> = {
  cumpleanos: 'cumpleaños', casamiento: 'casamiento', corporativo: 'evento corporativo',
  fin_de_ano: 'fiesta de fin de año', otro: 'evento',
};

export type ItemPropuesta = { producto_id?: string | null; descripcion: string; cantidad: number; precio_unitario: number };

@Injectable()
export class EventosService {
  private readonly log = new Logger('Eventos');

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  // ------------------------------------------------------- oportunidades
  //
  // Hasta el 21/10/2026 era solo la función cumpleanos_proximos(): con 2
  // clientes con fecha de nacimiento sobre 6.749, la pantalla arrancaba vacía.
  // Ahora son tres listas, cada una con su consulta acotada (si una falla, las
  // otras salen igual y la pantalla avisa cuál no se pudo leer):
  //  - cumpleaños de los próximos N días + cuántos clientes no tienen la fecha;
  //  - empresas para fin de año, por lo que compraron en 12 meses;
  //  - compras muy por encima del ticket promedio (probable festejo).
  // "Compra" es lo mismo que en la ficha del cliente (cliente_ficha): pedidos
  // no cancelados + ventas de mostrador completadas que no vienen de un pedido.
  async oportunidades(dias = 60) {
    const hoy = hoyBA();
    const ventana = Math.min(Math.max(Math.round(Number(dias) || 60), 1), 365);
    const avisos: string[] = [];
    const seguro = async <T>(que: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
      try {
        return await leer();
      } catch (e) {
        this.log.warn(`oportunidades (${que}): ${e instanceof Error ? e.message : e}`);
        if (!avisos.includes(que)) avisos.push(que);
        return vacio;
      }
    };
    const eventos = await seguro('eventos', () => this.eventosLivianos(), [] as EventoLiviano[]);
    const [cumples, sinFecha, empresas, grandes] = await Promise.all([
      seguro('cumpleaños', () => this.cumpleanos(ventana, eventos, hoy), []),
      seguro('cumpleaños', () => this.clientesSinFechaDeNacimiento(), null),
      seguro('empresas', () => this.empresasFinDeAno(eventos, hoy), null),
      seguro('compras grandes', () => this.comprasGrandes(eventos, hoy), null),
    ]);
    return {
      hoy,
      cumpleanos: { dias: ventana, lista: cumples, sinFecha },
      empresas,
      comprasGrandes: grandes,
      avisos,
    };
  }

  private async eventosLivianos(): Promise<EventoLiviano[]> {
    return traerTodo<EventoLiviano>((desde, hasta) =>
      this.db.from('eventos').select('id, cliente_id, tipo, estado, fecha, creado_en').order('creado_en').range(desde, hasta),
    );
  }

  private async cumpleanos(dias: number, eventos: EventoLiviano[], hoy: string) {
    const { data, error } = await this.db.rpc('cumpleanos_proximos', { p_dias: dias });
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((c) => ({
      cliente_id: c.cliente_id as string,
      nombre: c.nombre as string | null,
      dni: c.dni as string | null,
      dias: Number(c.dias),
      /** El día del próximo cumpleaños, "AAAA-MM-DD". */
      fecha: sumarDias(hoy, Number(c.dias)),
      evento_id: eventoDeCumple(c.cliente_id, eventos, hoy),
    }));
  }

  private async clientesSinFechaDeNacimiento(): Promise<number> {
    const { count, error } = await this.db.from('clientes').select('id', { count: 'exact', head: true }).is('fecha_nacimiento', null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private async empresasFinDeAno(eventos: EventoLiviano[], hoy: string) {
    const { data, error } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, cuit, condicion_iva, tipo, mayorista, telefono')
      .or('cuit.not.is.null,razon_social.not.is.null,tipo.eq.mayorista,mayorista.is.true,condicion_iva.ilike.responsable*')
      .limit(1000);
    if (error) throw new Error(error.message);
    const empresas = ((data ?? []) as ClienteEmpresa[]).filter(esEmpresa);
    const compras = await this.comprasDe(empresas.map((e) => e.id), sumarDias(hoy, -365));
    return empresasFinDeAno(empresas, compras, eventos, hoy);
  }

  /** Las compras de estos clientes desde `desde` (de a 100 ids: comun/lotes.ts). */
  private async comprasDe(ids: string[], desde: string): Promise<Compra[]> {
    if (!ids.length) return [];
    const [pedidos, ventas] = await Promise.all([
      enLotes<any>(ids, (lote) =>
        this.db.from('pedidos').select('cliente_id, total, creado_en').in('cliente_id', lote).neq('estado', 'cancelado').gte('creado_en', desde).limit(1000),
      ),
      enLotes<any>(ids, (lote) =>
        this.db
          .from('ventas')
          .select('cliente_id, total, vendida_en')
          .in('cliente_id', lote)
          .eq('estado', 'completada')
          .is('pedido_id', null)
          .gte('vendida_en', desde)
          .limit(1000),
      ),
    ]);
    return [
      ...pedidos.map((p) => ({ cliente_id: p.cliente_id, total: p.total, fecha: p.creado_en })),
      ...ventas.map((v) => ({ cliente_id: v.cliente_id, total: v.total, fecha: v.vendida_en })),
    ];
  }

  private async comprasGrandes(eventos: EventoLiviano[], hoy: string) {
    // 1) el ticket promedio de la casa: las últimas mil compras de cada lado
    //    en 90 días alcanzan de sobra como muestra
    const desde = sumarDias(hoy, -COMPRA_GRANDE.diasPromedio);
    const [p, v] = await Promise.all([
      this.db.from('pedidos').select('cliente_id, total, creado_en').neq('estado', 'cancelado').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(1000),
      this.db
        .from('ventas')
        .select('cliente_id, total, vendida_en')
        .eq('estado', 'completada')
        .is('pedido_id', null)
        .gte('vendida_en', desde)
        .order('vendida_en', { ascending: false })
        .limit(1000),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (v.error) throw new Error(v.error.message);
    const muestra: Compra[] = [
      ...(p.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.creado_en })),
      ...(v.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.vendida_en })),
    ];
    // 2) las compras grandes con cliente, con su propia consulta (si la casa
    //    vende mucho, la muestra no cubre los 60 días)
    const { umbral } = umbralCompraGrande(muestra, hoy);
    const desdeVentana = sumarDias(hoy, -COMPRA_GRANDE.ventana);
    const [pg, vg] = await Promise.all([
      this.db.from('pedidos').select('cliente_id, total, creado_en').not('cliente_id', 'is', null).neq('estado', 'cancelado').gte('total', umbral).gte('creado_en', desdeVentana).limit(500),
      this.db
        .from('ventas')
        .select('cliente_id, total, vendida_en')
        .not('cliente_id', 'is', null)
        .eq('estado', 'completada')
        .is('pedido_id', null)
        .gte('total', umbral)
        .gte('vendida_en', desdeVentana)
        .limit(500),
    ]);
    if (pg.error) throw new Error(pg.error.message);
    if (vg.error) throw new Error(vg.error.message);
    const candidatas: Compra[] = [
      ...(pg.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.creado_en })),
      ...(vg.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.vendida_en })),
    ];
    const r = comprasGrandes(muestra, eventos, hoy, { candidatas });
    const clientes = await enLotes<any>(r.lista.map((x) => x.cliente_id), (lote) =>
      this.db.from('clientes').select('id, nombre, telefono').in('id', lote),
    );
    const porId = new Map(clientes.map((c) => [c.id, c]));
    return {
      ...r,
      lista: r.lista.map((x) => ({ ...x, nombre: porId.get(x.cliente_id)?.nombre ?? null, telefono: porId.get(x.cliente_id)?.telefono ?? null })),
    };
  }

  // ------------------------------------------------------------- eventos

  async listar(filtros: { estado?: string; tipo?: string }) {
    let q = this.db.from('eventos').select(CON_CLIENTE).order('fecha', { ascending: true, nullsFirst: false }).limit(500);
    if (filtros.estado && (ESTADOS as readonly string[]).includes(filtros.estado)) q = q.eq('estado', filtros.estado);
    if (filtros.tipo && (TIPOS as readonly string[]).includes(filtros.tipo)) q = q.eq('tipo', filtros.tipo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Alta desde el panel. El cliente puede venir elegido (clienteId) o como
   * contacto nuevo (nombre + WhatsApp): en ese caso se busca por teléfono y,
   * si no existe, se da de alta con cliente_de_contacto(), la misma función
   * que usa el bot. Así el evento queda en la ficha del cliente y se le puede
   * mandar la propuesta. Sin nombre, se sugiere ("Casamiento de Ana").
   */
  async crear(dto: any, usuarioId?: string) {
    // la etapa no se elige al crear: todo evento nuevo arranca en Prospecto
    const { nombre, ...resto } = dto ?? {};
    delete resto.estado;
    let fila: Record<string, any>;
    try {
      fila = limpiarDatosEvento({ tipo: 'otro', ...resto });
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Datos inválidos');
    }

    let clienteId: string | null = fila.cliente_id ?? null;
    let quien: string | null = fila.contacto_nombre ?? null;
    if (clienteId) {
      const { data: cli } = await this.db.from('clientes').select('nombre, razon_social').eq('id', clienteId).maybeSingle();
      if (!cli) throw new BadRequestException('No encontré ese cliente.');
      const deEmpresa = fila.tipo === 'corporativo' || fila.tipo === 'fin_de_ano';
      quien = (deEmpresa ? cli.razon_social || cli.nombre : cli.nombre || cli.razon_social) ?? quien;
    } else if (fila.contacto_telefono) {
      const { data: id, error } = await this.db.rpc('cliente_de_contacto', {
        p_telefono: fila.contacto_telefono,
        p_nombre: fila.contacto_nombre ?? null,
      });
      if (error) this.log.warn(`evento nuevo: no pude dar de alta el contacto (${error.message}); queda solo en el evento`);
      else clienteId = (id as string | null) ?? null;
    }

    let nombreFinal: string;
    try {
      nombreFinal = limpiarDatosEvento({ nombre: String(nombre ?? '').trim() || nombreSugerido(fila.tipo, quien) }).nombre as string;
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Nombre inválido');
    }

    const alta: Record<string, any> = {
      ...fila,
      cliente_id: clienteId,
      nombre: nombreFinal,
      estado: 'prospecto',
      origen: fila.origen ?? 'manual',
      creado_por: usuarioId ?? null,
    };
    let r = await this.db.from('eventos').insert(alta).select(CON_CLIENTE).single();
    if (faltaColumna(r.error)) {
      // la migración eventos-pro todavía no está: el lugar y el contacto van a las notas
      r = await this.db.from('eventos').insert(pasarExtrasANotas(alta)).select(CON_CLIENTE).single();
    }
    if (r.error) throw new BadRequestException(r.error.message);
    return r.data;
  }

  /**
   * Cambio de datos o de etapa. Con `motivo` al cancelar, queda escrito en
   * las notas ("Cancelado el 21/10/2026: eligió otro proveedor").
   */
  async actualizar(id: string, dto: any) {
    const { motivo, ...resto } = dto ?? {};
    let patch: Record<string, any>;
    try {
      patch = limpiarDatosEvento(resto);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Datos inválidos');
    }
    const notasActuales = async () => {
      const { data } = await this.db.from('eventos').select('notas').eq('id', id).maybeSingle();
      return (data?.notas as string | null) ?? null;
    };
    if (patch.estado === 'cancelado' && String(motivo ?? '').trim()) {
      const base = patch.notas !== undefined ? patch.notas : await notasActuales();
      const dia = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });
      patch.notas = [base, `Cancelado el ${dia}: ${String(motivo).trim().slice(0, 500)}`].filter(Boolean).join('\n');
    }
    patch.actualizado_en = new Date().toISOString();
    let { error } = await this.db.from('eventos').update(patch).eq('id', id);
    if (faltaColumna(error)) {
      ({ error } = await this.db.from('eventos').update(pasarExtrasANotas(patch, await notasActuales())).eq('id', id));
    }
    if (error) throw new BadRequestException(error.message);
    return this.detalle(id);
  }

  async detalle(id: string) {
    const { data: evento, error } = await this.db.from('eventos').select(CON_CLIENTE).eq('id', id).single();
    if (error || !evento) throw new BadRequestException('No existe el evento');
    const { data: items } = await this.db
      .from('eventos_items')
      .select('id, producto_id, descripcion, cantidad, precio_unitario')
      .eq('evento_id', id)
      .order('descripcion');
    return { ...(evento as any), items: items ?? [] };
  }

  async guardarPropuesta(id: string, items: ItemPropuesta[]) {
    await this.db.from('eventos_items').delete().eq('evento_id', id);
    const limpios = (items ?? []).filter((i) => i.descripcion && Number(i.cantidad) > 0);
    if (limpios.length) {
      await this.db.from('eventos_items').insert(
        limpios.map((i) => ({
          evento_id: id,
          producto_id: i.producto_id ?? null,
          descripcion: i.descripcion,
          cantidad: Number(i.cantidad),
          precio_unitario: Number(i.precio_unitario) || 0,
        })),
      );
    }
    const total = limpios.reduce((s, i) => s + Number(i.cantidad) * (Number(i.precio_unitario) || 0), 0);
    const { data: ev } = await this.db.from('eventos').select('estado').eq('id', id).single();
    const patch: any = { presupuesto: total, actualizado_en: new Date().toISOString() };
    if (ev?.estado === 'prospecto') patch.estado = 'propuesta';
    await this.db.from('eventos').update(patch).eq('id', id);
    return { total, items: limpios.length };
  }

  async enviarPropuesta(id: string) {
    const ev = await this.detalle(id);
    if (!ev.cliente_id) throw new BadRequestException('El evento no tiene un cliente asociado para notificar');
    const total = (ev.items ?? []).reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
    await this.notificar.aCliente(
      ev.cliente_id,
      'Propuesta de bebidas para su evento',
      `Para "${ev.nombre}" preparamos una propuesta de bebidas por ${pesos(total)}. Escribinos para confirmarla o ajustarla.`,
      'evento',
    );
    if (ev.estado === 'prospecto' || ev.estado === 'propuesta') {
      await this.db.from('eventos').update({ estado: 'propuesta', actualizado_en: new Date().toISOString() }).eq('id', id);
    }
    return { ok: true, total };
  }

  // Sugerencia de bebidas con IA, según tipo de evento e invitados
  async sugerir(dto: { tipo?: string; invitados?: number }) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta ANTHROPIC_API_KEY para la sugerencia con IA');
    }
    const invitados = Math.max(Number(dto.invitados) || 0, 1);
    const tipo = TIPO_LABEL[dto.tipo ?? 'otro'] ?? 'evento';
    const catalogo = await this.catalogoBebidas();
    if (!catalogo.length) throw new BadRequestException('No hay bebidas con precio y stock para sugerir');

    const lista = catalogo.map((p) => `${p.sku} · ${p.nombre} · $${p.precio} · stock ${p.stock}`).join('\n');
    const claude = new Anthropic();
    // 6/10/2026: Opus 5.5 (comun/modelos.ts). Iba sin razonamiento (en 4.8,
    // omitirlo lo apaga: contra la regla del 9/9), con 1500 de tope (en 5.5 el
    // razonamiento sale de ese tope) y con el JSON recortado del texto a mano.
    // Ahora la forma la garantiza la salida estructurada ({items: […]}) y un
    // rechazo o un corte dan un error claro.
    const resp = await claude.messages.create({
      model: MODELO_PRINCIPAL,
      max_tokens: 8000,
      thinking: RAZONAMIENTO,
      output_config: {
        effort: esfuerzo('EVENTOS_ESFUERZO'),
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { sku: { type: 'string' }, cantidad: { type: 'number' }, motivo: { type: 'string' } },
                  required: ['sku', 'cantidad', 'motivo'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
        },
      } as any,
      system: `Sos el organizador de eventos de O.D.B Premium Market. Armás propuestas de bebidas equilibradas y realistas para eventos en Argentina. Registro respetuoso y sobrio, de usted, sin emojis ni exclamaciones.
Reglas:
- Usá SOLO productos de la lista que te paso (por SKU). Nunca inventes.
- Calculá cantidades razonables para la cantidad de invitados (regla práctica: ~1 bebida cada 1,5 horas por persona; mezclá categorías: espumante para brindis, vino, cerveza, gaseosas/agua sin alcohol, y algún destilado si corresponde).
- No superes el stock disponible de cada producto.
- Devolvé la propuesta en "items", un renglón por producto: {"sku":"123","cantidad":24,"motivo":"brindis"}.`,
      messages: [
        {
          role: 'user',
          content: `Evento: ${tipo}. Invitados: ${invitados}.\n\nBebidas disponibles (sku · nombre · precio · stock):\n${lista}\n\nArmá la propuesta.`,
        },
      ],
    });
    const leida = jsonDe<{ items?: { sku: string; cantidad: number }[] }>(resp, 'La sugerencia de bebidas');
    const sugeridos: { sku: string; cantidad: number }[] = Array.isArray(leida?.items) ? leida.items : [];

    const porSku = new Map(catalogo.map((p) => [String(p.sku), p]));
    const items: ItemPropuesta[] = [];
    for (const s of sugeridos) {
      const p = porSku.get(String(s.sku));
      if (!p) continue;
      items.push({
        producto_id: p.id,
        descripcion: p.nombre,
        cantidad: Math.max(Math.min(Math.round(Number(s.cantidad) || 0), p.stock), 1),
        precio_unitario: p.precio,
      });
    }
    const total = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);
    return { items, total };
  }

  async presupuestoPdf(id: string): Promise<Buffer> {
    const ev = await this.detalle(id);
    return generarPresupuesto({
      folio: 'PRESU-' + String(id).slice(0, 8).toUpperCase(),
      fecha: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }),
      cliente: ev.cliente ? { nombre: ev.cliente.nombre, dni: ev.cliente.dni } : null,
      evento: { nombre: ev.nombre, tipo: ev.tipo, fecha: ev.fecha, invitados: ev.invitados, lugar: ev.lugar ?? null },
      items: (ev.items ?? []).map((i: any) => ({
        descripcion: i.descripcion, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario),
      })),
    });
  }

  // Los números de arriba de la pantalla (eventos.logica.ts → resumenEventos).
  async resumen() {
    const hoy = hoyBA();
    const filas = await traerTodo<any>((desde, hasta) =>
      this.db.from('eventos').select('estado, presupuesto, fecha').order('creado_en').range(desde, hasta),
    ).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : 'No pude leer los eventos');
    });
    return { hoy, ...resumenEventos(filas, hoy) };
  }

  private async catalogoBebidas() {
    const { data } = await this.db
      .from('productos')
      .select('id, sku, nombre, stock(cantidad)')
      .eq('activo', true)
      .or(
        'nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champ%,nombre.ilike.cerveza%,nombre.ilike.whisky%,nombre.ilike.fernet%,nombre.ilike.gaseosa%,nombre.ilike.aperitivo%,nombre.ilike.vodka%,nombre.ilike.gin%,nombre.ilike.agua%,nombre.ilike.sidra%',
      );
    const conStock = (data ?? [])
      .map((p: any) => ({ ...p, stock: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) }))
      .filter((p: any) => p.stock > 0)
      .sort((a: any, b: any) => b.stock - a.stock)
      .slice(0, 90);
    if (!conStock.length) return [];
    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: conStock.map((p: any) => p.id) });
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));
    return conStock
      .map((p: any) => ({ id: p.id, sku: p.sku, nombre: p.nombre, stock: p.stock, precio: Math.round(Number(precioPor.get(p.id)?.precio_final ?? 0)) }))
      .filter((p: any) => p.precio >= 100) // descarta precios corruptos del import
      .slice(0, 80);
  }
}

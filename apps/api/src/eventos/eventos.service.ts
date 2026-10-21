import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';
import { generarPresupuesto } from './presupuesto';
import { esfuerzo, jsonDe, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { enLotes, traerTodo } from '../comun/lotes';
import {
  ABIERTOS,
  COMPRA_GRANDE,
  ESTADOS,
  ESTADOS_COMPRA,
  TIPOS,
  comprasGrandes,
  cumpleanosProximos,
  empresasFinDeAno,
  esEmpresa,
  eventoDeCumple,
  faltaColumna,
  hoyBA,
  limpiarDatosEvento,
  limpiarItems,
  nombreSugerido,
  pasarExtrasANotas,
  resumenEventos,
  sumarDias,
  telDiez,
  umbralCompraGrande,
  type ClienteConNacimiento,
  type ClienteEmpresa,
  type Compra,
  type EventoLiviano,
} from './eventos.logica';

/**
 * El evento con lo justo del cliente para la tarjeta y el detalle. El token
 * del celular se lee solo para saber si el cliente tiene la app con avisos
 * (conApp lo cambia por `tiene_app` y no sale del API).
 */
const CON_CLIENTE = '*, cliente:clientes(nombre, razon_social, dni, tipo, telefono, expo_push_token)';

/** Cambia el token del celular del cliente por un sí/no: el panel no lo necesita. */
function conApp<T>(ev: T): T {
  const c = (ev as any)?.cliente;
  if (!c || typeof c !== 'object') return ev;
  const { expo_push_token, ...resto } = c;
  return { ...(ev as any), cliente: { ...resto, tiene_app: !!expo_push_token } } as T;
}

/** Los pedidos que cuentan como compra para "compras grandes" (ver ESTADOS_COMPRA). */
const PEDIDO_QUE_AVANZO = `estado.in.(${ESTADOS_COMPRA.join(',')}),tomado_en.not.is.null`;

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
      seguro('cumpleaños', () => this.cumpleanos(ventana, eventos, hoy), [] as Awaited<ReturnType<EventosService['cumpleanos']>>),
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

  // La cuenta va acá y no en cumpleanos_proximos(): la función de la base usa
  // age(), que mira el día de Londres, y nunca mostraba a quien cumple hoy
  // (eventos.logica.ts → proximoCumple).
  private async cumpleanos(dias: number, eventos: EventoLiviano[], hoy: string) {
    const clientes = await traerTodo<ClienteConNacimiento>((desde, hasta) =>
      this.db.from('clientes').select('id, nombre, dni, fecha_nacimiento').not('fecha_nacimiento', 'is', null).order('id').range(desde, hasta),
    );
    return cumpleanosProximos(clientes, hoy, dias).map((c) => {
      const ev = eventoDeCumple(c.cliente_id, eventos, hoy);
      return { ...c, evento_id: ev?.id ?? null, evento_estado: ev?.estado ?? null };
    });
  }

  private async clientesSinFechaDeNacimiento(): Promise<number> {
    const { count, error } = await this.db.from('clientes').select('id', { count: 'exact', head: true }).is('fecha_nacimiento', null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private async empresasFinDeAno(eventos: EventoLiviano[], hoy: string) {
    const desde = sumarDias(hoy, -365);
    const clientes = await traerTodo<ClienteEmpresa>((d, h) =>
      this.db
        .from('clientes')
        .select('id, nombre, razon_social, cuit, condicion_iva, tipo, mayorista, telefono')
        .or('cuit.not.is.null,razon_social.not.is.null,tipo.eq.mayorista,mayorista.is.true,condicion_iva.ilike.responsable*')
        .order('id')
        .range(d, h),
    );
    const empresas = clientes.filter(esEmpresa);
    const [compras, conCharla] = await Promise.all([this.comprasDe(empresas.map((e) => e.id), desde), this.telefonosConCharla(desde)]);
    return empresasFinDeAno(empresas, compras, eventos, hoy, { conCharla });
  }

  /**
   * Las compras de estos clientes desde `desde`: pedidos no cancelados y
   * ventas del local completadas que no vienen de un pedido. De a 100 ids
   * (comun/lotes.ts) y cada lote entero, de a mil (un lote de mayoristas que
   * compran todas las semanas pasa las mil filas, y PostgREST corta sin avisar).
   */
  private async comprasDe(ids: string[], desde: string): Promise<Compra[]> {
    if (!ids.length) return [];
    const todoDelLote = <T>(consulta: (lote: string[], d: number, h: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
      (lote: string[]) => traerTodo<T>((d, h) => consulta(lote, d, h)).then((data) => ({ data, error: null }));
    const [pedidos, ventas] = await Promise.all([
      enLotes<any>(
        ids,
        todoDelLote((lote, d, h) =>
          this.db.from('pedidos').select('id, cliente_id, total, creado_en').in('cliente_id', lote).neq('estado', 'cancelado').gte('creado_en', desde).order('id').range(d, h),
        ),
      ),
      enLotes<any>(
        ids,
        todoDelLote((lote, d, h) =>
          this.db
            .from('ventas')
            .select('id, cliente_id, total, vendida_en')
            .in('cliente_id', lote)
            .eq('estado', 'completada')
            .is('pedido_id', null)
            .gte('vendida_en', desde)
            .order('id')
            .range(d, h),
        ),
      ),
    ]);
    return [
      ...pedidos.map((p) => ({ cliente_id: p.cliente_id, total: p.total, fecha: p.creado_en })),
      ...ventas.map((v) => ({ cliente_id: v.cliente_id, total: v.total, fecha: v.vendida_en })),
    ];
  }

  /**
   * Los teléfonos (diez dígitos) que escribieron por WhatsApp desde `desde`:
   * charlas con el bot y pagos que mandaron a confirmar. Las charlas nuevas
   * vienen con el identificador interno de WhatsApp (LID) en vez del número:
   * se traduce con bot_contactos, como hace telefono_del_chat() en la base.
   */
  private async telefonosConCharla(desde: string): Promise<Set<string>> {
    const [charlas, contactos, pagos] = await Promise.all([
      traerTodo<{ telefono: string | null }>((d, h) =>
        this.db.from('bot_conversaciones').select('linea, telefono').gte('actualizado_en', desde).order('telefono').order('linea').range(d, h),
      ),
      traerTodo<{ telefono: string; telefono_real: string | null }>((d, h) =>
        this.db.from('bot_contactos').select('telefono, telefono_real').not('telefono_real', 'is', null).order('telefono').range(d, h),
      ),
      traerTodo<{ telefono_cliente: string | null }>((d, h) =>
        this.db.from('bot_pagos_en_confirmacion').select('id, telefono_cliente').gte('creado_en', desde).order('id').range(d, h),
      ),
    ]);
    const real = new Map(contactos.map((c) => [String(c.telefono).replace(/\D/g, ''), c.telefono_real]));
    const salida = new Set<string>();
    for (const t of [...charlas.map((c) => c.telefono), ...pagos.map((p) => p.telefono_cliente)]) {
      const d = String(t ?? '').replace(/\D/g, '');
      const diez = telDiez(real.get(d) || d);
      if (diez) salida.add(diez);
    }
    return salida;
  }

  private async comprasGrandes(eventos: EventoLiviano[], hoy: string) {
    // 1) el pedido típico de la casa: las últimas mil compras de cada lado en
    //    90 días alcanzan de sobra como muestra para la mediana. Solo cuentan
    //    los pedidos que avanzaron (ESTADOS_COMPRA o tomados por alguien).
    const desde = sumarDias(hoy, -COMPRA_GRANDE.diasBase);
    const [p, v] = await Promise.all([
      this.db
        .from('pedidos')
        .select('cliente_id, total, creado_en, estado')
        .neq('estado', 'cancelado')
        .or(PEDIDO_QUE_AVANZO)
        .gte('creado_en', desde)
        .order('creado_en', { ascending: false })
        .limit(1000),
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
      ...(p.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.creado_en, estado: x.estado })),
      ...(v.data ?? []).map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.vendida_en })),
    ];
    // 2) las compras grandes con cliente, con su propia consulta y enteras
    //    (si la casa vende mucho, la muestra no cubre los 60 días)
    const { umbral } = umbralCompraGrande(muestra, hoy);
    const desdeVentana = sumarDias(hoy, -COMPRA_GRANDE.ventana);
    const [pg, vg] = await Promise.all([
      traerTodo<any>((d, h) =>
        this.db
          .from('pedidos')
          .select('id, cliente_id, total, creado_en, estado')
          .not('cliente_id', 'is', null)
          .neq('estado', 'cancelado')
          .or(PEDIDO_QUE_AVANZO)
          .gte('total', umbral)
          .gte('creado_en', desdeVentana)
          .order('id')
          .range(d, h),
      ),
      traerTodo<any>((d, h) =>
        this.db
          .from('ventas')
          .select('id, cliente_id, total, vendida_en')
          .not('cliente_id', 'is', null)
          .eq('estado', 'completada')
          .is('pedido_id', null)
          .gte('total', umbral)
          .gte('vendida_en', desdeVentana)
          .order('id')
          .range(d, h),
      ),
    ]);
    const candidatas: Compra[] = [
      ...pg.map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.creado_en, estado: x.estado })),
      ...vg.map((x: any) => ({ cliente_id: x.cliente_id, total: x.total, fecha: x.vendida_en })),
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

  /**
   * El tablero. Sin filtros: todos los abiertos (prospecto, propuesta,
   * confirmado) y los cerrados (realizados y cancelados) del último año, por
   * fecha o por alta. Antes eran los primeros 500 por fecha: con el tiempo, los
   * realizados viejos dejaban afuera justo los próximos y los sin fecha.
   */
  async listar(filtros: { estado?: string; tipo?: string }) {
    const leer = (armar: (q: any) => any) =>
      traerTodo<any>((d, h) => armar(this.db.from('eventos').select(CON_CLIENTE)).order('creado_en').order('id').range(d, h));
    const tipo = filtros.tipo && (TIPOS as readonly string[]).includes(filtros.tipo) ? filtros.tipo : null;
    const conTipo = (q: any) => (tipo ? q.eq('tipo', tipo) : q);
    let filas: any[];
    try {
      if (filtros.estado && (ESTADOS as readonly string[]).includes(filtros.estado)) {
        filas = await leer((q) => conTipo(q.eq('estado', filtros.estado)));
      } else {
        const haceUnAnio = sumarDias(hoyBA(), -365);
        const [abiertos, cerrados] = await Promise.all([
          leer((q) => conTipo(q.in('estado', ABIERTOS as string[]))),
          leer((q) => conTipo(q.in('estado', ['realizado', 'cancelado']).or(`fecha.gte.${haceUnAnio},creado_en.gte.${haceUnAnio}`))),
        ]);
        filas = [...abiertos, ...cerrados];
      }
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'No pude leer los eventos');
    }
    // por fecha, los sin fecha al final (como estaba)
    filas.sort((a, b) => (a.fecha ? (b.fecha ? String(a.fecha).localeCompare(String(b.fecha)) : -1) : b.fecha ? 1 : 0));
    return filas.map(conApp);
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
    return conApp(r.data);
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
    return { ...conApp(evento as any), items: items ?? [] };
  }

  /**
   * Borrar un evento cargado por error (un dato de prueba, uno repetido). Los
   * renglones se van con él (on delete cascade). No es cancelar: un borrado no
   * cuenta en la tasa de cierre.
   */
  async eliminar(id: string) {
    const { data, error } = await this.db.from('eventos').delete().eq('id', id).select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('No existe el evento');
    return { ok: true };
  }

  async guardarPropuesta(id: string, items: unknown) {
    let limpios: ReturnType<typeof limpiarItems>;
    try {
      limpios = limpiarItems(items);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'La propuesta no es válida.');
    }
    const { data: ev, error: eEv } = await this.db.from('eventos').select('estado').eq('id', id).maybeSingle();
    if (eEv) throw new BadRequestException(eEv.message);
    if (!ev) throw new BadRequestException('No existe el evento');
    const { error: eBorrar } = await this.db.from('eventos_items').delete().eq('evento_id', id);
    if (eBorrar) throw new BadRequestException(eBorrar.message);
    if (limpios.length) {
      const { error: eAlta } = await this.db.from('eventos_items').insert(limpios.map((i) => ({ evento_id: id, ...i })));
      if (eAlta) throw new BadRequestException(eAlta.message);
    }
    const total = limpios.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const patch: any = { presupuesto: total, actualizado_en: new Date().toISOString() };
    if (ev.estado === 'prospecto') patch.estado = 'propuesta';
    const { error } = await this.db.from('eventos').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { total, items: limpios.length };
  }

  /**
   * Deja la propuesta como aviso en la cuenta del cliente en la app de ODB y,
   * si tiene la app con las notificaciones activadas, le llega al celular.
   * NO manda WhatsApp. El 21/10/2026 ningún cliente tenía notificaciones (0 de
   * 6.749): por eso devuelve `push` y la pantalla no dice "le llegó" cuando no
   * le llegó nada.
   */
  async enviarPropuesta(id: string) {
    const ev = await this.detalle(id);
    if (!ev.cliente_id) throw new BadRequestException('El evento no tiene un cliente asociado para notificar');
    if (!(ev.items ?? []).length) throw new BadRequestException('La propuesta no tiene productos: guardala antes de avisarle.');
    const total = (ev.items ?? []).reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
    const r = await this.notificar.aCliente(
      ev.cliente_id,
      'Propuesta de bebidas para su evento',
      `Para "${ev.nombre}" preparamos una propuesta de bebidas por ${pesos(total)}. Escribinos para confirmarla o ajustarla.`,
      'evento',
    );
    if (ev.estado === 'prospecto' || ev.estado === 'propuesta') {
      await this.db.from('eventos').update({ estado: 'propuesta', actualizado_en: new Date().toISOString() }).eq('id', id);
    }
    return { ok: true, total, push: !!r?.push };
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
      // el servidor corre en UTC: sin la zona, a las 22 h ya fechaba el día siguiente
      fecha: new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: 'long', year: 'numeric' }),
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

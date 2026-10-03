import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { celularWhatsapp, enviarImagenWhatsapp, enviarTextoWhatsapp } from '../comun/whatsapp';
import { cartelesPedido, nombreParaCartel } from '../comun/cartel-pedido';
import { cuandoLegible } from '../comun/cuando';
import {
  codigoDe, encabezado, esperaParaEscalar, esperaParaReintentar, esTelefonoDePrueba, idLargoDeMensaje, LLEGO,
  MINUTOS_SIN_LLEGAR, MINUTOS_SIN_SALIR, type PedidoParaAviso, type SinCargar, telefonoLegible, textoDeCancelado,
  textoDelAviso, textoDePagado, textoDeSinCargar, type TipoAviso,
} from './aviso-pedido';

// TODA CONFIRMACIÓN DE PEDIDO SALE AL TELÉFONO DE ADMINISTRACIÓN (regla de
// Leandro, 3/10/2026). El 3/10 el bot confirmó PICKUP-5F2451C6C111 y no se le
// avisó a nadie del local: el aviso no existía. Esta es la excepción explícita a
// la regla del 1/9 ("el WhatsApp interno es solo para pagos"): un pedido nuevo,
// su baja, su pago y un pedido que no se pudo cargar SIEMPRE salen por WhatsApp
// a administración. No apagar "por coherencia".
//
// La base deja el aviso pendiente (trigger en pedidos y red de seguridad, ver
// db/migracion-aviso-pedidos.sql). Acá:
// - cada 15 s se mandan los pendientes, de a uno: la tarjeta Placa roja con el
//   texto como epígrafe de la primera página y, si algo no sale, el texto con
//   los productos. Solo cuenta como enviado si WhatsApp devolvió el id. Antes de
//   reintentar se mira el chat por el encabezado exacto, para no repetirlo;
// - cada 30 s, aparte (si WhatsApp se cuelga, el vigía no espera): se pregunta
//   si cada aviso LLEGÓ al teléfono (ack) y, si uno no salió en 3 min o no llegó
//   en 15, se avisa a los dueños por WhatsApp y campanita. Si eso tampoco sale,
//   se reintenta con espera: nunca se da por avisado lo que no salió.
// Mientras tanto, el panel muestra la franja roja (problemas()).
// Solo corre donde puede mandar: en Railway, con WhatsApp configurado. Un
// proceso en una máquina de desarrollo contra la base real no toma avisos.

type FilaAviso = {
  id: string;
  pedido_id: string | null;
  tipo: TipoAviso;
  detalle: any;
  creado_en: string;
  estado: string;
  pendiente_desde: string;
  intentos: number;
  incierto: boolean;
  destino: string | null;
  waha_id: string | null;
  /** lo que ya salió de este aviso (una tarjeta que quedó a medias) */
  waha_ids?: string[] | null;
  /** -1: WhatsApp no pudo entregar el envío anterior (el reenvío va como texto) */
  ack?: number | null;
};

type Envio = { enviado: boolean; id?: string | null; motivo?: string; incierto?: boolean };

export type ProblemaDeAviso = { avisoId: string; pedidoId: string | null; tipo: TipoAviso; codigo: string; problema: 'no_salio' | 'no_llego'; minutos: number; motivo: string | null };

@Injectable()
export class AvisosPedidosService {
  private readonly log = new Logger(AvisosPedidosService.name);
  private enviando = false;
  private vigilando = false;
  /** Al arrancar (un deploy, o después de una caída) primero se manda lo pendiente: el vigía espera un minuto. */
  private readonly arranque = Date.now();
  /** El estado de la sesión de WhatsApp en la última vuelta ('WORKING', 'FAILED'…; 'SIN RESPUESTA' si WAHA no contesta dos veces seguidas). */
  estadoWhatsapp: string | null = null;
  private sinRespuesta = 0;

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  /** Solo en producción (Railway) y con WhatsApp configurado. ODB_AVISOS_PEDIDOS=1 lo fuerza; =0 lo apaga. */
  puedeMandar(): boolean {
    if (process.env.ODB_AVISOS_PEDIDOS === '0') return false;
    if (!process.env.WAHA_URL || !process.env.WAHA_API_KEY) return false;
    return process.env.ODB_AVISOS_PEDIDOS === '1' || !!process.env.RAILWAY_ENVIRONMENT_NAME;
  }

  @Cron('*/15 * * * * *')
  async vueltaDeEnvio() {
    if (this.enviando || !this.puedeMandar()) return;
    this.enviando = true;
    const inicio = Date.now();
    try {
      const { data: faltantes, error: e1 } = await this.db.rpc('encolar_avisos_faltantes');
      if (e1) this.log.error(`no pude revisar pedidos sin aviso: ${e1.message}`);
      else if (Number(faltantes) > 0) this.log.error(`${faltantes} aviso(s) de pedidos faltaban (¿falló el trigger?): encolados ahora`);
      const sesion = await this.sesionWhatsapp();
      this.sinRespuesta = sesion ? 0 : this.sinRespuesta + 1;
      this.estadoWhatsapp = sesion ?? (this.sinRespuesta >= 2 ? 'SIN RESPUESTA' : this.estadoWhatsapp);
      if (!sesion) return;
      // con la sesión caída (o sin poder saberlo) no se toma nada: no suma
      // intentos ni espera, y si sigue así lo ve el vigía y lo escala
      if (this.estadoWhatsapp !== 'WORKING') return;
      // de a uno, hasta 5 por vuelta o 50 segundos
      for (let i = 0; i < 5 && Date.now() - inicio < 50_000; i++) {
        const { data, error } = await this.db.rpc('tomar_avisos_pedidos', { p_limite: 1 });
        if (error) { this.log.error(`no pude tomar avisos de pedidos: ${error.message}`); break; }
        const a = ((data ?? []) as FilaAviso[])[0];
        if (!a) break;
        await this.enviar(a).catch((e) => this.fallo(a, `error inesperado: ${e instanceof Error ? e.message : e}`, true));
      }
    } catch (e) {
      this.log.error(`vuelta de avisos de pedidos: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.enviando = false;
    }
  }

  @Cron('5,35 * * * * *')
  async vueltaDeVigia() {
    if (this.vigilando || !this.puedeMandar()) return;
    this.vigilando = true;
    try {
      await this.verificarEntregas();
      await this.vigilar();
    } catch (e) {
      this.log.error(`vigía de avisos de pedidos: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.vigilando = false;
    }
  }

  /** El teléfono de administración: lineas_whatsapp.derivar_pagos_a de la línea de pedidos. */
  async telefonoAdministracion(): Promise<string | null> {
    const { data } = await this.db.from('lineas_whatsapp').select('derivar_pagos_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
    const n = celularWhatsapp(String((data as any)?.derivar_pagos_a ?? ''));
    return n.length >= 10 ? n : null;
  }

  private async telefonoReal(telefono: string | null | undefined): Promise<string | null> {
    const t = String(telefono ?? '').replace(/\D/g, '');
    if (!t) return null;
    const { data } = await this.db.from('bot_contactos').select('telefono_real').eq('telefono', t).maybeSingle();
    return (data as any)?.telefono_real ? String((data as any).telefono_real) : null;
  }

  async pedidoParaAviso(pedidoId: string): Promise<(PedidoParaAviso & { telefonoDelBot: string | null }) | null> {
    const { data: p, error } = await this.db.from('pedidos')
      .select('id, qr_retiro, canal, estado, total, creado_en, notas, destino_direccion, entrega_fecha, entrega_franja, pagado_en, cliente_id, pedidos_items(cantidad, precio_unitario, productos(nombre))')
      .eq('id', pedidoId).maybeSingle();
    if (error || !p) return null;
    const [cli, bot] = await Promise.all([
      (p as any).cliente_id ? this.db.from('clientes').select('nombre, telefono').eq('id', (p as any).cliente_id).maybeSingle() : Promise.resolve({ data: null } as any),
      this.db.from('bot_cotizaciones').select('telefono').eq('pedido_id', pedidoId).limit(1).maybeSingle(),
    ]);
    const cliente = (cli as any)?.data ?? null;
    return {
      id: (p as any).id, qr_retiro: (p as any).qr_retiro, canal: String((p as any).canal), estado: String((p as any).estado),
      total: Number((p as any).total), creado_en: (p as any).creado_en, notas: (p as any).notas,
      destino_direccion: (p as any).destino_direccion, entrega_fecha: (p as any).entrega_fecha, entrega_franja: (p as any).entrega_franja,
      pagado_en: (p as any).pagado_en, cliente, telefonoReal: await this.telefonoReal(cliente?.telefono), esDelBot: !!(bot as any)?.data,
      telefonoDelBot: (bot as any)?.data?.telefono ?? null,
      items: (((p as any).pedidos_items ?? []) as any[]).map((i) => ({ nombre: String(i.productos?.nombre ?? 'Producto'), cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario) })),
    };
  }

  /** Lo de un pedido que no se pudo cargar: el teléfono, la nota y lo último que se le cotizó. */
  private async sinCargar(detalle: any, aviso: string | null = null): Promise<SinCargar> {
    const telefono = String(detalle?.telefono ?? '');
    const { data: cot } = telefono
      ? await this.db.from('bot_cotizaciones').select('resumen, creada_en').eq('telefono', telefono).is('pedido_id', null)
          .gte('creada_en', new Date(Date.now() - 6 * 3600_000).toISOString()).order('creada_en', { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const { data: k } = telefono ? await this.db.from('bot_contactos').select('nombre, nombre_wa').eq('telefono', telefono.replace(/\D/g, '')).maybeSingle() : { data: null };
    return { telefono, telefonoReal: await this.telefonoReal(telefono), nombre: (k as any)?.nombre ?? (k as any)?.nombre_wa ?? null, nota: String(detalle?.nota ?? ''), resumen: (cot as any)?.resumen ?? null, aviso };
  }

  private async enviar(a: FilaAviso) {
    const destino = await this.telefonoAdministracion();
    if (!destino) return this.fallo(a, 'no hay teléfono de administración cargado (lineas_whatsapp.derivar_pagos_a)', false);
    const chatId = `${destino}@c.us`;

    // qué se manda
    let cabeza: string;
    let tarjeta: { pedido: PedidoParaAviso; epigrafe: string } | null = null;
    // el texto del alta que se arma ahora dice "Ya está pagado."
    let pagadoAlArmar = false;
    let texto: string;
    if (a.tipo === 'pedido_sin_cargar') {
      const cargado = await this.pedidoCargadoDespues(String(a.detalle?.telefono ?? ''), a.creado_en);
      if (cargado) return this.omitir(a, `el pedido se cargó después (${cargado}): sale como PEDIDO NUEVO`);
      const s = await this.sinCargar(a.detalle, a.id);
      texto = textoDeSinCargar(s);
      cabeza = texto.split('\n')[0];
    } else {
      const pedido = a.pedido_id ? await this.pedidoParaAviso(a.pedido_id) : null;
      if (!pedido) return this.fallo(a, 'no encontré el pedido', false);
      cabeza = encabezado(a.tipo, codigoDe(pedido));
      if (a.tipo === 'pedido_nuevo') {
        if (pedido.estado === 'cancelado' || pedido.estado === 'entregado') {
          // el alta pudo haber salido sin quedar anotada (envío incierto, deploy,
          // tarjeta a medias): si salió, se marca y la base encola la BAJA; si no, se omite
          const parciales = (a.waha_ids ?? []).filter(Boolean);
          const hallado = parciales.length ? { id: parciales[0], conImagen: false } : (a.intentos > 1 || a.incierto) ? await this.buscarEnElChat(chatId, cabeza) : null;
          if (hallado && pedido.estado === 'cancelado') {
            await this.enviado(a, destino, parciales.length ? parciales : [hallado.id], 'el alta había salido; el pedido se canceló después');
            await this.db.rpc('encolar_avisos_faltantes').then(() => null, () => null);
            return;
          }
          // Un intento anterior pudo haber llegado aunque no aparezca (WhatsApp
          // no dejó leer el chat, o todavía lo estaba mandando): la BAJA sale
          // igual. Una baja de un alta que no llegó no hace daño; una baja que
          // falta, sí (preparan un pedido cancelado).
          if (pedido.estado === 'cancelado' && (a.intentos > 1 || a.incierto)) {
            await this.omitir(a, 'el pedido se canceló; el alta pudo haber salido: se manda la baja por las dudas');
            const { error } = await this.db.from('avisos_pedidos').insert({ pedido_id: pedido.id, tipo: 'pedido_cancelado' });
            if (error && (error as any).code !== '23505') this.log.error(`no pude encolar la baja de ${cabeza}: ${error.message}`);
            return;
          }
          return this.omitir(a, pedido.estado === 'cancelado' ? 'el pedido se canceló antes de avisar' : 'el pedido ya se entregó antes de avisar');
        }
        if (pedido.esDelBot && esTelefonoDePrueba(pedido.telefonoDelBot) && !(await this.esChatReal(pedido.telefonoDelBot))) return this.omitir(a, 'pedido de prueba del simulador del panel');
        pagadoAlArmar = !!pedido.pagado_en;
        const antesSinCargar = await this.antesSinCargar(pedido);
        texto = textoDelAviso(pedido, { conRenglones: true, antesSinCargar });
        if (pedido.items.length) tarjeta = { pedido, epigrafe: textoDelAviso(pedido, { conRenglones: false, antesSinCargar }) };
      } else {
        if (a.tipo === 'pedido_pagado' && pedido.pagado_en) {
          // solo si el texto del alta que SALIÓ decía "Ya está pagado." (ante la duda, el pago sale: repetido no hace daño)
          // y solo si ese texto LLEGÓ (entregado): si está apenas enviado, el pago
          // espera un minuto (WhatsApp todavía puede marcarlo con error de entrega)
          const segun = await this.pagoSegunElAlta(pedido.id);
          if (segun === 'omitir') return this.omitir(a, 'el alta ya llegó diciendo que estaba pagado');
          if (segun === 'retener') {
            // con tope (15 minutos): si el alta no llega, el pago sale igual (repetido no hace daño)
            await this.actualizar(a.id, { tomado_hasta: null, ultimo_error: null, proximo_intento: new Date(Date.now() + 60_000).toISOString() });
            return;
          }
        }
        texto = a.tipo === 'pedido_cancelado' ? textoDeCancelado(pedido) : textoDePagado(pedido);
      }
    }

    // Una tarjeta que quedó a medias en un intento anterior: va el texto completo
    // con los productos (lo que ya salió no alcanza, y buscar el encabezado
    // encontraría la primera página y lo daría por enviado)
    const previos = (a.waha_ids ?? []).filter(Boolean);
    if (previos.length) {
      const yaTexto = await this.buscarEnElChat(chatId, cabeza);
      if (yaTexto && !yaTexto.conImagen) return this.enviado(a, destino, [...previos, yaTexto.id], 'el texto ya había salido (se encontró en el chat)');
      const r = await enviarTextoWhatsapp(this.db, destino, texto, 'aviso-pedido');
      if (r.enviado && r.id) return this.enviado(a, destino, [...previos, String(r.id)], 'se completó con el texto');
      return this.fallo(a, r.motivo ?? 'WhatsApp no devolvió el id del mensaje', r.incierto ?? !r.enviado, previos);
    }

    // Un reintento (o un intento anterior que no sabemos si salió): antes de
    // repetir, se busca en el chat el encabezado exacto de este aviso.
    if (a.intentos > 1 || a.incierto) {
      const ya = await this.buscarEnElChat(chatId, cabeza);
      if (ya) return this.yaEstaba(a, destino, ya, texto, 'ya había salido (se encontró en el chat)');
    }

    // 1) la tarjeta Placa roja (regla: todo detalle de productos va en la
    //    tarjeta), con el texto como epígrafe de la PRIMERA página
    const ids: string[] = [];
    let completo = false;
    let ultimo: Envio | null = null;
    if (tarjeta && a.ack !== -1) {
      try {
        const urls = await this.subirTarjeta(tarjeta.pedido, codigoDe(tarjeta.pedido));
        if (urls?.length) {
          completo = true;
          for (let i = 0; i < urls.length; i++) {
            ultimo = await enviarImagenWhatsapp(this.db, destino, urls[i], i === 0 ? tarjeta.epigrafe : '', 'aviso-pedido');
            if (ultimo.enviado && ultimo.id) ids.push(String(ultimo.id));
            else { completo = false; break; }
          }
        }
      } catch (e) {
        this.log.warn(`la tarjeta del aviso ${cabeza} no salió (${e instanceof Error ? e.message : e}); va el texto`);
      }
    }
    // 2) si la tarjeta no salió entera (o no hay tarjeta), el texto completo
    if (!completo) {
      if (!ids.length && ultimo?.incierto) {
        const ya = await this.buscarEnElChat(chatId, cabeza);
        if (ya) return this.yaEstaba(a, destino, ya, texto, 'la tarjeta salió aunque WhatsApp no contestó');
      }
      ultimo = await enviarTextoWhatsapp(this.db, destino, texto, 'aviso-pedido');
      if (ultimo.enviado && ultimo.id) ids.push(String(ultimo.id));
      else return this.fallo(a, ultimo.motivo ?? 'WhatsApp no devolvió el id del mensaje', ultimo.incierto ?? !ultimo.enviado, ids);
    }
    // el texto que salió decía "Ya está pagado.": el PEDIDO PAGADO se puede omitir después
    const dijoPagado = a.tipo === 'pedido_nuevo' && pagadoAlArmar;
    await this.enviado(a, destino, ids, undefined, dijoPagado ? { detalle: { ...(a.detalle ?? {}), dijo_pagado: true } } : {});
    // si mientras tanto el pedido se canceló o se pagó, la base encola la baja o el pago
    if (a.tipo === 'pedido_nuevo') await this.db.rpc('encolar_avisos_faltantes').then(() => null, () => null);
  }

  /**
   * Lo encontrado en el chat ya salió. Si es la imagen de la tarjeta, puede ser
   * solo la primera página: se completa con el texto con los productos (mejor
   * repetido que con productos de menos). Queda anotado en bot_envios para que
   * su eco y una respuesta citándolo se reconozcan.
   */
  private async yaEstaba(a: FilaAviso, destino: string, hallado: { id: string; conImagen: boolean }, texto: string, nota: string) {
    try {
      await this.db.from('bot_envios').upsert({ waha_id: hallado.id, telefono: destino, origen: 'aviso-pedido' }, { onConflict: 'waha_id' });
    } catch { /* el registro del eco no puede frenar el aviso */ }
    if (!hallado.conImagen || a.tipo !== 'pedido_nuevo') return this.enviado(a, destino, [hallado.id], nota);
    const r = await enviarTextoWhatsapp(this.db, destino, texto, 'aviso-pedido');
    if (r.enviado && r.id) return this.enviado(a, destino, [hallado.id, String(r.id)], `${nota}; se completó con el texto`);
    return this.fallo(a, r.motivo ?? 'WhatsApp no devolvió el id del mensaje', r.incierto ?? !r.enviado, [hallado.id]);
  }

  /** ¿Ese teléfono escribió alguna vez de verdad por WhatsApp? (el simulador del panel nunca pasa por bot_entrantes) */
  private async esChatReal(telefono: string | null | undefined): Promise<boolean> {
    const t = String(telefono ?? '').replace(/\D/g, '');
    if (!t) return false;
    const { data, error } = await this.db.from('bot_entrantes').select('waha_id').like('chat', `${t}@%`).limit(1);
    return !!error || !!(data ?? []).length; // sin poder saberlo, se avisa
  }

  /**
   * Qué hacer con el PEDIDO PAGADO según el alta (una sola regla para el envío,
   * el vigía y la franja): 'omitir' si el alta que LLEGÓ ya decía "Ya está
   * pagado."; 'retener' si esa alta está en camino (enviada hace menos de 15
   * minutos y sin "Ya avisé al local"); null en cualquier otro caso: el pago sale
   * y se vigila como cualquier aviso.
   */
  private async pagoSegunElAlta(pedidoId: string): Promise<'omitir' | 'retener' | null> {
    const { data: alta } = await this.db.from('avisos_pedidos').select('detalle, estado, enviado_en, visto_en').eq('pedido_id', pedidoId).eq('tipo', 'pedido_nuevo').maybeSingle();
    if ((alta as any)?.detalle?.dijo_pagado !== true) return null;
    if ((alta as any).estado === 'entregado') return 'omitir';
    const esperando = (alta as any).enviado_en ? Date.now() - new Date((alta as any).enviado_en).getTime() : Infinity;
    return (alta as any).estado === 'enviado' && !(alta as any).visto_en && esperando < MINUTOS_SIN_LLEGAR * 60_000 ? 'retener' : null;
  }

  /** ¿El chat de un pedido "sin cargar" terminó teniendo su pedido? Devuelve el código. */
  private async pedidoCargadoDespues(telefono: string, desde: string): Promise<string | null> {
    if (!telefono) return null;
    const { data } = await this.db.from('bot_cotizaciones').select('pedido_id, confirmada_en, pedidos(qr_retiro)')
      .eq('telefono', telefono).not('pedido_id', 'is', null)
      .gte('confirmada_en', new Date(desde).toISOString())
      .order('confirmada_en', { ascending: true }).limit(1).maybeSingle();
    return (data as any)?.pedido_id ? String((data as any)?.pedidos?.qr_retiro ?? (data as any).pedido_id) : null;
  }

  /** ¿Este pedido del bot llegó antes como "sin cargar" (aviso enviado del mismo chat en las 2 horas previas)? */
  private async antesSinCargar(p: PedidoParaAviso & { telefonoDelBot?: string | null }): Promise<boolean> {
    if (!p.esDelBot || !p.telefonoDelBot) return false;
    const { data } = await this.db.from('avisos_pedidos').select('id').eq('tipo', 'pedido_sin_cargar')
      .eq('detalle->>telefono', p.telefonoDelBot).in('estado', ['enviado', 'entregado'])
      .gte('creado_en', new Date(new Date(p.creado_en).getTime() - 2 * 3600_000).toISOString()).limit(1).maybeSingle();
    return !!data;
  }

  /** La tarjeta del pedido, subida al storage público (WAHA la baja de ahí). null si no se pudo. */
  private async subirTarjeta(p: PedidoParaAviso, codigo: string): Promise<string[] | null> {
    const domicilio = p.canal === 'domicilio';
    const cuando = cuandoLegible(p.entrega_fecha, p.entrega_franja)?.replace(/^el /, '') ?? null;
    const renglones = p.items.filter((i) => i.cantidad > 0).map((i) => ({
      nombre: nombreParaCartel(i.nombre), cantidad: i.cantidad, unitario: i.precio_unitario, subtotal: Math.round(i.cantidad * i.precio_unitario),
    }));
    const pngs = await cartelesPedido({
      renglones,
      total: Math.round(p.total),
      entrega: domicilio
        ? { titulo: 'Envío', detalle: [p.destino_direccion, cuando].filter(Boolean).join(' · ') || 'Dirección sin cargar' }
        : { titulo: 'Retiro en la sucursal Saint Thomas', detalle: cuando || 'Sin día: lo antes posible' },
      confirmar: false,
      pie: '',
      titulo: 'PEDIDO NUEVO',
      subtitulo: codigo,
      nota: [p.cliente?.nombre, telefonoLegible(p.telefonoReal) ?? telefonoLegible(p.cliente?.telefono)].filter(Boolean).join(' · ') || undefined,
    });
    const mes = new Date().toISOString().slice(0, 7);
    const base = `aviso-${codigo}-${Date.now()}`;
    const urls: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const ruta = `carteles/${mes}/${base}${pngs.length > 1 ? `-${i + 1}` : ''}.png`;
      const { error } = await this.db.storage.from('publico').upload(ruta, pngs[i], { contentType: 'image/png', upsert: true });
      if (error) { this.log.warn(`no pude subir la tarjeta del aviso de ${codigo}: ${error.message}`); return null; }
      urls.push(this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl);
    }
    return urls;
  }

  private async actualizar(id: string, cambios: Record<string, unknown>) {
    // si la marca no se graba, se reintenta: un aviso enviado que queda
    // "pendiente" se volvería a mandar (el reintento mira el chat, pero mejor no llegar ahí)
    for (let i = 0; i < 3; i++) {
      const { error } = await this.db.from('avisos_pedidos').update(cambios).eq('id', id);
      if (!error) return;
      this.log.error(`no pude grabar el aviso ${id} (intento ${i + 1}): ${error.message}`);
    }
  }

  private async enviado(a: FilaAviso, destino: string, ids: string[], nota?: string, extra: Record<string, unknown> = {}) {
    for (const id of ids) {
      try { await this.db.from('bot_envios').upsert({ waha_id: id, telefono: destino, origen: 'aviso-pedido' }, { onConflict: 'waha_id' }); } catch { /* el registro del eco no frena el aviso */ }
    }
    await this.actualizar(a.id, {
      estado: 'enviado', destino, waha_id: ids[0], waha_ids: ids, enviado_en: new Date().toISOString(), tomado_hasta: null,
      incierto: false, ultimo_error: null, proximo_intento: new Date(Date.now() + 20_000).toISOString(),
      // problema nuevo, reloj nuevo: lo que se esperó para escalar "no salió" no atrasa "no llegó"
      ack: null, escalar_intentos: 0, escalar_proximo: null,
      ...extra,
    });
    this.log.log(`aviso ${a.tipo} ${a.pedido_id ?? ''} enviado a administración (${destino})${nota ? `: ${nota}` : ''}`);
  }

  private async omitir(a: FilaAviso, motivo: string) {
    await this.actualizar(a.id, { estado: 'omitido', motivo, tomado_hasta: null });
    this.log.log(`aviso ${a.tipo} ${a.pedido_id ?? ''} omitido: ${motivo}`);
  }

  private async fallo(a: FilaAviso, motivo: string, incierto: boolean, yaSalieron: string[] = []) {
    const espera = esperaParaReintentar(a.intentos);
    this.log.error(`aviso ${a.tipo} ${a.pedido_id ?? ''} NO salió (intento ${a.intentos}): ${motivo}. Reintento en ${Math.round(espera / 1000)} s`);
    await this.actualizar(a.id, {
      ultimo_error: motivo.slice(0, 500), incierto, tomado_hasta: null,
      proximo_intento: new Date(Date.now() + espera).toISOString(),
      // si una parte ya salió (páginas de la tarjeta), queda anotada: el reintento completa con el texto
      ...(yaSalieron.length ? { waha_ids: yaSalieron } : {}),
    });
  }

  private wahaBase() {
    const url = process.env.WAHA_URL;
    const key = process.env.WAHA_API_KEY;
    return url && key ? { base: url.replace(/\/$/, ''), key, sesion: process.env.WAHA_SESSION || 'default' } : null;
  }

  private async getWaha(ruta: string): Promise<any> {
    const w = this.wahaBase();
    if (!w) return null;
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch(`${w.base}${ruta.replace('{sesion}', encodeURIComponent(w.sesion))}`, { headers: { 'X-Api-Key': w.key }, signal: ctrl.signal });
      return r.ok ? await r.json().catch(() => null) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  /** El estado de la sesión de WhatsApp de la casa ('WORKING' es que anda). null si no se pudo saber. */
  private async sesionWhatsapp(): Promise<string | null> {
    const s = await this.getWaha('/api/sessions/{sesion}');
    return s?.status ? String(s.status) : null;
  }

  /** ¿Ya hay en el chat de administración un mensaje nuestro que empieza con este encabezado? Devuelve su id y si es una imagen. */
  private async buscarEnElChat(chatId: string, cabeza: string): Promise<{ id: string; conImagen: boolean } | null> {
    const msjs = await this.getWaha(`/api/{sesion}/chats/${encodeURIComponent(chatId)}/messages?limit=50&downloadMedia=false`);
    // un mensaje que WhatsApp marcó con error de entrega (ack -1) no cuenta: si
    // no, el reenvío lo encontraba a él y el aviso daba vueltas sin salir nunca
    const iguales = (Array.isArray(msjs) ? msjs : []).filter((m: any) => m?.fromMe && m?.ack !== -1 && String(m?.body ?? m?.caption ?? '').trim().split('\n')[0].trim() === cabeza);
    // el texto con ese encabezado es el aviso completo; la imagen puede ser solo la página 1
    const hallado = iguales.find((m: any) => !m?.hasMedia) ?? iguales[0];
    const id = hallado ? String(hallado.id?._serialized ?? hallado.id ?? '') : '';
    return id ? { id, conImagen: !!hallado.hasMedia } : null;
  }

  /** Pregunta a WhatsApp si los avisos enviados llegaron al teléfono (ack 2 o más). */
  private async verificarEntregas() {
    const { data } = await this.db.from('avisos_pedidos').select('id, pedido_id, destino, waha_id, enviado_en, creado_en, pendiente_desde, intentos, visto_en, detalle')
      .eq('estado', 'enviado').lte('proximo_intento', new Date().toISOString())
      .gte('enviado_en', new Date(Date.now() - 48 * 3600_000).toISOString()).limit(10);
    for (const a of (data ?? []) as any[]) {
      if (!a.waha_id || !a.destino) continue;
      const chatId = `${a.destino}@c.us`;
      const m = await this.getWaha(`/api/{sesion}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(idLargoDeMensaje(chatId, a.waha_id))}`);
      const ack = m && typeof m.ack === 'number' ? m.ack : null;
      if (ack !== null && LLEGO(ack)) {
        await this.actualizar(a.id, { estado: 'entregado', ack, entregado_en: new Date().toISOString() });
        this.log.log(`aviso ${a.id} ENTREGADO en el teléfono de administración (ack ${ack})`);
      } else if (ack === -1) {
        // WhatsApp dice que no lo pudo entregar: se vuelve a mandar, como texto.
        // Los 3 minutos sin salir se cuentan desde el PRIMER error de entrega
        // (pendiente_desde solo se toca esa vez: nace igual a creado_en), no
        // desde cada uno: si sigue fallando, escala.
        const ahora = new Date().toISOString();
        const primera = new Date(a.pendiente_desde).getTime() === new Date(a.creado_en).getTime();
        // Tope: con errores de entrega repetidos durante 30 minutos, o si ya
        // avisaron por otro medio, o pasadas 48 horas, no se reenvía más (queda
        // pendiente, a la vista en la franja, y escalado). Seguir mandando a un
        // número que WhatsApp no entrega solo le suma riesgo a la línea.
        // el primer error siempre tiene un reenvío (como texto); después, el tope
        const basta = !primera && (!!a.visto_en || Date.now() - new Date(a.creado_en).getTime() > 48 * 3600_000
          || Date.now() - new Date(a.pendiente_desde).getTime() > 30 * 60_000);
        await this.actualizar(a.id, {
          estado: 'pendiente', ack, incierto: false, waha_ids: [],
          // lo que decía el texto que no llegó no cuenta (el PEDIDO PAGADO no se omite por él)
          detalle: { ...((a as any).detalle ?? {}), dijo_pagado: false },
          ultimo_error: basta
            ? 'WhatsApp marcó error de entrega (ack -1) repetidas veces: no se reenvía más; avisen por otro medio'
            : 'WhatsApp marcó error de entrega (ack -1): se reenvía',
          proximo_intento: basta ? 'infinity' : new Date(Date.now() + esperaParaReintentar(Number(a.intentos ?? 1))).toISOString(),
          // el escalamiento se rearma solo con el PRIMER error: no un WhatsApp a los dueños por cada reenvío
          ...(primera ? { pendiente_desde: ahora, escalado_en: null, escalar_intentos: 0, escalar_proximo: null } : {}),
        });
        this.log.error(`aviso ${a.id}: WhatsApp marcó error de entrega; se reenvía`);
      } else {
        await this.actualizar(a.id, { ack, proximo_intento: new Date(Date.now() + 60_000).toISOString() });
      }
    }
  }

  /** Lo que está mal ahora: avisos que no salieron en 3 minutos o no llegaron en 15 (sin los marcados "ya avisé"). Si no se puede consultar, tira. */
  async problemas(): Promise<ProblemaDeAviso[]> {
    const desde = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data, error } = await this.db.from('avisos_pedidos')
      .select('id, pedido_id, tipo, detalle, pendiente_desde, estado, enviado_en, ultimo_error, ack, visto_en, tomado_hasta, pedidos(qr_retiro, estado)')
      .in('estado', ['pendiente', 'enviado']).gte('creado_en', desde);
    if (error) throw new Error(`no pude consultar los avisos de pedidos: ${error.message}`);
    const ahora = Date.now();
    const salida: ProblemaDeAviso[] = [];
    for (const a of (data ?? []) as any[]) {
      if (a.visto_en) continue;
      if (a.tipo === 'pedido_nuevo' && ['cancelado', 'entregado'].includes(String(a.pedidos?.estado ?? ''))) continue;
      const codigo = a.pedidos?.qr_retiro ? String(a.pedidos.qr_retiro) : a.detalle?.telefono ? `chat ${telefonoLegible(a.detalle.telefono) ?? a.detalle.telefono}` : String(a.id).slice(0, 8);
      if (a.estado === 'pendiente') {
        // un PEDIDO PAGADO retenido a propósito (el alta que ya dice "pagado" está en camino) no es un problema
        if (a.tipo === 'pedido_pagado' && a.pedido_id && (await this.pagoSegunElAlta(a.pedido_id))) continue;
        // se está mandando ahora mismo (tomado hace menos de 2 minutos): todavía no es un problema
        if (a.tomado_hasta && new Date(a.tomado_hasta).getTime() - ahora > 3 * 60_000) continue;
        const min = Math.floor((ahora - new Date(a.pendiente_desde).getTime()) / 60_000);
        if (min >= MINUTOS_SIN_SALIR) salida.push({ avisoId: a.id, pedidoId: a.pedido_id, tipo: a.tipo, codigo, problema: 'no_salio', minutos: min, motivo: a.ultimo_error ?? (this.estadoWhatsapp && this.estadoWhatsapp !== 'WORKING' ? `el WhatsApp de la casa está desconectado (${this.estadoWhatsapp})` : null) });
      } else if (a.enviado_en) {
        const min = Math.floor((ahora - new Date(a.enviado_en).getTime()) / 60_000);
        if (min >= MINUTOS_SIN_LLEGAR) salida.push({ avisoId: a.id, pedidoId: a.pedido_id, tipo: a.tipo, codigo, problema: 'no_llego', minutos: min, motivo: a.ack === null ? 'WhatsApp todavía no confirma que llegó' : `el mensaje quedó con un solo tilde (ack ${a.ack}): el teléfono de administración puede estar apagado o sin conexión` });
      }
    }
    return salida;
  }

  /** "Ya avisé al local": saca el problema de la franja roja (queda quién y cuándo). */
  async marcarVisto(avisoId: string, usuarioId: string | null) {
    const { error } = await this.db.from('avisos_pedidos').update({ visto_en: new Date().toISOString(), visto_por: usuarioId }).eq('id', avisoId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  /** Si un aviso no salió o no llegó, los dueños se enteran. Se marca solo cuando el aviso a los dueños SALIÓ; si no, se reintenta. */
  private async vigilar() {
    // 3/10/2026: al arrancar, el aviso pendiente desde hacía una hora salió en el
    // segundo 21 y el vigía ya había escalado "NO SALIÓ" a los dueños en el 20
    if (Date.now() - this.arranque < 60_000) return;
    for (const p of await this.problemas()) {
      const columna = p.problema === 'no_salio' ? 'escalado_en' : 'escalado_entrega_en';
      // se toma el escalamiento (dos procesos durante un deploy no lo mandan dos veces)
      const ahora = new Date().toISOString();
      const { data: tomada } = await this.db.from('avisos_pedidos')
        .update({ escalar_proximo: new Date(Date.now() + 3 * 60_000).toISOString() })
        .eq('id', p.avisoId).is(columna, null).or(`escalar_proximo.is.null,escalar_proximo.lte."${ahora}"`)
        .select('escalar_intentos');
      if (!tomada?.length) continue;
      const intentos = Number((tomada[0] as any).escalar_intentos ?? 0);
      const r = await this.escalar(p, intentos).catch((e) => {
        this.log.error(`no pude escalar el aviso de ${p.codigo}: ${e instanceof Error ? e.message : e}`);
        return 'fallo' as const;
      });
      await this.actualizar(p.avisoId, r === 'escalado'
        ? { [columna]: new Date().toISOString(), escalar_proximo: null, escalar_intentos: 0 }
        : r === 'resuelto'
          ? { escalar_proximo: null, escalar_intentos: 0 }
          : r === 'postergado'
            // se cuenta: si se posterga otra vez (el proceso se cae cada vez que lo toma), se escala
            ? { escalar_proximo: new Date(Date.now() + 60_000).toISOString(), escalar_intentos: intentos + 1 }
            : { escalar_intentos: intentos + 1, escalar_proximo: new Date(Date.now() + esperaParaEscalar(intentos)).toISOString() });
    }
  }

  /** El encabezado con que empieza el aviso (para buscarlo en el chat). */
  private async cabezaDelAviso(p: ProblemaDeAviso): Promise<string | null> {
    if (p.tipo === 'pedido_sin_cargar') {
      const { data: fila } = await this.db.from('avisos_pedidos').select('detalle').eq('id', p.avisoId).maybeSingle();
      return textoDeSinCargar(await this.sinCargar((fila as any)?.detalle, p.avisoId)).split('\n')[0];
    }
    const { data: ped } = p.pedidoId ? await this.db.from('pedidos').select('id, qr_retiro').eq('id', p.pedidoId).maybeSingle() : { data: null };
    return ped ? encabezado(p.tipo, codigoDe(ped as any)) : null;
  }

  /** 'escalado' si a algún dueño le salió el WhatsApp; 'resuelto' si el aviso salió (o llegó) mientras tanto. La campanita, una sola vez por problema. */
  private async escalar(p: ProblemaDeAviso, intentos: number): Promise<'escalado' | 'fallo' | 'resuelto' | 'postergado'> {
    const primeraVez = intentos === 0;
    // justo antes de avisar a los dueños, se vuelve a mirar: si mientras tanto
    // salió (o llegó), no hay nada que escalar
    const { data: ahora } = await this.db.from('avisos_pedidos').select('estado, tomado_hasta, waha_ids').eq('id', p.avisoId).maybeSingle();
    const tomadoAhora = !!(ahora as any)?.tomado_hasta && new Date((ahora as any).tomado_hasta).getTime() > Date.now();
    const sigue = p.problema === 'no_salio' ? (ahora as any)?.estado === 'pendiente' : (ahora as any)?.estado === 'enviado';
    if (!sigue) {
      this.log.log(`el aviso de ${p.codigo} se resolvió solo (${(ahora as any)?.estado ?? 'sin datos'}): no se escala`);
      return 'resuelto';
    }
    // un PEDIDO PAGADO retenido a propósito (el alta que ya dice "pagado" está
    // en camino) no es "no salió": si el alta no llega, la escala el vigía por ella
    if (p.tipo === 'pedido_pagado' && p.problema === 'no_salio' && p.pedidoId && (await this.pagoSegunElAlta(p.pedidoId))) return 'resuelto';
    const admin = await this.telefonoAdministracion();
    // "no salió", pero puede haber salido sin que quedara anotado (un deploy
    // cortó el proceso con el envío en vuelo): se mira el chat antes de alarmar
    if (p.problema === 'no_salio' && admin) {
      const cabeza = await this.cabezaDelAviso(p);
      const ya = cabeza ? await this.buscarEnElChat(`${admin}@c.us`, cabeza) : null;
      if (ya && !(ya.conImagen && p.tipo === 'pedido_nuevo')) {
        await this.enviado({ id: p.avisoId, tipo: p.tipo, pedido_id: p.pedidoId } as FilaAviso, admin, [ya.id], 'estaba en el chat aunque no había quedado anotado');
        return 'resuelto';
      }
      // la imagen de la tarjeta puede ser solo la página 1: la primera vez se
      // deja que el envío la complete con el texto (sin pisar a un proceso que
      // la está mandando); si ya se sabía y el texto sigue sin salir, se escala
      if (ya && !((ahora as any)?.waha_ids ?? []).filter(Boolean).length) {
        if (tomadoAhora) return 'postergado';
        await this.actualizar(p.avisoId, { waha_ids: [ya.id], proximo_intento: new Date().toISOString(), tomado_hasta: null });
        this.log.warn(`el aviso de ${p.codigo}: la tarjeta está en el chat pero puede estar a medias; se completa con el texto antes de escalar`);
        return 'resuelto';
      }
      // lo tiene tomado un proceso que ya no está (un deploy lo cortó): se
      // libera para que se reintente ya, y se escala recién si tampoco sale
      // (una sola vez: si vuelve a pasar, se escala)
      if (!ya && tomadoAhora && intentos < 1) {
        await this.actualizar(p.avisoId, { tomado_hasta: null, proximo_intento: new Date().toISOString() });
        this.log.warn(`el aviso de ${p.codigo} estaba tomado por un proceso que no terminó: se reintenta antes de escalar`);
        return 'postergado';
      }
    }
    const titulo = p.problema === 'no_salio'
      ? `El aviso ${p.tipo === 'pedido_nuevo' ? 'del pedido' : 'de'} ${p.codigo} NO SALIÓ a administración`
      : `El aviso ${p.tipo === 'pedido_nuevo' ? 'del pedido' : 'de'} ${p.codigo} no le LLEGÓ a administración`;
    const detalle = `${p.problema === 'no_salio' ? `Hace ${p.minutos} min que no sale` : `Salió hace ${p.minutos} min y WhatsApp no confirma que llegó`}${admin ? ` al ${telefonoLegible(admin)}` : ''}. ${p.motivo ?? ''} Avisen al local por otro medio.`.replace(/\s{2,}/g, ' ').trim();
    this.log.error(`${titulo}. ${detalle}`);
    const { data: duenos } = await this.db.from('usuarios').select('id, nombre, telefono').eq('rol', 'dueno').eq('activo', true);
    if (primeraVez) {
      for (const u of (duenos ?? []) as any[]) {
        await this.db.from('alertas_internas').insert({ para_usuario: u.id, tipo: 'pedido_sin_aviso', titulo, detalle, referencia: { pedido_id: p.pedidoId, aviso_id: p.avisoId, link: '/pedidos' } }).then(() => null, () => null);
      }
    }
    // el detalle del pedido es un agregado: si no se puede armar, el aviso a
    // los dueños sale igual con el título
    let cuerpo = '';
    try {
      if (p.tipo === 'pedido_sin_cargar') {
        const { data: fila } = await this.db.from('avisos_pedidos').select('detalle').eq('id', p.avisoId).maybeSingle();
        cuerpo = textoDeSinCargar(await this.sinCargar((fila as any)?.detalle, p.avisoId));
      } else if (p.pedidoId) {
        const pedido = await this.pedidoParaAviso(p.pedidoId);
        if (pedido) cuerpo = p.tipo === 'pedido_nuevo' ? textoDelAviso(pedido, { conRenglones: true }) : p.tipo === 'pedido_cancelado' ? textoDeCancelado(pedido) : textoDePagado(pedido);
      }
    } catch (e) {
      this.log.warn(`no pude armar el detalle del escalamiento de ${p.codigo}: ${e instanceof Error ? e.message : e}`);
    }
    const texto = `ATENCIÓN: ${titulo}.\n${detalle}${cuerpo ? `\n\n${cuerpo}` : ''}`;
    const telefonos = (process.env.AVISOS_ESCALAR_A
      ? process.env.AVISOS_ESCALAR_A.split(',')
      : ((duenos ?? []) as any[]).map((u) => String(u.telefono ?? '')))
      .map((t) => celularWhatsapp(t)).filter((t) => t.length >= 10 && t !== admin);
    let salio = false;
    for (const t of [...new Set(telefonos)]) {
      const r = await enviarTextoWhatsapp(this.db, t, texto, 'aviso-pedido-escalado');
      if (r.enviado && r.id) salio = true;
      else this.log.error(`tampoco salió el aviso a ${t}: ${r.motivo}`);
    }
    return salio ? 'escalado' : 'fallo';
  }
}

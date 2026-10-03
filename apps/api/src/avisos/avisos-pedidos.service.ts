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
  /** El estado de la sesión de WhatsApp en la última vuelta ('WORKING', 'FAILED'…; null si no se pudo saber). */
  estadoWhatsapp: string | null = null;

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
      this.estadoWhatsapp = await this.sesionWhatsapp();
      // con la sesión caída no se toma nada: lo ve el vigía y lo escala
      if (this.estadoWhatsapp !== null && this.estadoWhatsapp !== 'WORKING') return;
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
  private async sinCargar(detalle: any): Promise<SinCargar> {
    const telefono = String(detalle?.telefono ?? '');
    const { data: cot } = telefono
      ? await this.db.from('bot_cotizaciones').select('resumen, creada_en').eq('telefono', telefono).is('pedido_id', null)
          .gte('creada_en', new Date(Date.now() - 6 * 3600_000).toISOString()).order('creada_en', { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    return { telefono, telefonoReal: await this.telefonoReal(telefono), nota: String(detalle?.nota ?? ''), resumen: (cot as any)?.resumen ?? null };
  }

  private async enviar(a: FilaAviso) {
    const destino = await this.telefonoAdministracion();
    if (!destino) return this.fallo(a, 'no hay teléfono de administración cargado (lineas_whatsapp.derivar_pagos_a)', false);
    const chatId = `${destino}@c.us`;

    // qué se manda
    let cabeza: string;
    let tarjeta: { pedido: PedidoParaAviso; epigrafe: string } | null = null;
    let texto: string;
    if (a.tipo === 'pedido_sin_cargar') {
      const s = await this.sinCargar(a.detalle);
      texto = textoDeSinCargar(s);
      cabeza = texto.split('\n')[0];
    } else {
      const pedido = a.pedido_id ? await this.pedidoParaAviso(a.pedido_id) : null;
      if (!pedido) return this.fallo(a, 'no encontré el pedido', false);
      cabeza = encabezado(a.tipo, codigoDe(pedido));
      if (a.tipo === 'pedido_nuevo') {
        if (pedido.estado === 'cancelado') return this.omitir(a, 'el pedido se canceló antes de avisar');
        if (pedido.esDelBot && esTelefonoDePrueba(pedido.telefonoDelBot)) return this.omitir(a, 'pedido de prueba del simulador del panel');
        texto = textoDelAviso(pedido, { conRenglones: true });
        if (pedido.items.length) tarjeta = { pedido, epigrafe: textoDelAviso(pedido, { conRenglones: false }) };
      } else {
        texto = a.tipo === 'pedido_cancelado' ? textoDeCancelado(pedido) : textoDePagado(pedido);
      }
    }

    // Un reintento (o un intento anterior que no sabemos si salió): antes de
    // repetir, se busca en el chat el encabezado exacto de este aviso.
    if (a.intentos > 1 || a.incierto) {
      const ya = await this.buscarEnElChat(chatId, cabeza);
      if (ya) return this.enviado(a, destino, [ya], 'ya había salido (se encontró en el chat)');
    }

    // 1) la tarjeta Placa roja (regla: todo detalle de productos va en la
    //    tarjeta), con el texto como epígrafe de la PRIMERA página
    const ids: string[] = [];
    let completo = false;
    let ultimo: Envio | null = null;
    if (tarjeta) {
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
        if (ya) return this.enviado(a, destino, [ya], 'la tarjeta salió aunque WhatsApp no contestó');
      }
      ultimo = await enviarTextoWhatsapp(this.db, destino, texto, 'aviso-pedido');
      if (ultimo.enviado && ultimo.id) ids.push(String(ultimo.id));
      else return this.fallo(a, ultimo.motivo ?? 'WhatsApp no devolvió el id del mensaje', ultimo.incierto ?? !ultimo.enviado);
    }
    await this.enviado(a, destino, ids);
    // si mientras tanto el pedido se canceló o se pagó, la base encola la baja o el pago
    if (a.tipo === 'pedido_nuevo') await this.db.rpc('encolar_avisos_faltantes').then(() => null, () => null);
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

  private async enviado(a: FilaAviso, destino: string, ids: string[], nota?: string) {
    await this.actualizar(a.id, {
      estado: 'enviado', destino, waha_id: ids[0], waha_ids: ids, enviado_en: new Date().toISOString(), tomado_hasta: null,
      incierto: false, ultimo_error: null, proximo_intento: new Date(Date.now() + 20_000).toISOString(),
    });
    this.log.log(`aviso ${a.tipo} ${a.pedido_id ?? ''} enviado a administración (${destino})${nota ? `: ${nota}` : ''}`);
  }

  private async omitir(a: FilaAviso, motivo: string) {
    await this.actualizar(a.id, { estado: 'omitido', motivo, tomado_hasta: null });
    this.log.log(`aviso ${a.tipo} ${a.pedido_id ?? ''} omitido: ${motivo}`);
  }

  private async fallo(a: FilaAviso, motivo: string, incierto: boolean) {
    const espera = esperaParaReintentar(a.intentos);
    this.log.error(`aviso ${a.tipo} ${a.pedido_id ?? ''} NO salió (intento ${a.intentos}): ${motivo}. Reintento en ${Math.round(espera / 1000)} s`);
    await this.actualizar(a.id, {
      ultimo_error: motivo.slice(0, 500), incierto, tomado_hasta: null,
      proximo_intento: new Date(Date.now() + espera).toISOString(),
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

  /** ¿Ya hay en el chat de administración un mensaje nuestro que empieza con este encabezado? Devuelve su id. */
  private async buscarEnElChat(chatId: string, cabeza: string): Promise<string | null> {
    const msjs = await this.getWaha(`/api/{sesion}/chats/${encodeURIComponent(chatId)}/messages?limit=50&downloadMedia=false`);
    const hallado = (Array.isArray(msjs) ? msjs : []).find((m: any) => m?.fromMe && String(m?.body ?? m?.caption ?? '').trim().startsWith(cabeza));
    return hallado ? String(hallado.id?._serialized ?? hallado.id ?? '') || null : null;
  }

  /** Pregunta a WhatsApp si los avisos enviados llegaron al teléfono (ack 2 o más). */
  private async verificarEntregas() {
    const { data } = await this.db.from('avisos_pedidos').select('id, pedido_id, destino, waha_id, enviado_en')
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
        // WhatsApp dice que no lo pudo entregar: se vuelve a mandar (y los 3
        // minutos sin salir se cuentan desde ahora)
        const ahora = new Date().toISOString();
        await this.actualizar(a.id, { estado: 'pendiente', ack, incierto: false, ultimo_error: 'WhatsApp marcó error de entrega (ack -1): se reenvía', proximo_intento: ahora, pendiente_desde: ahora });
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
      const r = await this.escalar(p, intentos === 0).catch((e) => {
        this.log.error(`no pude escalar el aviso de ${p.codigo}: ${e instanceof Error ? e.message : e}`);
        return 'fallo' as const;
      });
      await this.actualizar(p.avisoId, r === 'escalado'
        ? { [columna]: new Date().toISOString(), escalar_proximo: null }
        : r === 'resuelto'
          ? { escalar_proximo: null }
          : { escalar_intentos: intentos + 1, escalar_proximo: new Date(Date.now() + esperaParaEscalar(intentos)).toISOString() });
    }
  }

  /** 'escalado' si a algún dueño le salió el WhatsApp; 'resuelto' si el aviso salió (o llegó) mientras tanto. La campanita, una sola vez por problema. */
  private async escalar(p: ProblemaDeAviso, primeraVez: boolean): Promise<'escalado' | 'fallo' | 'resuelto'> {
    // justo antes de avisar a los dueños, se vuelve a mirar: si mientras tanto
    // salió (o llegó), no hay nada que escalar
    const { data: ahora } = await this.db.from('avisos_pedidos').select('estado').eq('id', p.avisoId).maybeSingle();
    const sigue = p.problema === 'no_salio' ? (ahora as any)?.estado === 'pendiente' : (ahora as any)?.estado === 'enviado';
    if (!sigue) {
      this.log.log(`el aviso de ${p.codigo} se resolvió solo (${(ahora as any)?.estado ?? 'sin datos'}): no se escala`);
      return 'resuelto';
    }
    const admin = await this.telefonoAdministracion();
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
    let cuerpo = '';
    if (p.tipo === 'pedido_sin_cargar') {
      const { data: fila } = await this.db.from('avisos_pedidos').select('detalle').eq('id', p.avisoId).maybeSingle();
      cuerpo = textoDeSinCargar(await this.sinCargar((fila as any)?.detalle));
    } else if (p.pedidoId) {
      const pedido = await this.pedidoParaAviso(p.pedidoId);
      if (pedido) cuerpo = p.tipo === 'pedido_nuevo' ? textoDelAviso(pedido, { conRenglones: true }) : p.tipo === 'pedido_cancelado' ? textoDeCancelado(pedido) : textoDePagado(pedido);
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

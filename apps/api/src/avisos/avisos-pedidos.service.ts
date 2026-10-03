import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { celularWhatsapp, enviarImagenWhatsapp, enviarTextoWhatsapp } from '../comun/whatsapp';
import { cartelesPedido, fechaLegible, nombreParaCartel } from '../comun/cartel-pedido';
import {
  esperaParaReintentar, idLargoDeMensaje, LLEGO, MINUTOS_SIN_LLEGAR, MINUTOS_SIN_SALIR,
  type PedidoParaAviso, telefonoLegible, textoDelAviso,
} from './aviso-pedido';

// TODA CONFIRMACIÓN DE PEDIDO SALE AL TELÉFONO DE ADMINISTRACIÓN (regla de
// Leandro, 3/10/2026). El 3/10 el bot confirmó PICKUP-5F2451C6C111 y no se le
// avisó a nadie del local: el aviso no existía. Esta es la excepción explícita a
// la regla del 1/9 ("el WhatsApp interno es solo para pagos"): un pedido nuevo
// SIEMPRE sale por WhatsApp a administración. No apagar "por coherencia".
//
// La base deja un aviso pendiente por cada pedido (trigger en pedidos, ver
// db/migracion-aviso-pedidos.sql). Acá, cada 15 segundos:
// 1. se encolan los pedidos que hubieran quedado sin aviso (red de seguridad);
// 2. se mandan los pendientes: la tarjeta Placa roja del pedido con el epígrafe
//    y, si la tarjeta no sale, el texto con los productos. Solo cuenta como
//    enviado si WhatsApp devolvió el id del mensaje;
// 3. se pregunta a WhatsApp si el mensaje LLEGÓ al teléfono (ack);
// 4. si no salió en 3 minutos o no llegó en 15, se avisa a los dueños por
//    WhatsApp y en la campanita, y el panel muestra el cartel rojo.
// Nada de esto puede quedar en silencio: cada falla queda en avisos_pedidos.

type FilaAviso = {
  pedido_id: string;
  creado_en: string;
  estado: string;
  intentos: number;
  incierto: boolean;
  destino: string | null;
  waha_id: string | null;
  enviado_en: string | null;
  ultimo_error: string | null;
  escalado_en: string | null;
  escalado_entrega_en: string | null;
};

export type ProblemaDeAviso = { pedidoId: string; codigo: string; problema: 'no_salio' | 'no_llego'; minutos: number; motivo: string | null };

@Injectable()
export class AvisosPedidosService {
  private readonly log = new Logger(AvisosPedidosService.name);
  private corriendo = false;

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Cron('*/15 * * * * *')
  async vuelta() {
    // ODB_AVISOS_PEDIDOS=0 solo para correr el API en una máquina de desarrollo
    // contra la base real. En producción NUNCA se apaga.
    if (this.corriendo || process.env.ODB_AVISOS_PEDIDOS === '0') return;
    this.corriendo = true;
    try {
      const { data: faltantes, error: e1 } = await this.db.rpc('encolar_avisos_faltantes');
      if (e1) this.log.error(`no pude revisar pedidos sin aviso: ${e1.message}`);
      else if (Number(faltantes) > 0) this.log.error(`${faltantes} pedido(s) no tenían aviso (¿falló el trigger?): encolados ahora`);
      const { data: tomados, error: e2 } = await this.db.rpc('tomar_avisos_pedidos', { p_limite: 5 });
      if (e2) this.log.error(`no pude tomar avisos de pedidos: ${e2.message}`);
      for (const a of (tomados ?? []) as FilaAviso[]) {
        await this.enviar(a).catch((e) => this.fallo(a, `error inesperado: ${e instanceof Error ? e.message : e}`, true));
      }
      await this.verificarEntregas();
      await this.vigilar();
    } catch (e) {
      this.log.error(`vuelta de avisos de pedidos: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.corriendo = false;
    }
  }

  /** El teléfono de administración: lineas_whatsapp.derivar_pagos_a de la línea de pedidos. */
  async telefonoAdministracion(): Promise<string | null> {
    const { data } = await this.db.from('lineas_whatsapp').select('derivar_pagos_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
    const n = celularWhatsapp(String((data as any)?.derivar_pagos_a ?? ''));
    return n.length >= 10 ? n : null;
  }

  async pedidoParaAviso(pedidoId: string): Promise<PedidoParaAviso | null> {
    const { data: p, error } = await this.db.from('pedidos')
      .select('id, qr_retiro, canal, estado, total, creado_en, notas, destino_direccion, entrega_fecha, entrega_franja, pagado_en, cliente_id, pedidos_items(cantidad, precio_unitario, productos(nombre))')
      .eq('id', pedidoId).maybeSingle();
    if (error || !p) return null;
    const [cli, bot] = await Promise.all([
      (p as any).cliente_id ? this.db.from('clientes').select('nombre, telefono').eq('id', (p as any).cliente_id).maybeSingle() : Promise.resolve({ data: null } as any),
      this.db.from('bot_cotizaciones').select('id').eq('pedido_id', pedidoId).limit(1).maybeSingle(),
    ]);
    const cliente = (cli as any)?.data ?? null;
    let telefonoReal: string | null = null;
    const telCliente = String(cliente?.telefono ?? '').replace(/\D/g, '');
    if (telCliente) {
      const { data: c } = await this.db.from('bot_contactos').select('telefono_real').eq('telefono', telCliente).maybeSingle();
      telefonoReal = (c as any)?.telefono_real ? String((c as any).telefono_real) : null;
    }
    return {
      id: (p as any).id, qr_retiro: (p as any).qr_retiro, canal: String((p as any).canal), estado: String((p as any).estado),
      total: Number((p as any).total), creado_en: (p as any).creado_en, notas: (p as any).notas,
      destino_direccion: (p as any).destino_direccion, entrega_fecha: (p as any).entrega_fecha, entrega_franja: (p as any).entrega_franja,
      pagado_en: (p as any).pagado_en, cliente, telefonoReal, esDelBot: !!(bot as any)?.data,
      items: (((p as any).pedidos_items ?? []) as any[]).map((i) => ({ nombre: String(i.productos?.nombre ?? 'Producto'), cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario) })),
    };
  }

  private async enviar(a: FilaAviso) {
    const pedido = await this.pedidoParaAviso(a.pedido_id);
    if (!pedido) return this.fallo(a, 'no encontré el pedido', false);
    const codigo = pedido.qr_retiro || pedido.id.slice(0, 8).toUpperCase();
    const destino = await this.telefonoAdministracion();
    if (!destino) return this.fallo(a, 'no hay teléfono de administración cargado (lineas_whatsapp.derivar_pagos_a)', false);
    const chatId = `${destino}@c.us`;

    // Un intento anterior que no sabemos si salió (se cortó la espera, WhatsApp
    // contestó con error del servidor): antes de repetir, se mira en el chat.
    if (a.incierto) {
      const ya = await this.buscarEnElChat(chatId, codigo);
      if (ya) return this.enviado(a, destino, ya, 'ya había salido (se encontró en el chat)');
    }

    // 1) la tarjeta Placa roja con el epígrafe (regla: todo detalle de productos va en la tarjeta)
    let r: { enviado: boolean; id?: string | null; motivo?: string; incierto?: boolean } | null = null;
    try {
      const urls = pedido.items.length ? await this.tarjeta(pedido, codigo) : null;
      if (urls?.length) {
        for (let i = 0; i < urls.length; i++) {
          const ultima = i === urls.length - 1;
          r = await enviarImagenWhatsapp(this.db, destino, urls[i], ultima ? textoDelAviso(pedido, { conRenglones: false }) : '', 'aviso-pedido');
          if (!r.enviado) break;
        }
      }
    } catch (e) {
      this.log.warn(`la tarjeta del aviso de ${codigo} no salió (${e instanceof Error ? e.message : e}); va el texto`);
      r = null;
    }
    // 2) si la tarjeta no salió entera, el texto con los productos
    if (!r?.enviado || !r.id) {
      if (r?.incierto) {
        const ya = await this.buscarEnElChat(chatId, codigo);
        if (ya) return this.enviado(a, destino, ya, 'la tarjeta salió aunque WhatsApp no contestó');
      }
      r = await enviarTextoWhatsapp(this.db, destino, textoDelAviso(pedido, { conRenglones: true }), 'aviso-pedido');
    }
    if (r.enviado && r.id) return this.enviado(a, destino, String(r.id));
    return this.fallo(a, r.motivo ?? 'WhatsApp no devolvió el id del mensaje', r.incierto ?? !r.enviado);
  }

  /** La tarjeta del pedido, subida al storage público (WAHA la baja de ahí). null si no se pudo. */
  private async tarjeta(p: PedidoParaAviso, codigo: string): Promise<string[] | null> {
    const domicilio = p.canal === 'domicilio';
    const cuando = [fechaLegible(p.entrega_fecha), p.entrega_franja].filter(Boolean).join(', ');
    const renglones = p.items.filter((i) => i.cantidad > 0).map((i) => ({
      nombre: nombreParaCartel(i.nombre), cantidad: i.cantidad, unitario: i.precio_unitario, subtotal: Math.round(i.cantidad * i.precio_unitario),
    }));
    const pngs = await cartelesPedido({
      renglones,
      total: Math.round(p.total),
      entrega: domicilio
        ? { titulo: 'Envío', detalle: [p.destino_direccion, cuando].filter(Boolean).join(' · ') || 'Dirección sin cargar' }
        : { titulo: 'Retiro en la sucursal Saint Thomas', detalle: cuando || 'Sin día pedido' },
      confirmar: false,
      pie: '',
      titulo: 'PEDIDO NUEVO',
      subtitulo: codigo,
      nota: [p.cliente?.nombre, telefonoLegible(p.telefonoReal)].filter(Boolean).join(' · ') || undefined,
    } as any);
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

  private async enviado(a: FilaAviso, destino: string, wahaId: string, nota?: string) {
    await this.db.from('avisos_pedidos').update({
      estado: 'enviado', destino, waha_id: wahaId, enviado_en: new Date().toISOString(), tomado_hasta: null,
      incierto: false, ultimo_error: null, proximo_intento: new Date(Date.now() + 20_000).toISOString(),
    }).eq('pedido_id', a.pedido_id);
    this.log.log(`aviso del pedido ${a.pedido_id} enviado a administración (${destino})${nota ? `: ${nota}` : ''}`);
  }

  private async fallo(a: FilaAviso, motivo: string, incierto: boolean) {
    const espera = esperaParaReintentar(a.intentos);
    this.log.error(`aviso del pedido ${a.pedido_id} NO salió (intento ${a.intentos}): ${motivo}. Reintento en ${Math.round(espera / 1000)} s`);
    await this.db.from('avisos_pedidos').update({
      ultimo_error: motivo.slice(0, 500), incierto, tomado_hasta: null,
      proximo_intento: new Date(Date.now() + espera).toISOString(),
    }).eq('pedido_id', a.pedido_id);
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
      const r = await fetch(`${w.base}/api/${encodeURIComponent(w.sesion)}${ruta}`, { headers: { 'X-Api-Key': w.key }, signal: ctrl.signal });
      return r.ok ? await r.json().catch(() => null) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  /** ¿Ya hay en el chat de administración un mensaje nuestro con este código? Devuelve su id. */
  private async buscarEnElChat(chatId: string, codigo: string): Promise<string | null> {
    const msjs = await this.getWaha(`/chats/${encodeURIComponent(chatId)}/messages?limit=40&downloadMedia=false`);
    const hallado = (Array.isArray(msjs) ? msjs : []).find((m: any) => m?.fromMe && String(m?.body ?? m?.caption ?? '').includes(codigo));
    return hallado ? String(hallado.id?._serialized ?? hallado.id ?? '') || null : null;
  }

  /** Pregunta a WhatsApp si los avisos enviados llegaron al teléfono (ack 2 o más). */
  private async verificarEntregas() {
    const { data } = await this.db.from('avisos_pedidos').select('pedido_id, destino, waha_id, enviado_en')
      .eq('estado', 'enviado').lte('proximo_intento', new Date().toISOString())
      .gte('enviado_en', new Date(Date.now() - 48 * 3600_000).toISOString()).limit(5);
    for (const a of (data ?? []) as any[]) {
      if (!a.waha_id || !a.destino) continue;
      const chatId = `${a.destino}@c.us`;
      const m = await this.getWaha(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(idLargoDeMensaje(chatId, a.waha_id))}`);
      const ack = m && typeof m.ack === 'number' ? m.ack : null;
      if (ack !== null && LLEGO(ack)) {
        await this.db.from('avisos_pedidos').update({ estado: 'entregado', ack, entregado_en: new Date().toISOString() }).eq('pedido_id', a.pedido_id);
        this.log.log(`aviso del pedido ${a.pedido_id} ENTREGADO en el teléfono de administración (ack ${ack})`);
      } else if (ack === -1) {
        // WhatsApp dice que no lo pudo entregar: se vuelve a mandar
        await this.db.from('avisos_pedidos').update({ estado: 'pendiente', ack, incierto: false, ultimo_error: 'WhatsApp marcó error de entrega (ack -1): se reenvía', proximo_intento: new Date().toISOString() }).eq('pedido_id', a.pedido_id);
        this.log.error(`aviso del pedido ${a.pedido_id}: WhatsApp marcó error de entrega; se reenvía`);
      } else {
        await this.db.from('avisos_pedidos').update({ ack, proximo_intento: new Date(Date.now() + 60_000).toISOString() }).eq('pedido_id', a.pedido_id);
      }
    }
  }

  /** Lo que está mal ahora: avisos que no salieron en 3 minutos o no llegaron en 15. */
  async problemas(): Promise<ProblemaDeAviso[]> {
    const desde = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data } = await this.db.from('avisos_pedidos')
      .select('pedido_id, creado_en, estado, enviado_en, ultimo_error, ack, pedidos(qr_retiro, estado)')
      .in('estado', ['pendiente', 'enviado']).gte('creado_en', desde);
    const ahora = Date.now();
    const salida: ProblemaDeAviso[] = [];
    for (const a of (data ?? []) as any[]) {
      if (['cancelado', 'entregado'].includes(String(a.pedidos?.estado ?? ''))) continue;
      const codigo = String(a.pedidos?.qr_retiro ?? a.pedido_id.slice(0, 8));
      if (a.estado === 'pendiente') {
        const min = Math.floor((ahora - new Date(a.creado_en).getTime()) / 60_000);
        if (min >= MINUTOS_SIN_SALIR) salida.push({ pedidoId: a.pedido_id, codigo, problema: 'no_salio', minutos: min, motivo: a.ultimo_error ?? null });
      } else if (a.enviado_en) {
        const min = Math.floor((ahora - new Date(a.enviado_en).getTime()) / 60_000);
        if (min >= MINUTOS_SIN_LLEGAR) salida.push({ pedidoId: a.pedido_id, codigo, problema: 'no_llego', minutos: min, motivo: a.ack === null ? 'WhatsApp todavía no confirma que llegó' : `el mensaje quedó con un solo tilde (ack ${a.ack}): el teléfono de administración puede estar apagado o sin conexión` });
      }
    }
    return salida;
  }

  /** Si un aviso no salió o no llegó, los dueños se enteran: WhatsApp y campanita, una vez por problema. */
  private async vigilar() {
    for (const p of await this.problemas()) {
      const columna = p.problema === 'no_salio' ? 'escalado_en' : 'escalado_entrega_en';
      // se marca ANTES de avisar y solo si nadie lo marcó (dos procesos durante un deploy)
      const { data: marcada } = await this.db.from('avisos_pedidos').update({ [columna]: new Date().toISOString() })
        .eq('pedido_id', p.pedidoId).is(columna, null).select('pedido_id');
      if (!marcada?.length) continue;
      await this.escalar(p).catch((e) => this.log.error(`no pude escalar el aviso de ${p.codigo}: ${e instanceof Error ? e.message : e}`));
    }
  }

  private async escalar(p: ProblemaDeAviso) {
    const admin = await this.telefonoAdministracion();
    const titulo = p.problema === 'no_salio'
      ? `El aviso del pedido ${p.codigo} NO SALIÓ a administración`
      : `El aviso del pedido ${p.codigo} no le LLEGÓ a administración`;
    const detalle = `${p.problema === 'no_salio' ? `Hace ${p.minutos} min que no sale` : `Salió hace ${p.minutos} min y WhatsApp no confirma que llegó`}${admin ? ` al ${telefonoLegible(admin)}` : ''}. ${p.motivo ?? ''} Avisen al local por otro medio: el pedido está para preparar.`.trim();
    this.log.error(`${titulo}. ${detalle}`);
    const { data: duenos } = await this.db.from('usuarios').select('id, nombre, telefono').eq('rol', 'dueno').eq('activo', true);
    for (const u of (duenos ?? []) as any[]) {
      await this.db.from('alertas_internas').insert({ para_usuario: u.id, tipo: 'pedido_sin_aviso', titulo, detalle, referencia: { pedido_id: p.pedidoId, link: '/pedidos' } }).then(() => null, () => null);
    }
    const pedido = await this.pedidoParaAviso(p.pedidoId);
    const texto = `ATENCIÓN: ${titulo}.\n${detalle}\n\n${pedido ? textoDelAviso(pedido, { conRenglones: true }) : ''}`.trim();
    const telefonos = (process.env.AVISOS_ESCALAR_A
      ? process.env.AVISOS_ESCALAR_A.split(',')
      : ((duenos ?? []) as any[]).map((u) => String(u.telefono ?? '')))
      .map((t) => celularWhatsapp(t)).filter((t) => t.length >= 10 && t !== admin);
    for (const t of [...new Set(telefonos)]) {
      const r = await enviarTextoWhatsapp(this.db, t, texto, 'aviso-pedido-escalado');
      if (!r.enviado) this.log.error(`tampoco salió el aviso de escalamiento a ${t}: ${r.motivo}`);
    }
  }
}

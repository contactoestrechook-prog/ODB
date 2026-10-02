import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { ordenDeCompraPDF } from '../comun/documentos';
import { enviarArchivoWhatsapp, enviarImagenWhatsapp, enviarTextoWhatsapp, existeEnWhatsapp } from '../comun/whatsapp';
import { cartelNotaDePedido } from '../comun/cartel-pedido';

// ============================================================
// EL PEDIDO LE LLEGA AL PROVEEDOR (2/10/2026).
//
// Pedido de Leandro: "se envía el pedido, genera una orden de pedido con
// número, se envía un WhatsApp automático al mismo pidiéndolo". Hasta hoy la
// orden firmada quedaba en 'aprobada' y nadie se la mandaba al proveedor:
// ningún código la pasaba a 'enviada'.
//
// Cuando el dueño firma, sale sola por la línea de la casa: un mensaje con el
// pedido renglón por renglón y la nota de pedido en PDF (con folio y sin
// precios). La orden pasa a 'enviada' y queda guardado a qué número salió. Si
// no sale (WAHA caído, teléfono mal cargado), la orden queda 'aprobada' con el
// motivo, un cron lo reintenta y se puede reenviar a mano.
// ============================================================

export type ResultadoEnvio = {
  enviado: boolean;
  estado: 'enviado' | 'error' | 'ya_enviada' | 'no_corresponde' | 'apagado';
  mensaje: string;
  telefono?: string;
  folio?: string;
};

// Cuántas órdenes pueden salir por día. Es un primer contacto, con adjunto, a
// números que quizás nunca le escribieron a la línea: una ráfaga puede hacer que
// WhatsApp cierre la sesión y con ella se cae también el bot de clientes
// (pasó el 2/9 con ~105 mensajes con imagen).
const TOPE_DIARIO = Number(process.env.ODB_OC_WHATSAPP_TOPE ?? 20);

// Con ODB_OC_WHATSAPP=0 no sale nada solo (la orden queda 'aprobada' y se puede
// mandar a mano): la llave para apagarlo sin deploy.
export const envioAutomaticoActivo = (env: Record<string, string | undefined> = process.env) =>
  !/^(0|no|false|apagado)$/i.test(String(env.ODB_OC_WHATSAPP ?? '').trim());

const fechaCorta = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00-03:00` : d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }) : null;

export type RenglonPedido = { nombre: string; cantidad: number; codigoProveedor?: string | null };

// Las observaciones de la orden viajan al proveedor. Las marcas internas que
// quedaron en órdenes armadas antes del 2/10/2026 ("Armada desde Qué comprar")
// no son para él: en la prueba le llegaron como "Nota: …".
export function observacionParaProveedor(obs?: string | null): string | null {
  const t = String(obs ?? '').trim();
  if (!t || /^armada (desde qu[eé] comprar|con el agente de abastecimiento)\.?$/i.test(t)) return null;
  return t;
}

// El epígrafe de la tarjeta: el saludo y qué se le pide. Los productos van en
// la tarjeta (la misma gráfica Placa roja de los pedidos, pedido de Leandro del
// 2/10/2026) y el detalle completo en el PDF.
export function epigrafePedido(p: { folio: string; sucursal: string; direccion?: string | null; fechaEntrega?: string | null; observaciones?: string | null }): string {
  const destino = `${p.sucursal}${p.direccion ? ` (${p.direccion})` : ''}`;
  const cuando = fechaCorta(p.fechaEntrega);
  return [
    `Hola, ¿cómo están? Les escribimos de *O.D.B Premium Market* (Canning).`,
    ``,
    `Les pasamos el pedido *${p.folio}* para entregar en *${destino}*${cuando ? `, el ${cuando}` : ''}. Abajo va la nota de pedido en PDF.`,
    ...(p.observaciones?.trim() ? [``, `Nota: ${p.observaciones.trim()}`] : []),
    ``,
    `¿Nos confirman si pueden entregar todo? Si falta algo, avísennos qué, así lo sabemos antes. ¡Gracias!`,
  ].join('\n');
}

// El pedido en texto: lo que sale si la tarjeta no se pudo armar, y lo que se
// copia para mandarlo a mano desde un teléfono.
export function textoPedido(p: {
  folio: string;
  proveedor: string;
  sucursal: string;
  direccion?: string | null;
  fechaEntrega?: string | null;
  observaciones?: string | null;
  items: RenglonPedido[];
  // sin PDF (mandado a mano desde un teléfono) va la lista entera
  conPdf?: boolean;
}): string {
  const conPdf = p.conPdf !== false;
  const MAX = conPdf ? 25 : Infinity;
  const renglones = p.items.slice(0, MAX).map((i) => {
    const cant = Number(i.cantidad).toLocaleString('es-AR');
    return `• ${cant} × ${i.nombre}${i.codigoProveedor ? ` (cód. ${i.codigoProveedor})` : ''}`;
  });
  if (p.items.length > MAX) renglones.push(`• …y ${p.items.length - MAX} producto${p.items.length - MAX === 1 ? '' : 's'} más (están todos en el PDF)`);
  const destino = `${p.sucursal}${p.direccion ? ` (${p.direccion})` : ''}`;
  const cuando = fechaCorta(p.fechaEntrega);
  return [
    `Hola, ¿cómo están? Les escribimos de *O.D.B Premium Market* (Canning).`,
    ``,
    `Les hacemos el pedido *${p.folio}* para entregar en *${destino}*${cuando ? `, el ${cuando}` : ''}:`,
    ``,
    ...renglones,
    ...(p.observaciones?.trim() ? [``, `Nota: ${p.observaciones.trim()}`] : []),
    ``,
    `${conPdf ? 'Les adjuntamos la nota de pedido en PDF. ' : ''}¿Nos confirman si pueden entregar todo? Si falta algo, avísennos qué, así lo sabemos antes.`,
    ``,
    `¡Gracias!`,
  ].join('\n');
}

// "+54 9 11 3319-5593" (celular) o "+54 11 4302-5555" (WhatsApp de un fijo)
export function telefonoLegible(numero: string): string {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (/^549\d{10}$/.test(d)) return `+54 9 ${d.slice(3, 5)} ${d.slice(5, 9)}-${d.slice(9)}`;
  if (/^54\d{10}$/.test(d)) return `+54 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : '';
}

@Injectable()
export class PedidosProveedorService {
  private readonly log = new Logger(PedidosProveedorService.name);

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private async orden(id: string) {
    const { data, error } = await this.db
      .from('ordenes_compra')
      .select(
        `id, numero, estado, total, creado_en, fecha_entrega, condicion_pago, observaciones, creada_por, aprobada_por,
         whatsapp_estado, whatsapp_telefono, proveedor_id,
         proveedor:proveedores(razon_social, cuit, telefono, email, condicion_pago),
         sucursal:sucursales(nombre, direccion),
         items:ordenes_compra_items(producto_id, cantidad, costo_unitario, producto:productos(sku, nombre))`,
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('No existe la orden de compra');
    return data as any;
  }

  private async nombres(ids: (string | null | undefined)[]) {
    const unicos = [...new Set(ids.filter(Boolean))] as string[];
    if (!unicos.length) return new Map<string, string>();
    const { data } = await this.db.from('usuarios').select('id, nombre').in('id', unicos);
    return new Map(((data ?? []) as any[]).map((u) => [u.id, u.nombre]));
  }

  // El aviso lleva a la nota de pedido sin precios: es lo que se manda a mano
  private async avisar(para: string | null | undefined, tipo: string, titulo: string, detalle: string, ocId: string) {
    if (!para) return;
    await this.db.from('alertas_internas').insert({
      para_usuario: para, tipo, titulo, detalle, referencia: { link: `/api/documento?tipo=nota&id=${ocId}`, oc_id: ocId },
    }).then(() => null, () => null);
  }

  // No salió. `final`: no se reintenta solo (un envío dudoso, o el pedido de
  // mandarlo a mano); si no, el cron prueba hasta 3 veces.
  private async fallar(oc: any, motivo: string, final = false): Promise<ResultadoEnvio> {
    const cambios: Record<string, unknown> = { whatsapp_estado: 'error', whatsapp_error: motivo.slice(0, 500) };
    if (final) cambios.whatsapp_intentos = 3;
    const { data: fila } = await this.db.from('ordenes_compra').update(cambios).eq('id', oc.id).select('whatsapp_intentos').maybeSingle();
    this.log.warn(`OC #${oc.numero}: el pedido no salió por WhatsApp: ${motivo}`);
    // un aviso al primer intento y otro cuando ya no se reintenta; no uno por vuelta
    const intentos = Number((fila as any)?.whatsapp_intentos ?? 1);
    if (final || intentos === 1 || intentos === 3) {
      await this.avisar(oc.creada_por, 'oc_no_salio', `El pedido a ${oc.proveedor?.razon_social ?? 'el proveedor'} no salió`,
        `OC #${oc.numero}: ${motivo}.${final || intentos >= 3 ? ' No se reintenta solo.' : ' Se reintenta solo en 10 minutos.'} Tocá acá para bajar la nota de pedido y mandarla a mano.`, oc.id);
    }
    return { enviado: false, estado: 'error', mensaje: `El pedido no salió por WhatsApp: ${motivo}.` };
  }

  private async fallarPorId(id: string, motivo: string): Promise<ResultadoEnvio> {
    const { data } = await this.db.from('ordenes_compra').select('id, numero, creada_por, proveedor:proveedores(razon_social)').eq('id', id).maybeSingle();
    return this.fallar(data ?? { id, numero: '?' }, motivo);
  }

  // Lo que se le manda al proveedor, armado (para enviarlo o para mandarlo a mano)
  async armar(id: string) {
    const oc = await this.orden(id);
    const items = (oc.items ?? []) as any[];
    const { data: codigos } = items.length
      ? await this.db.from('proveedor_productos').select('producto_id, codigo_proveedor')
          .eq('proveedor_id', oc.proveedor_id).in('producto_id', items.map((i) => i.producto_id))
      : { data: [] as any[] };
    const codigo = new Map(((codigos ?? []) as any[]).map((c) => [c.producto_id, c.codigo_proveedor]));
    const renglones: RenglonPedido[] = items
      .map((i) => ({ nombre: i.producto?.nombre ?? '—', cantidad: Number(i.cantidad), codigoProveedor: codigo.get(i.producto_id) ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const sucursal = String(oc.sucursal?.nombre ?? '').replace(/^Suc\s+/, '').replace(/^Sant Thomas/, 'Saint Thomas').replace(/^Santa Ines$/, 'Santa Inés');
    return { oc, renglones, sucursal };
  }

  // La nota de pedido en PDF: con folio (nace o se reusa acá: es el número que
  // recibe el proveedor) y sin precios.
  async notaPDF(id: string, usuarioId: string | null) {
    const { oc, renglones, sucursal } = await this.armar(id);
    const { data: doc, error } = await this.db.rpc('emitir_documento', {
      p_tipo: 'orden_compra', p_entidad: 'ordenes_compra', p_entidad_id: id, p_usuario: usuarioId,
      p_datos: { numero: oc.numero, total: oc.total, proveedor: oc.proveedor?.razon_social ?? null },
    });
    if (error) throw new Error(`no pude emitir el folio: ${error.message}`);
    const folio = String((doc as any).folio);
    const firmas = await this.nombres([oc.creada_por, oc.aprobada_por]);
    const pdf = await ordenDeCompraPDF({
      folio, emitidoEn: (doc as any).emitido_en, numeroInterno: oc.numero, fecha: oc.creado_en,
      proveedor: oc.proveedor ?? null, sucursal: [sucursal, oc.sucursal?.direccion].filter(Boolean).join(' · '),
      condicionPago: oc.condicion_pago ?? oc.proveedor?.condicion_pago ?? null, fechaEntrega: oc.fecha_entrega ?? null,
      observaciones: observacionParaProveedor(oc.observaciones),
      items: renglones.map((r) => ({ nombre: r.nombre, codigoProveedor: r.codigoProveedor, cantidad: r.cantidad, costo_unitario: 0 })),
      total: 0, emitidaPor: firmas.get(oc.creada_por) ?? null, aprobadaPor: firmas.get(oc.aprobada_por) ?? null,
      sinPrecios: true,
    });
    return { folio, pdf };
  }

  // Manda la orden al proveedor. Lo llaman la firma del dueño, el cron y el
  // botón "Reenviar" (forzar). Nunca tira: devuelve qué pasó.
  async enviar(id: string, opts: { usuarioId?: string | null; forzar?: boolean; automatico?: boolean } = {}): Promise<ResultadoEnvio> {
    if (opts.automatico && !envioAutomaticoActivo()) {
      // queda marcada para que el cron no la mande sola cuando se vuelva a prender
      await this.db.from('ordenes_compra')
        .update({ whatsapp_estado: 'error', whatsapp_intentos: 3, whatsapp_error: 'El envío automático estaba apagado al firmar: mandalo a mano o reenvialo.' })
        .eq('id', id).eq('estado', 'aprobada').is('whatsapp_estado', null)
        .then(() => null, () => null);
      return { enviado: false, estado: 'apagado', mensaje: 'El envío automático por WhatsApp está apagado: mandá el pedido a mano.' };
    }
    let tomada = false;
    try {
      const { data, error } = await this.db.rpc('oc_tomar_envio', { p_oc: id, p_forzar: !!opts.forzar });
      if (error) throw new Error(error.message);
      tomada = !!data;
      if (!tomada) {
        const { data: oc } = await this.db.from('ordenes_compra').select('numero, estado, whatsapp_estado, whatsapp_telefono, whatsapp_error').eq('id', id).maybeSingle();
        const o = (oc ?? {}) as any;
        if (o.estado === 'enviada' || o.whatsapp_estado === 'enviado') {
          return { enviado: true, estado: 'ya_enviada', mensaje: `El pedido ya se le mandó al proveedor${o.whatsapp_telefono ? ` (${telefonoLegible(o.whatsapp_telefono)})` : ''}.` };
        }
        if (o.whatsapp_estado === 'enviando') return { enviado: false, estado: 'no_corresponde', mensaje: 'El pedido se está mandando en este momento.' };
        if (o.whatsapp_estado === 'error' && o.estado === 'aprobada') return { enviado: false, estado: 'error', mensaje: `No se reenvía solo: ${o.whatsapp_error ?? 'falló antes'}` };
        return { enviado: false, estado: 'no_corresponde', mensaje: `La orden está ${o.estado ?? 'en otro estado'}: solo se manda una orden aprobada.` };
      }
      return await this.mandar(id, opts.usuarioId ?? null);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      this.log.error(`envío de la OC ${id}: ${motivo}`);
      // antes de mandar nada (folio, PDF, verificación del número): se puede reintentar
      if (tomada) return this.fallarPorId(id, motivo).catch(() => ({ enviado: false, estado: 'error', mensaje: `El pedido no salió por WhatsApp: ${motivo}.` }) as ResultadoEnvio);
      return { enviado: false, estado: 'error', mensaje: `El pedido no salió por WhatsApp: ${motivo}.` };
    }
  }

  private async mandar(id: string, usuarioId: string | null): Promise<ResultadoEnvio> {
    const { oc, renglones, sucursal } = await this.armar(id);
    const proveedor = oc.proveedor?.razon_social ?? 'el proveedor';

    // los datos del proveedor los exige la base para aprobar; se revisa igual
    // ANTES de mandar, para no dejar un mensaje afuera con la orden sin pasar
    const { data: faltan } = await this.db.rpc('proveedor_faltantes', { p_id: oc.proveedor_id });
    if (Array.isArray(faltan) && faltan.length) return this.fallar(oc, `al proveedor le falta cargar ${faltan.join(', ')}`);
    if (!renglones.length) return this.fallar(oc, 'la orden no tiene productos', true);

    // WhatsApp acepta mandar a un número que no existe y no le llega a nadie:
    // antes se pregunta (celular 549… y, si no, el mismo sin el 9: un WhatsApp
    // Business en un fijo). Si WAHA no contesta, tira y se reintenta.
    const ex = await existeEnWhatsapp(oc.proveedor?.telefono ?? '');
    if (!ex.existe) {
      return this.fallar(oc, `el número del proveedor ("${oc.proveedor?.telefono ?? ''}") no tiene WhatsApp (¿es un fijo?): cargá su WhatsApp en la ficha del proveedor`, true);
    }
    const chatId = String(ex.chatId);
    const numero = chatId.replace(/\D/g, '');
    if (!/^54\d{10,11}$/.test(numero)) return this.fallar(oc, `el número del proveedor ("${oc.proveedor?.telefono ?? ''}") no es argentino con código de área`, true);

    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await this.db.from('ordenes_compra').select('id', { count: 'exact', head: true })
      .in('whatsapp_estado', ['enviado', 'enviando']).gte('whatsapp_intento_en', desde).neq('id', id);
    if ((count ?? 0) >= TOPE_DIARIO) {
      return this.fallar(oc, `ya salieron ${count} pedidos en las últimas 24 h (tope ${TOPE_DIARIO}, para cuidar la línea)`);
    }

    const { folio, pdf } = await this.notaPDF(id, usuarioId);

    // WAHA baja el PDF de una URL: va al bucket privado con un enlace firmado
    const ruta = `notas-de-pedido/${folio}.pdf`;
    const { error: eSubir } = await this.db.storage.from('comprobantes').upload(ruta, pdf, { contentType: 'application/pdf', upsert: true });
    if (eSubir) throw new Error(`no pude guardar el PDF: ${eSubir.message}`);
    const { data: firmado, error: eUrl } = await this.db.storage.from('comprobantes').createSignedUrl(ruta, 7 * 86_400);
    if (eUrl || !firmado?.signedUrl) throw new Error(`no pude armar el enlace del PDF: ${eUrl?.message ?? 'sin enlace'}`);

    // la tarjeta Placa roja (sin precios) con el saludo de epígrafe; si no se
    // puede dibujar o subir, el pedido sale igual en texto
    const datos = { folio, sucursal, direccion: oc.sucursal?.direccion ?? null, fechaEntrega: oc.fecha_entrega ?? null };
    let tarjeta: string | null = null;
    try {
      const png = await cartelNotaDePedido({
        ...datos, fechaEntrega: fechaCorta(oc.fecha_entrega),
        renglones: renglones.map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, codigoProveedor: r.codigoProveedor })),
      });
      const rutaPng = `carteles/${new Date().toISOString().slice(0, 7)}/nota-pedido-${folio}-${Date.now().toString(36)}.png`;
      const { error: ePng } = await this.db.storage.from('publico').upload(rutaPng, png, { contentType: 'image/png', upsert: true });
      if (ePng) throw new Error(ePng.message);
      tarjeta = this.db.storage.from('publico').getPublicUrl(rutaPng).data.publicUrl;
    } catch (e) {
      this.log.warn(`OC #${oc.numero}: la tarjeta no se pudo armar, sale en texto: ${e instanceof Error ? e.message : e}`);
    }
    const r1 = tarjeta
      ? await enviarImagenWhatsapp(this.db, chatId, tarjeta, epigrafePedido({ ...datos, observaciones: observacionParaProveedor(oc.observaciones) }), 'pedido_proveedor')
      : await enviarTextoWhatsapp(this.db, chatId, textoPedido({ ...datos, proveedor, observaciones: observacionParaProveedor(oc.observaciones), items: renglones }), 'pedido_proveedor');
    if (!r1.enviado) {
      // un corte por tiempo o un error de WAHA no quiere decir que no salió: no
      // se reintenta solo (el proveedor podría recibir el pedido dos veces)
      return r1.incierto
        ? this.fallar(oc, `WhatsApp no contestó a tiempo (${r1.motivo ?? 'sin detalle'}): puede que le haya llegado. Revisá el chat con el proveedor antes de reenviar`, true)
        : this.fallar(oc, `WhatsApp no lo aceptó (${r1.motivo ?? 'sin detalle'})`);
    }
    // salió: queda anotado ya, por si algo se corta antes de terminar
    await this.db.from('ordenes_compra').update({ whatsapp_msg_id: r1.id ?? 'sin-id', whatsapp_telefono: numero }).eq('id', id);

    // el texto ya salió: si el PDF falla, el pedido igual está hecho
    const r2 = await enviarArchivoWhatsapp(this.db, chatId, firmado.signedUrl, `${folio}.pdf`, '', 'pedido_proveedor');

    const { error: eUpd } = await this.db.from('ordenes_compra').update({
      estado: 'enviada', whatsapp_estado: 'enviado', whatsapp_telefono: numero,
      whatsapp_error: r2.enviado ? null : `el PDF no salió (${r2.motivo ?? 'sin detalle'})`, enviada_por: usuarioId,
    }).eq('id', id);
    if (eUpd) {
      // el mensaje ya salió: la orden no puede quedar como "no enviada"
      this.log.error(`OC #${oc.numero}: salió por WhatsApp pero no pude marcarla enviada: ${eUpd.message}`);
      await this.db.from('ordenes_compra').update({ whatsapp_estado: 'enviado',
        whatsapp_error: `salió, pero no pasó a 'enviada': ${eUpd.message}`.slice(0, 500) }).eq('id', id);
    }

    await this.anotarContacto(numero, oc.proveedor_id, proveedor);

    const legible = telefonoLegible(numero);
    await this.avisar(oc.creada_por, 'oc_enviada', `Pedido enviado a ${proveedor}`,
      `${folio} (OC #${oc.numero}) salió por WhatsApp a ${legible}${r2.enviado ? ' con la nota de pedido en PDF' : ', pero el PDF no salió: tocá acá para bajarlo y mandarlo a mano'}.`, id);
    this.log.log(`OC #${oc.numero} (${folio}) enviada por WhatsApp a ${numero}${r2.enviado ? '' : ' sin PDF'}`);
    return {
      enviado: true, estado: 'enviado', telefono: legible, folio,
      mensaje: `Pedido ${folio} enviado por WhatsApp a ${proveedor} (${legible})${r2.enviado ? '' : ', pero el PDF no salió: bajalo de la campanita y mandalo a mano'}.`,
    };
  }

  // Un número nuevo queda anotado como proveedor para que el bot no lo atienda
  // como cliente. Nunca se reclasifica a alguien que ya existe (puede ser un
  // cliente) ni a alguien de la casa (un usuario del sistema con ese teléfono).
  private async anotarContacto(numero: string, proveedorId: string, nombre: string) {
    try {
      const [{ data: contactos }, { data: equipo }] = await Promise.all([
        this.db.from('bot_contactos').select('telefono').or(`telefono.eq.${numero},telefono_real.eq.${numero}`).limit(1),
        this.db.from('usuarios').select('id').eq('telefono', numero).limit(1),
      ]);
      if ((contactos ?? []).length || (equipo ?? []).length) return;
      await this.db.from('bot_contactos').insert({ telefono: numero, telefono_real: numero, tipo: 'proveedor', proveedor_id: proveedorId, nombre });
    } catch {
      /* no frena el envío */
    }
  }

  // Para mandarlo desde un teléfono si WhatsApp de la casa no anda. Frena los
  // reintentos automáticos: si no, el cron podría mandarlo otra vez.
  async paraMandarAMano(id: string) {
    const { data: o } = await this.db.from('ordenes_compra').select('estado, whatsapp_estado').eq('id', id).maybeSingle();
    if ((o as any)?.whatsapp_estado === 'enviando') throw new BadRequestException('El pedido se está mandando en este momento: esperá un minuto.');
    if ((o as any)?.estado === 'aprobada') {
      await this.db.from('ordenes_compra')
        .update({ whatsapp_estado: 'error', whatsapp_intentos: 3, whatsapp_error: 'Se está mandando a mano.' })
        .eq('id', id).eq('estado', 'aprobada').or('whatsapp_estado.is.null,whatsapp_estado.eq.error');
    }
    const { oc, renglones, sucursal } = await this.armar(id);
    const { data: doc } = await this.db.from('documentos').select('folio').eq('tipo', 'orden_compra').eq('entidad_id', id).maybeSingle();
    const ex = celularDe(oc.proveedor?.telefono ?? '');
    const texto = textoPedido({
      folio: (doc as any)?.folio ?? `OC #${oc.numero}`, proveedor: oc.proveedor?.razon_social ?? '', sucursal,
      direccion: oc.sucursal?.direccion ?? null, fechaEntrega: oc.fecha_entrega ?? null, observaciones: observacionParaProveedor(oc.observaciones),
      items: renglones, conPdf: false,
    });
    return { texto, telefono: ex, enlace: ex ? `https://wa.me/${ex}?text=${encodeURIComponent(texto)}` : null };
  }

  async marcarEnviadaAMano(id: string, usuarioId?: string | null) {
    const { data, error } = await this.db.from('ordenes_compra')
      .update({ estado: 'enviada', whatsapp_estado: 'manual', whatsapp_error: null, enviada_por: usuarioId ?? null })
      .eq('id', id).eq('estado', 'aprobada').or('whatsapp_estado.is.null,whatsapp_estado.eq.error')
      .select('numero').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Solo se marca como enviada una orden aprobada que no se esté mandando por WhatsApp');
    return { ok: true, numero: (data as any).numero };
  }

  // Lo que quedó firmado y sin salir (lo aprobado desde Compras, o un intento
  // que falló y todavía se reintenta): cada 2 minutos, de a pocas.
  @Cron('0 */2 * * * *')
  async enviarPendientes() {
    if (!envioAutomaticoActivo()) return;
    const desde = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { data } = await this.db.from('ordenes_compra').select('id')
      .eq('estado', 'aprobada').gte('aprobada_en', desde)
      .or('whatsapp_estado.is.null,and(whatsapp_estado.eq.error,whatsapp_intentos.lt.3),whatsapp_estado.eq.enviando')
      .order('aprobada_en').limit(5);
    for (const o of (data ?? []) as any[]) {
      const r = await this.enviar(o.id, { automatico: true });
      if (r.estado === 'enviado' || r.estado === 'error') this.log.log(`cron de pedidos: ${r.mensaje}`);
    }
  }
}

// el número para wa.me (sin verificar: lo abre una persona desde su teléfono)
function celularDe(t: string) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('54')) return d;
  const sin0 = d.replace(/^0/, '').replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return sin0.length === 10 ? `549${sin0}` : d;
}

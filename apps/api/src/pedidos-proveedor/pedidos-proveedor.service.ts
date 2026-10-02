import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { ordenDeCompraPDF } from '../comun/documentos';
import { celularWhatsapp, enviarArchivoWhatsapp, enviarTextoWhatsapp } from '../comun/whatsapp';

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

// El mensaje que recibe el proveedor. Corto, en el idioma de un pedido por
// WhatsApp: qué, cuánto y dónde. El detalle completo va en el PDF.
export function textoPedido(p: {
  folio: string;
  proveedor: string;
  sucursal: string;
  direccion?: string | null;
  fechaEntrega?: string | null;
  observaciones?: string | null;
  items: RenglonPedido[];
}): string {
  const MAX = 25;
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
    `Les adjuntamos la nota de pedido en PDF. ¿Nos confirman si pueden entregar todo? Si falta algo, avísennos qué, así lo sabemos antes.`,
    ``,
    `¡Gracias!`,
  ].join('\n');
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

  private async avisar(para: string | null | undefined, tipo: string, titulo: string, detalle: string, ocId: string) {
    if (!para) return;
    await this.db.from('alertas_internas').insert({
      para_usuario: para, tipo, titulo, detalle, referencia: { link: '/compras', oc_id: ocId },
    }).then(() => null, () => null);
  }

  private async fallar(oc: any, motivo: string): Promise<ResultadoEnvio> {
    const { data: fila } = await this.db.from('ordenes_compra')
      .update({ whatsapp_estado: 'error', whatsapp_error: motivo.slice(0, 500) }).eq('id', oc.id).select('whatsapp_intentos').maybeSingle();
    this.log.warn(`OC #${oc.numero}: el pedido no salió por WhatsApp: ${motivo}`);
    // un aviso al primer intento y otro cuando el cron se rinde; no uno por vuelta
    const intentos = Number((fila as any)?.whatsapp_intentos ?? 1);
    if (intentos === 1 || intentos === 3) {
      await this.avisar(oc.creada_por, 'oc_no_salio', `El pedido a ${oc.proveedor?.razon_social ?? 'el proveedor'} no salió`,
        `OC #${oc.numero}: ${motivo}.${intentos === 3 ? ' Ya no se reintenta solo:' : ''} Se puede reenviar desde Compras o mandar a mano.`, oc.id);
    }
    return { enviado: false, estado: 'error', mensaje: `El pedido no salió por WhatsApp: ${motivo}.` };
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
      .map((i) => ({ nombre: i.producto?.nombre ?? '—', sku: i.producto?.sku, cantidad: Number(i.cantidad), codigoProveedor: codigo.get(i.producto_id) ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const sucursal = String(oc.sucursal?.nombre ?? '').replace(/^Suc\s+/, '').replace(/^Sant Thomas/, 'Saint Thomas').replace(/^Santa Ines$/, 'Santa Inés');
    return { oc, renglones, sucursal, telefono: celularWhatsapp(oc.proveedor?.telefono ?? '') };
  }

  // Manda la orden al proveedor. Lo llaman la firma del dueño, el cron y el
  // botón "Reenviar" (forzar). Nunca tira: devuelve qué pasó.
  async enviar(id: string, opts: { usuarioId?: string | null; forzar?: boolean; automatico?: boolean } = {}): Promise<ResultadoEnvio> {
    if (opts.automatico && !envioAutomaticoActivo()) {
      return { enviado: false, estado: 'apagado', mensaje: 'El envío automático por WhatsApp está apagado: mandá el pedido a mano.' };
    }
    try {
      const { data: tomada, error: e1 } = await this.db.rpc('oc_tomar_envio', { p_oc: id, p_forzar: !!opts.forzar });
      if (e1) throw new Error(e1.message);
      if (!tomada) {
        const { data: oc } = await this.db.from('ordenes_compra').select('numero, estado, whatsapp_estado, whatsapp_telefono').eq('id', id).maybeSingle();
        if ((oc as any)?.estado === 'enviada' || (oc as any)?.whatsapp_estado === 'enviado') {
          return { enviado: true, estado: 'ya_enviada', mensaje: `El pedido ya se le mandó al proveedor${(oc as any)?.whatsapp_telefono ? ` (${(oc as any).whatsapp_telefono})` : ''}.` };
        }
        if ((oc as any)?.whatsapp_estado === 'enviando') return { enviado: false, estado: 'no_corresponde', mensaje: 'El pedido se está mandando en este momento.' };
        return { enviado: false, estado: 'no_corresponde', mensaje: `La orden está ${(oc as any)?.estado ?? 'en otro estado'}: solo se manda una orden aprobada.` };
      }
      return await this.mandar(id, opts.usuarioId ?? null);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      this.log.error(`envío de la OC ${id}: ${motivo}`);
      await this.db.from('ordenes_compra').update({ whatsapp_estado: 'error', whatsapp_error: motivo.slice(0, 500) }).eq('id', id).then(() => null, () => null);
      return { enviado: false, estado: 'error', mensaje: `El pedido no salió por WhatsApp: ${motivo}.` };
    }
  }

  private async mandar(id: string, usuarioId: string | null): Promise<ResultadoEnvio> {
    const { oc, renglones, sucursal, telefono } = await this.armar(id);
    const proveedor = oc.proveedor?.razon_social ?? 'el proveedor';

    // los datos del proveedor los exige la base para aprobar; se revisa igual
    // ANTES de mandar, para no dejar un mensaje afuera con la orden sin pasar
    const { data: faltan } = await this.db.rpc('proveedor_faltantes', { p_id: oc.proveedor_id });
    if (Array.isArray(faltan) && faltan.length) return this.fallar(oc, `al proveedor le falta cargar ${faltan.join(', ')}`);
    if (!/^549\d{10}$/.test(telefono)) {
      return this.fallar(oc, `el teléfono del proveedor ("${oc.proveedor?.telefono ?? ''}") no es un celular argentino con código de área`);
    }
    if (!renglones.length) return this.fallar(oc, 'la orden no tiene productos');

    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await this.db.from('ordenes_compra').select('id', { count: 'exact', head: true })
      .eq('whatsapp_estado', 'enviado').gte('enviada_en', desde);
    if ((count ?? 0) >= TOPE_DIARIO) {
      return this.fallar(oc, `ya salieron ${count} pedidos en las últimas 24 h (tope ${TOPE_DIARIO}, para cuidar la línea)`);
    }

    // el folio nace (o se reusa) acá: es el número que recibe el proveedor
    const { data: doc, error: eDoc } = await this.db.rpc('emitir_documento', {
      p_tipo: 'orden_compra', p_entidad: 'ordenes_compra', p_entidad_id: id, p_usuario: usuarioId,
      p_datos: { numero: oc.numero, total: oc.total, proveedor },
    });
    if (eDoc) throw new Error(`no pude emitir el folio: ${eDoc.message}`);
    const folio = String((doc as any).folio);

    const firmas = await this.nombres([oc.creada_por, oc.aprobada_por]);
    const pdf = await ordenDeCompraPDF({
      folio, emitidoEn: (doc as any).emitido_en, numeroInterno: oc.numero, fecha: oc.creado_en,
      proveedor: oc.proveedor ?? null, sucursal: [sucursal, oc.sucursal?.direccion].filter(Boolean).join(' · '),
      condicionPago: oc.condicion_pago ?? oc.proveedor?.condicion_pago ?? null, fechaEntrega: oc.fecha_entrega ?? null,
      observaciones: oc.observaciones ?? null,
      items: renglones.map((r) => ({ nombre: r.nombre, codigoProveedor: r.codigoProveedor, cantidad: r.cantidad, costo_unitario: 0 })),
      total: 0, emitidaPor: firmas.get(oc.creada_por) ?? null, aprobadaPor: firmas.get(oc.aprobada_por) ?? null,
      sinPrecios: true,
    });

    // WAHA baja el PDF de una URL: va al bucket privado con un enlace firmado
    const ruta = `notas-de-pedido/${folio}.pdf`;
    const { error: eSubir } = await this.db.storage.from('comprobantes').upload(ruta, pdf, { contentType: 'application/pdf', upsert: true });
    if (eSubir) throw new Error(`no pude guardar el PDF: ${eSubir.message}`);
    const { data: firmado, error: eUrl } = await this.db.storage.from('comprobantes').createSignedUrl(ruta, 7 * 86_400);
    if (eUrl || !firmado?.signedUrl) throw new Error(`no pude armar el enlace del PDF: ${eUrl?.message ?? 'sin enlace'}`);

    const texto = textoPedido({
      folio, proveedor, sucursal, direccion: oc.sucursal?.direccion ?? null,
      fechaEntrega: oc.fecha_entrega ?? null, observaciones: oc.observaciones ?? null, items: renglones,
    });
    const r1 = await enviarTextoWhatsapp(this.db, telefono, texto, 'pedido_proveedor');
    if (!r1.enviado) return this.fallar(oc, `WhatsApp no lo aceptó (${r1.motivo ?? 'sin detalle'})`);
    // el texto ya salió: si el PDF falla, el pedido igual está hecho
    const r2 = await enviarArchivoWhatsapp(this.db, telefono, firmado.signedUrl, `${folio}.pdf`, '', 'pedido_proveedor');

    const { error: eUpd } = await this.db.from('ordenes_compra').update({
      estado: 'enviada', whatsapp_estado: 'enviado', whatsapp_msg_id: r1.id ?? null, whatsapp_telefono: telefono,
      whatsapp_error: r2.enviado ? null : `el PDF no salió (${r2.motivo ?? 'sin detalle'})`, enviada_por: usuarioId,
    }).eq('id', id);
    if (eUpd) {
      // el mensaje ya salió: la orden no puede quedar como "no enviada"
      this.log.error(`OC #${oc.numero}: salió por WhatsApp pero no pude marcarla enviada: ${eUpd.message}`);
      await this.db.from('ordenes_compra').update({ whatsapp_estado: 'enviado', whatsapp_msg_id: r1.id ?? null, whatsapp_telefono: telefono,
        whatsapp_error: `salió, pero no pasó a 'enviada': ${eUpd.message}`.slice(0, 500) }).eq('id', id);
    }

    // el contacto nuevo queda como proveedor para que el bot no lo atienda como
    // cliente; uno que ya existe no se toca (puede ser un cliente o alguien de la casa)
    const { data: contacto } = await this.db.from('bot_contactos').select('telefono').eq('telefono', telefono).maybeSingle();
    if (!contacto) {
      await this.db.from('bot_contactos').insert({ telefono, tipo: 'proveedor', proveedor_id: oc.proveedor_id, nombre: proveedor })
        .then(() => null, () => null);
    }

    const legible = `+${telefono.slice(0, 2)} ${telefono.slice(2, 3)} ${telefono.slice(3, 5)} ${telefono.slice(5, 9)}-${telefono.slice(9)}`;
    await this.avisar(oc.creada_por, 'oc_enviada', `Pedido enviado a ${proveedor}`,
      `${folio} (OC #${oc.numero}) salió por WhatsApp a ${legible}${r2.enviado ? ' con la nota de pedido en PDF' : ', pero el PDF no salió'}.`, id);
    this.log.log(`OC #${oc.numero} (${folio}) enviada por WhatsApp a ${telefono}${r2.enviado ? '' : ' sin PDF'}`);
    return {
      enviado: true, estado: 'enviado', telefono: legible, folio,
      mensaje: `Pedido ${folio} enviado por WhatsApp a ${proveedor} (${legible})${r2.enviado ? '' : ', pero el PDF no salió: reenviá la nota a mano'}.`,
    };
  }

  // Para mandarlo desde el teléfono si WhatsApp de la casa no anda
  async paraMandarAMano(id: string) {
    const { oc, renglones, sucursal, telefono } = await this.armar(id);
    const { data: doc } = await this.db.from('documentos').select('folio').eq('tipo', 'orden_compra').eq('entidad_id', id).maybeSingle();
    const texto = textoPedido({
      folio: (doc as any)?.folio ?? `OC #${oc.numero}`, proveedor: oc.proveedor?.razon_social ?? '', sucursal,
      direccion: oc.sucursal?.direccion ?? null, fechaEntrega: oc.fecha_entrega ?? null, observaciones: oc.observaciones ?? null, items: renglones,
    });
    return { texto, telefono, enlace: telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}` : null };
  }

  async marcarEnviadaAMano(id: string, usuarioId?: string | null) {
    const { data, error } = await this.db.from('ordenes_compra')
      .update({ estado: 'enviada', whatsapp_estado: 'manual', whatsapp_error: null, enviada_por: usuarioId ?? null })
      .eq('id', id).eq('estado', 'aprobada').select('numero').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Solo se marca como enviada una orden aprobada');
    return { ok: true, numero: (data as any).numero };
  }

  // Lo que quedó firmado y sin salir (lo aprobado desde Compras, o un intento
  // que falló): cada 2 minutos, de a pocas.
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

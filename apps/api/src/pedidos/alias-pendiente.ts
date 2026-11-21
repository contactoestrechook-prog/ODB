// EL ALIAS, CUANDO SABEMOS QUE ESTÁ TODO (Leandro, 21/11/2026: «le pide el alias
// cuando el pedido ya está preparado y sabemos que tenemos todo el stock»).
// «Listo» no alcanza: 12 de los 17 pedidos listos del último mes se marcaron
// desde el panel, sin el «Terminé» del armado (que ya frena con cambios sin
// contestar); DOM-1284BEF14D1D lo marcó listo el dueño. El alias sale solo si
// no queda ningún cambio por contestar con el cliente y el sistema no marca
// faltantes. Si falta algo, sale cuando se resuelve (el cambio contestado o el
// faltante sacado o reemplazado), con el total que quedó.
import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarTextoWhatsapp } from '../comun/whatsapp';
import { hayWhatsapp, Lineas } from '../comun/lineas';
import { avisoListoConAlias, datosParaTransferir, ESTADOS_LISTO, pasaAliasAlListo, totalPorTransferencia } from './alias-al-listo';

const log = new Logger('AliasAlListo');

/** Los cambios que todavía puede contestar el cliente (pedidos_reemplazos). */
export const CAMBIOS_ABIERTOS = ['propuesto', 'en_cola', 'preguntado'];

/** ¿Sabemos que está todo? Sin cambios por contestar y sin faltantes. Ante la duda, no. */
export async function pedidoCompleto(db: SupabaseClient, pedidoId: string): Promise<{ completo: boolean; motivo?: string }> {
  const [cambios, faltan] = await Promise.all([
    db.from('pedidos_reemplazos').select('id').eq('pedido_id', pedidoId).in('estado', CAMBIOS_ABIERTOS).limit(1),
    db.rpc('faltantes_pedido', { p_pedido: pedidoId }),
  ]);
  if ((cambios as any).error || (faltan as any).error) return { completo: false, motivo: 'no se pudo verificar el stock' };
  if (((cambios as any).data ?? []).length) return { completo: false, motivo: 'un cambio sin contestar' };
  if (((faltan as any).data ?? []).length) return { completo: false, motivo: 'faltante de stock' };
  return { completo: true };
}

export type AvisoConAlias = { texto: string; total: number; totalTransferencia: number };

/**
 * El aviso con el alias para un pedido listo o en camino que paga por
 * transferencia. null si no corresponde todavía (no está todo, la línea no
 * tiene alias) o si ya se le pasó con este mismo total.
 */
export async function avisoConAlias(db: SupabaseClient, pedido: any, linea: string, estado: string): Promise<AvisoConAlias | null> {
  if (!ESTADOS_LISTO.includes(estado) || !pasaAliasAlListo(pedido)) return null;
  const codigo = pedido.qr_retiro ?? pedido.id;
  const datos = datosParaTransferir((await new Lineas(db).config(linea)) as any);
  if (!datos) {
    log.error(`pedido ${codigo}: paga por transferencia y la línea ${linea} no tiene alias cargado; el alias no sale`);
    return null;
  }
  const total = Math.round(Number(pedido.total) || 0);
  const { data: previo } = await db.from('pedidos_historial').select('detalle').eq('pedido_id', pedido.id).eq('evento', 'alias')
    .order('creado_en', { ascending: false }).limit(1).maybeSingle();
  if (previo && Math.round(Number((previo as any).detalle?.total)) === total) return null;
  const { completo, motivo } = await pedidoCompleto(db, pedido.id);
  if (!completo) {
    log.log(`pedido ${codigo}: el alias espera (${motivo})`);
    return null;
  }
  const [{ data: items }, { data: cliente }] = await Promise.all([
    db.from('pedidos_items').select('cantidad, precio_unitario, producto:productos(categoria:categorias(nombre))').eq('pedido_id', pedido.id),
    pedido.cliente_id ? db.from('clientes').select('mayorista').eq('id', pedido.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const renglones = ((items ?? []) as any[]).map((i) => ({ cantidad: i.cantidad, precio_unitario: i.precio_unitario, categoria: i.producto?.categoria?.nombre ?? null }));
  const totalTransferencia = totalPorTransferencia(total, renglones, (cliente as any)?.mayorista === true);
  return { texto: avisoListoConAlias(pedido, { total, totalTransferencia, datos }, estado), total, totalTransferencia };
}

/** El alias que salió queda en el historial del pedido y en la charla del bot (si vino del bot). */
export async function anotarAliasPasado(db: SupabaseClient, pedidoId: string, estado: string, a: AvisoConAlias, charla?: { linea?: string | null; telefono?: string | null } | null) {
  await db.from('pedidos_historial').insert({ pedido_id: pedidoId, evento: 'alias', estado_despues: estado, detalle: { total: a.total, total_transferencia: a.totalTransferencia } })
    .then(() => null, () => null);
  if (charla?.linea && charla?.telefono) await anotarEnLaCharla(db, String(charla.linea), String(charla.telefono), a.texto);
}

/** Lo que el sistema le escribió al cliente queda en la charla del bot (como los reemplazos). */
async function anotarEnLaCharla(db: SupabaseClient, linea: string, clave: string, texto: string) {
  try {
    const { data: conv } = await db.from('bot_conversaciones').select('mensajes').eq('linea', linea).eq('telefono', clave).maybeSingle();
    const hist: any[] = Array.isArray((conv as any)?.mensajes) ? (conv as any).mensajes : [];
    const en = new Date().toISOString();
    const ult = hist[hist.length - 1];
    // dos del mismo lado seguidos rompen el hilo del modelo: se juntan
    const nuevos = ult && ult.role === 'assistant' && typeof ult.content === 'string' && !ult.de
      ? [...hist.slice(0, -1), { ...ult, content: `${ult.content}\n\n${texto}` }]
      : [...hist, { role: 'assistant', content: texto, en }];
    await db.from('bot_conversaciones').upsert({ linea, telefono: clave, mensajes: nuevos.slice(-40), actualizado_en: en }, { onConflict: 'linea,telefono' });
  } catch (e: any) {
    log.warn(`no pude anotar el alias en la charla ${clave}: ${e?.message ?? e}`);
  }
}

/**
 * Después de cerrar un cambio con el cliente o un faltante: si el pedido ya
 * estaba listo (o en camino), paga por transferencia y ahora está todo, le
 * llega el alias con el total que quedó. Nunca tira: devuelve si salió.
 */
export async function pasarAliasPendiente(db: SupabaseClient, pedidoId: string): Promise<boolean> {
  try {
    if (!hayWhatsapp()) return false;
    const { data: p } = await db.from('pedidos')
      .select('id, estado, canal, qr_retiro, total, forma_pago, pagado_en, origen, cliente_id, contacto_telefono, cliente:clientes(telefono)')
      .eq('id', pedidoId).maybeSingle();
    const pedido: any = p;
    if (!pedido || !ESTADOS_LISTO.includes(String(pedido.estado)) || !pasaAliasAlListo(pedido)) return false;
    const telefono = pedido.cliente?.telefono || pedido.contacto_telefono;
    if (!telefono) return false;
    const { data: cot } = await db.from('bot_cotizaciones').select('linea, telefono').eq('pedido_id', pedidoId).limit(1).maybeSingle();
    const lineas = new Lineas(db);
    const linea = (cot as any)?.linea ? String((cot as any).linea) : await lineas.principal();
    const aviso = await avisoConAlias(db, pedido, linea, String(pedido.estado));
    if (!aviso) return false;
    const sesion = (cot as any)?.linea ? await lineas.sesion(linea) : undefined;
    const r = await enviarTextoWhatsapp(db, String(telefono), aviso.texto, 'aviso-cliente-pedido', sesion);
    if (!r.enviado) {
      log.warn(`pedido ${pedido.qr_retiro ?? pedidoId}: el alias pendiente no salió (${r.motivo ?? 'sin motivo'})`);
      return false;
    }
    await anotarAliasPasado(db, pedidoId, String(pedido.estado), aviso, cot as any);
    log.log(`pedido ${pedido.qr_retiro ?? pedidoId}: salió el alias pendiente ($${aviso.totalTransferencia})`);
    return true;
  } catch (e: any) {
    log.error(`pedido ${pedidoId}: no pude pasar el alias pendiente: ${e?.message ?? e}`);
    return false;
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { celularWhatsapp, enviarWhatsapp } from '../comun/whatsapp';
import { hayWhatsapp, Lineas } from '../comun/lineas';
import { esfuerzo, RAZONAMIENTO } from '../comun/modelos';
import { linkDelSalon } from '../avisos/aviso-pedido';
import {
  cantidadEquivalente, type CambioParaTexto, type CambioRespondido, type Candidato, enHorarioDeMensajes, leerSiNo, leerVariedad,
  ordenarParecidos, palabrasDe, sePesa, soloCortesia, textoDeCierre, textoDeNoHay, textoDePregunta, textoParaQuienArma, variedadesLimpias, claveVariedad,
} from './reemplazos';
import { aclaracionDe, aclaracionesDeNotas, cambiarAclaracion } from '../comun/aclaraciones';

// «TENGO PARECIDO» Y LA CONSULTA AL CLIENTE (Leandro y Jaqui, 20/11/2026):
//  1. Al armar, si un producto no está, quien arma elige un parecido (el sistema
//     le sugiere los de la misma góndola con stock). Queda PROPUESTO: el pedido
//     no cambia.
//  2. Al terminar, «Consultar al cliente»: sale un WhatsApp por producto, de a
//     uno («Manteca 200 g no hay. En su lugar va Manteca 100 g ×2. ¿Te sirve?
//     Respondé SÍ o NO»), por la misma línea y al mismo chat donde pidió.
//  3. El bot reconoce el sí o el no ANTES de atender el mensaje como una charla
//     (como la fecha de un proveedor). Con el sí entra el parecido; con el no
//     sale lo que falta. Después sale la pregunta siguiente.
//  4. Con la última respuesta: al cliente, cómo queda su pedido; a quien arma,
//     un WhatsApp (y su pantalla) con los cambios confirmados.
// Nada sale de 22 a 8 (regla de Leandro, 18/11/2026): queda en cola y sale a las 8.

/** El modelo que lee una respuesta que no es un sí o un no claro. */
const MODELO_LECTURA = process.env.REEMPLAZOS_MODELO || 'claude-haiku-5-5';
/** Hasta cuándo una pregunta sin contestar sigue esperando su respuesta. */
const DIAS_ESPERA = 3;

type Fila = {
  id: string; pedido_id: string; producto_id: string; nombre_falta: string; pide: number; hay: number; precio_falta: number | null;
  reemplazo_id: string; nombre_reemplazo: string; cantidad: number; precio: number | null; estado: string; orden: number | null;
  creado_por: string | null; creado_en: string; consultado_por: string | null; consultado_en: string | null;
  chat: string | null; chat_clave: string | null; telefono: string | null; linea: string | null; sesion: string | null;
  preguntado_en: string | null; intentos: number; proximo_intento: string | null; ultimo_error: string | null;
  otra_respuesta: string | null; otra_respuesta_en: string | null;
  respondido_en: string | null; respuesta: string | null; decidido_por: string | null; resultado: any; error: string | null; cerrado_en: string | null;
  falta?: { vendido_por_peso?: boolean | null } | null; parecido?: { vendido_por_peso?: boolean | null } | null;
  // variedad (20/11/2026): el mismo producto en otra fragancia, sabor o color
  tipo?: 'parecido' | 'variedad' | null; pedida?: string | null; variedades?: string[] | null; elegida?: string | null;
};
const COLUMNAS = '*, falta:productos!pedidos_reemplazos_producto_id_fkey(vendido_por_peso), parecido:productos!pedidos_reemplazos_reemplazo_id_fkey(vendido_por_peso)';
const ABIERTOS_PEDIDO = ['recibido', 'pagado', 'en_preparacion', 'listo'];

const paraTexto = (f: Fila): CambioParaTexto => ({
  nombre_falta: f.nombre_falta, pide: Number(f.pide), hay: Number(f.hay), nombre_reemplazo: f.nombre_reemplazo,
  cantidad: Number(f.cantidad), precio: f.precio == null ? null : Number(f.precio),
  faltaPorPeso: sePesa(f.nombre_falta, f.falta?.vendido_por_peso === true, Number(f.pide)),
  reemplazoPorPeso: sePesa(f.nombre_reemplazo, f.parecido?.vendido_por_peso === true, Number(f.cantidad)),
  tipo: f.tipo === 'variedad' ? 'variedad' : 'parecido', pedida: f.pedida ?? null, variedades: f.variedades ?? null, elegida: f.elegida ?? null,
});
const respondido = (f: Fila): CambioRespondido => ({ ...paraTexto(f), estado: f.estado as 'aceptado' | 'rechazado', error: f.error });
const digitos = (t: unknown) => String(t ?? '').replace(/\D/g, '');

export type Destino = { chat: string; chatClave: string; telefono: string | null; linea: string; sesion: string };

@Injectable()
export class ReemplazosService {
  private readonly log = new Logger('Reemplazos');
  private readonly lineas: Lineas;
  /** Pedidos con una pregunta saliendo ahora (la cola y la pantalla no mandan dos veces). */
  private readonly ocupados = new Set<string>();
  private enVuelta = false;
  /**
   * Lo conecta el bot al arrancar: deja lo que sale y lo que contesta el cliente
   * en RESPONDE (la app de las charlas), como cualquier turno.
   */
  registrarEnResponde?: (waId: string, textoCliente: string, textoBot: string | null) => Promise<void>;

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {
    this.lineas = new Lineas(db);
  }

  /** Solo el servidor de producción manda (como los avisos de pedidos): una máquina de desarrollo no. */
  puedeMandar(sesion?: string | null): boolean {
    return process.env.ODB_AVISOS_PEDIDOS === '1' && hayWhatsapp(sesion);
  }

  // ---------- 1. Los parecidos y la propuesta ----------

  /**
   * Lo que se parece al que falta y hay en la sucursal del pedido: de su misma
   * categoría y, por las dudas, lo que empieza igual («Manteca…») en otra.
   * Con el precio de ESTE pedido y cuántos equivalen (1 de 200 g → 2 de 100 g).
   */
  async parecidos(pedidoId: string, productoId: string, faltan?: number) {
    const { data: ped, error } = await this.db.from('pedidos')
      .select('id, sucursal_id, items:pedidos_items(producto_id, cantidad, producto:productos(nombre, categoria_id, vendido_por_peso))')
      .eq('id', pedidoId).maybeSingle();
    if (error) throw new BadRequestException(this.migracion(error.message));
    if (!ped) throw new BadRequestException('No existe el pedido');
    const item = (((ped as any).items ?? []) as any[]).find((i) => i.producto_id === productoId);
    if (!item) throw new BadRequestException('Ese producto ya no está en el pedido: actualizá la pantalla');
    const nombre = String(item.producto?.nombre ?? '');
    const suc = (ped as any).sucursal_id as string | null;
    const enPedido = new Set((((ped as any).items ?? []) as any[]).map((i) => String(i.producto_id)));

    const juntar = new Map<string, Candidato & { porPeso: boolean }>();
    const sumar = (filas: any[]) => {
      for (const f of filas) {
        const p = f.productos;
        if (!p || p.activo === false || p.id === productoId) continue;
        const ya = juntar.get(p.id);
        const stock = Number(f.cantidad) || 0;
        if (ya) ya.stock += stock;
        else juntar.set(p.id, {
          id: p.id, nombre: String(p.nombre), stock, vendidas: Number(p.unidades_vendidas) || 0, porPeso: sePesa(String(p.nombre), p.vendido_por_peso === true),
          // la misma góndola (sin categoría cargada, no se sabe: cuenta como otra)
          mismaCategoria: !!item.producto?.categoria_id && p.categoria_id === item.producto.categoria_id,
        });
      }
    };
    const base = () => {
      let q = this.db.from('stock')
        .select('producto_id, cantidad, productos!inner(id, nombre, activo, categoria_id, unidades_vendidas, vendido_por_peso)')
        .gt('cantidad', 0).eq('productos.activo', true).limit(1000);
      if (suc) q = q.eq('sucursal_id', suc);
      return q;
    };
    const pedidos: PromiseLike<any>[] = [];
    if (item.producto?.categoria_id) pedidos.push(base().eq('productos.categoria_id', item.producto.categoria_id));
    const primera = palabrasDe(nombre)[0];
    if (primera && primera.length >= 3) pedidos.push(base().like('productos.texto_busqueda', `%${primera}%`));
    for (const r of await Promise.all(pedidos)) {
      if (r.error) throw new BadRequestException(r.error.message);
      sumar(r.data ?? []);
    }
    const mejores = ordenarParecidos(nombre, [...juntar.values()], 6);
    if (!mejores.length) return [];
    const { data: precios } = await this.db.rpc('precios_en_pedido', { p_pedido: pedidoId, p_productos: mejores.map((m) => m.id) });
    const precio = new Map(((precios ?? []) as any[]).map((p) => [String(p.producto_id), p.precio == null ? null : Number(p.precio)]));
    const resto = Number.isFinite(Number(faltan)) && Number(faltan) > 0 ? Number(faltan) : Number(item.cantidad);
    return mejores.map((m) => ({
      id: m.id, nombre: m.nombre, stock: m.stock, precio: precio.get(m.id) ?? null,
      porPeso: juntar.get(m.id)?.porPeso ?? false,
      yaEnElPedido: enPedido.has(m.id),
      cantidadSugerida: cantidadEquivalente(resto, { nombre, porPeso: sePesa(nombre, item.producto?.vendido_por_peso === true, Number(item.cantidad)) }, { nombre: m.nombre, porPeso: juntar.get(m.id)?.porPeso ?? false }),
    }));
  }

  /** «Tengo parecido»: queda propuesto; el pedido cambia recién con la respuesta. */
  async proponer(pedidoId: string, dto: { productoId?: string; hay?: number; reemplazoId?: string | null; cantidad?: number | null }, usuarioId?: string | null) {
    if (!dto.productoId) throw new BadRequestException('Falta decir qué producto');
    if (!dto.reemplazoId) throw new BadRequestException('Elegí el parecido');
    const hay = Number(dto.hay ?? 0);
    if (!Number.isFinite(hay) || hay < 0 || hay > 1000) throw new BadRequestException('Cantidad inválida');
    const cantidad = dto.cantidad == null || String(dto.cantidad) === '' ? null : Number(dto.cantidad);
    if (cantidad != null && (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000)) throw new BadRequestException('Cantidad inválida');
    const { data, error } = await this.db.rpc('proponer_reemplazo', {
      p_pedido: pedidoId, p_producto: dto.productoId, p_hay: hay, p_reemplazo: dto.reemplazoId, p_cantidad: cantidad, p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.migracion(error.message));
    return data;
  }

  /**
   * «NO HAY ESE SABOR; DE ESE HAY ESTOS» (Leandro, 20/11/2026). El mismo
   * producto en otra fragancia, sabor o color: queda propuesto como un parecido
   * y sale con «Consultar al cliente». La que eligió cambia la aclaración del
   * renglón en las notas; producto, cantidad y precio quedan igual.
   */
  async proponerVariedad(pedidoId: string, dto: { productoId?: string; pedida?: string | null; variedades?: unknown }, usuarioId?: string | null) {
    if (!dto.productoId) throw new BadRequestException('Falta decir qué producto');
    const variedades = variedadesLimpias(dto.variedades);
    if (!variedades.length) throw new BadRequestException('Anotá al menos una que haya');
    const { data: ped, error } = await this.db.from('pedidos')
      .select('id, estado, venta_id, notas, items:pedidos_items(producto_id, cantidad, precio_unitario, producto:productos(nombre))')
      .eq('id', pedidoId).maybeSingle();
    if (error) throw new BadRequestException(this.migracion(error.message));
    if (!ped) throw new BadRequestException('No existe el pedido');
    if (['entregado', 'cancelado'].includes(String((ped as any).estado)) || (ped as any).venta_id) throw new BadRequestException(`El pedido ya está ${(ped as any).estado}: no se le pueden cambiar los productos`);
    const item = (((ped as any).items ?? []) as any[]).find((i) => i.producto_id === dto.productoId);
    if (!item) throw new BadRequestException('Ese producto ya no está en el pedido: actualizá la pantalla');
    const nombre = String(item.producto?.nombre ?? 'Producto');
    const pedida = String(dto.pedida ?? '').trim().slice(0, 40) || aclaracionDe(nombre, aclaracionesDeNotas((ped as any).notas)) || null;
    const { data: esperando } = await this.db.from('pedidos_reemplazos').select('id').eq('pedido_id', pedidoId).eq('producto_id', dto.productoId).eq('estado', 'preguntado').limit(1);
    if (esperando?.length) throw new BadRequestException(`Ya le preguntamos al cliente por ${nombre}: esperá la respuesta`);
    await this.db.from('pedidos_reemplazos').update({ estado: 'anulado' }).eq('pedido_id', pedidoId).eq('producto_id', dto.productoId).in('estado', ['propuesto', 'en_cola']);
    const precio = item.precio_unitario == null ? null : Number(item.precio_unitario);
    const { data, error: e } = await this.db.from('pedidos_reemplazos').insert({
      pedido_id: pedidoId, producto_id: dto.productoId, nombre_falta: nombre, pide: Number(item.cantidad), hay: 0, precio_falta: precio,
      reemplazo_id: dto.productoId, nombre_reemplazo: nombre, cantidad: Number(item.cantidad), precio,
      tipo: 'variedad', pedida, variedades, creado_por: usuarioId ?? null, estado: 'propuesto', intentos: 0, creado_en: new Date().toISOString(),
    }).select('id').single();
    if (e) throw new BadRequestException(this.migracion(e.message));
    // lo que quien arma dice que hay queda sabido de ese producto (20/11/2026)
    await this.aprenderVariedades(dto.productoId, variedades, usuarioId);
    return { id: (data as any).id, falta: nombre, pedida, variedades, variedad: true };
  }

  /**
   * LAS VARIEDADES QUE SE CONOCEN (Leandro, 20/11/2026: «el empleado aclara que hay
   * sabor bebé: ustedes ya en el sistema tienen que figurar que existe ese
   * sabor»). Se guardan con la última vez que se vieron; nunca frena el armado.
   */
  async aprenderVariedades(productoId: string, nombres: string[], usuarioId?: string | null) {
    const ahora = new Date().toISOString();
    const filas = variedadesLimpias(nombres).map((nombre) => ({ producto_id: productoId, nombre, clave: claveVariedad(nombre), visto_en: ahora, ...(usuarioId ? { creado_por: usuarioId } : {}) }));
    if (!filas.length) return;
    const { error } = await this.db.from('producto_variedades').upsert(filas, { onConflict: 'producto_id,clave' });
    if (error) this.log.warn(`no pude guardar las variedades de ${productoId}: ${error.message}`);
  }

  /** Las variedades conocidas de cada producto, las vistas más recientemente primero. */
  async variedadesDe(productoIds: string[]): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    const ids = [...new Set(productoIds.filter(Boolean))];
    if (!ids.length) return m;
    const { data, error } = await this.db.from('producto_variedades').select('producto_id, nombre, visto_en').in('producto_id', ids).order('visto_en', { ascending: false });
    if (error) return m;
    for (const f of (data ?? []) as any[]) m.set(String(f.producto_id), [...(m.get(String(f.producto_id)) ?? []), String(f.nombre)]);
    return m;
  }

  /**
   * NO HAY Y NO HAY OTRA (20/11/2026): sale del pedido y al cliente se le avisa
   * en el momento (no hay nada que preguntarle). Sin WhatsApp del cliente, o de
   * noche, sale igual del pedido y quien arma ve por qué no se le avisó.
   */
  async sacarYAvisar(pedidoId: string, productoId: string, usuarioId?: string | null) {
    const { data: ped } = await this.db.from('pedidos')
      .select('qr_retiro, notas, contacto_nombre, cliente:clientes(nombre), items:pedidos_items(producto_id, producto:productos(nombre))')
      .eq('id', pedidoId).maybeSingle();
    const item = (((ped as any)?.items ?? []) as any[]).find((i) => i.producto_id === productoId);
    if (!item) throw new BadRequestException('Ese producto ya no está en el pedido: actualizá la pantalla');
    const nombre = String(item.producto?.nombre ?? 'Producto');
    const pedida = aclaracionDe(nombre, aclaracionesDeNotas((ped as any)?.notas));
    const { data: r, error } = await this.db.rpc('resolver_falta_armado', { p_pedido: pedidoId, p_producto: productoId, p_hay: 0, p_reemplazo: null, p_cantidad: null, p_usuario: usuarioId ?? null });
    if (error) throw new BadRequestException(error.message);
    const total = (r as any)?.total == null ? null : Number((r as any).total);
    const destino = await this.destinoDelPedido(pedidoId);
    let avisado = false;
    let motivo: string | null = null;
    if (!destino) motivo = 'No tengo el WhatsApp del cliente: avisale vos (llamalo).';
    else if (!enHorarioDeMensajes()) motivo = 'Son más de las 22: avisale mañana (de noche no se le escribe a nadie).';
    else if (!this.puedeMandar(destino.sesion)) motivo = 'Este servidor no manda WhatsApp (solo el de producción).';
    else {
      const codigo = String((ped as any)?.qr_retiro || pedidoId.slice(0, 8).toUpperCase());
      const texto = textoDeNoHay({ cliente: (ped as any)?.cliente?.nombre || (ped as any)?.contacto_nombre || null, codigo, nombre, pedida, total });
      const w = await enviarWhatsapp(this.db, { to: destino.chat, sesion: destino.sesion, text: texto, origen: 'reemplazo', referencia: `pedido/${pedidoId}` });
      avisado = !!(w.enviado || w.incierto);
      if (avisado) {
        const f = { linea: destino.linea, chat_clave: destino.chatClave, chat: destino.chat } as Fila;
        await this.anotarEnLaCharla(f, [{ role: 'assistant', content: texto }]);
        this.registrarEnResponde?.(this.waIdDe(f), '', texto).catch(() => null);
      } else motivo = `No salió el WhatsApp (${w.motivo ?? 'sin motivo'}): avisale vos.`;
    }
    this.log.log(`pedido ${pedidoId}: ${nombre}${pedida ? ` (${pedida})` : ''} no hay, salió del pedido; ${avisado ? 'se le avisó al cliente' : `no se le avisó (${motivo})`}`);
    return { ...((r as any) ?? {}), avisado, motivo };
  }

  /** Se arrepintió antes de consultar: el producto vuelve a estar como antes. */
  async anular(pedidoId: string, id: string) {
    const { data, error } = await this.db.from('pedidos_reemplazos').update({ estado: 'anulado' })
      .eq('id', id).eq('pedido_id', pedidoId).in('estado', ['propuesto', 'en_cola']).select('id');
    if (error) throw new BadRequestException(this.migracion(error.message));
    if (!data?.length) throw new BadRequestException('Ese cambio ya se le preguntó al cliente: esperá la respuesta o anotá lo que dijo');
    return { ok: true };
  }

  /** Lo de cada pedido para la pantalla del armado: lo abierto y lo cerrado en las últimas 6 h. */
  async dePedidos(ids: string[]) {
    if (!ids.length) return new Map<string, any[]>();
    const { data, error } = await this.db.from('pedidos_reemplazos').select(COLUMNAS)
      .in('pedido_id', ids).neq('estado', 'anulado').order('creado_en');
    // sin la migración, el armado sigue andando como antes
    if (error) { this.log.warn(`cambios del armado: ${error.message}`); return new Map<string, any[]>(); }
    const hace6 = Date.now() - 6 * 3600_000;
    const porPedido = new Map<string, any[]>();
    for (const f of (data ?? []) as Fila[]) {
      if (f.cerrado_en && Date.parse(f.cerrado_en) < hace6) continue;
      porPedido.set(f.pedido_id, [...(porPedido.get(f.pedido_id) ?? []), {
        id: f.id, productoId: f.producto_id, falta: f.nombre_falta, pide: Number(f.pide), hay: Number(f.hay),
        reemplazoId: f.reemplazo_id, reemplazo: f.nombre_reemplazo, cantidad: Number(f.cantidad), precio: f.precio == null ? null : Number(f.precio),
        faltaPorPeso: sePesa(f.nombre_falta, f.falta?.vendido_por_peso === true, Number(f.pide)),
        reemplazoPorPeso: sePesa(f.nombre_reemplazo, f.parecido?.vendido_por_peso === true, Number(f.cantidad)),
        estado: f.estado, consultadoEn: f.consultado_en, preguntadoEn: f.preguntado_en, respondidoEn: f.respondido_en,
        respuesta: f.respuesta, porWhatsapp: !!f.respondido_en && !f.decidido_por, error: f.error, ultimoError: f.ultimo_error,
        otraRespuesta: f.otra_respuesta, otraRespuestaEn: f.otra_respuesta_en, cerradoEn: f.cerrado_en,
        tipo: f.tipo === 'variedad' ? 'variedad' : 'parecido', pedida: f.pedida ?? null, variedades: f.variedades ?? null, elegida: f.elegida ?? null,
      }]);
    }
    return porPedido;
  }

  // ---------- 2. La consulta ----------

  /** A dónde se le escribe: al chat donde pidió (por esa línea) o, si no, a su teléfono por la general. */
  async destinoDelPedido(pedidoId: string): Promise<Destino | null> {
    const { data: p } = await this.db.from('pedidos').select('contacto_telefono, origen, cliente:clientes(telefono)').eq('id', pedidoId).maybeSingle();
    if (!p) return null;
    const tel = celularWhatsapp(String((p as any).cliente?.telefono || (p as any).contacto_telefono || ''));
    const telValido = tel.length >= 12 && tel.length <= 13 ? tel : null;
    const { data: cot } = await this.db.from('bot_cotizaciones').select('telefono, linea').eq('pedido_id', pedidoId)
      .order('creada_en', { ascending: false }).limit(1).maybeSingle();
    const claveBot = digitos((cot as any)?.telefono);
    // Un pedido de prueba no tiene a quién consultarle si es del botón «Pedido de
    // prueba» (cliente inventado, sin charla). El de un celular probador
    // (20/11/2026: Leandro prueba por WhatsApp que el bot le ofrezca
    // alternativas) sí tiene su charla: a ese se le consulta como a cualquiera.
    if ((p as any).origen === 'simulador' && !claveBot) return null;
    let chat: string; let chatClave: string; let linea: string;
    if (claveBot) {
      chatClave = claveBot;
      // un @lid no es un teléfono: va tal cual (ver comun/whatsapp.ts)
      chat = claveBot.length > 13 ? `${claveBot}@lid` : claveBot;
      linea = String((cot as any)?.linea || (await this.lineas.principal()));
    } else if (telValido) {
      chatClave = telValido;
      chat = telValido;
      linea = await this.lineas.principal();
    } else return null;
    // las charlas del banco de pruebas no son clientes
    if (/^54911000000\d{1,3}$/.test(chatClave)) return null;
    const telefono = (telValido ?? (chatClave.length <= 13 ? chatClave : '')).slice(-10) || null;
    return { chat, chatClave, telefono, linea, sesion: await this.lineas.sesion(linea) };
  }

  /** «Consultar al cliente»: lo propuesto pasa a la cola y sale el primero. */
  async consultar(pedidoId: string, usuarioId?: string | null) {
    const { data: propuestos, error } = await this.db.from('pedidos_reemplazos').select('id').eq('pedido_id', pedidoId).eq('estado', 'propuesto').order('creado_en');
    if (error) throw new BadRequestException(this.migracion(error.message));
    if (!propuestos?.length) throw new BadRequestException('No hay cambios para consultar');
    const destino = await this.destinoDelPedido(pedidoId);
    if (!destino) throw new BadRequestException('No tengo el WhatsApp del cliente. Llamalo y, en cada cambio, anotá lo que te diga.');
    // si ya hay una consulta abierta, los nuevos van al final de la misma
    const { data: ultimo } = await this.db.from('pedidos_reemplazos').select('orden').eq('pedido_id', pedidoId)
      .not('consultado_en', 'is', null).is('cerrado_en', null).order('orden', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    let orden = Number((ultimo as any)?.orden) || 0;
    const ahora = new Date().toISOString();
    for (const r of propuestos as any[]) {
      orden += 1;
      const { error: e } = await this.db.from('pedidos_reemplazos').update({
        estado: 'en_cola', orden, consultado_por: usuarioId ?? null, consultado_en: ahora,
        chat: destino.chat, chat_clave: destino.chatClave, telefono: destino.telefono, linea: destino.linea, sesion: destino.sesion,
        intentos: 0, proximo_intento: null, ultimo_error: null,
      }).eq('id', r.id).eq('estado', 'propuesto');
      if (e) throw new BadRequestException(e.message);
    }
    const r = await this.preguntarSiguiente(pedidoId);
    return { ok: true, cambios: propuestos.length, ...r };
  }

  /**
   * Manda la pregunta que sigue de un pedido, si no hay otra esperando
   * respuesta. Sin nada más en la cola, cierra la consulta.
   */
  async preguntarSiguiente(pedidoId: string): Promise<{ enviado: boolean; esperando?: boolean; motivo?: string; cerrado?: boolean }> {
    if (this.ocupados.has(pedidoId)) return { enviado: false, motivo: 'saliendo' };
    this.ocupados.add(pedidoId);
    try {
      const { data, error } = await this.db.from('pedidos_reemplazos').select(COLUMNAS)
        .eq('pedido_id', pedidoId).not('consultado_en', 'is', null).is('cerrado_en', null).neq('estado', 'anulado').order('orden');
      if (error) throw new Error(error.message);
      const tanda = (data ?? []) as Fila[];
      if (tanda.some((f) => f.estado === 'preguntado')) return { enviado: false, esperando: true };
      const cola = tanda.filter((f) => f.estado === 'en_cola');
      if (!cola.length) {
        // el resumen al cliente y el aviso a quien arma, también de 8 a 22 (la pantalla ya muestra cada respuesta)
        if (!enHorarioDeMensajes()) return { enviado: false, motivo: 'Son más de las 22: el resumen sale a las 8.' };
        const cerrado = await this.cerrar(pedidoId);
        return { enviado: false, cerrado };
      }
      const f = cola[0];
      const { data: ped } = await this.db.from('pedidos').select('estado, qr_retiro, contacto_nombre, cliente:clientes(nombre)').eq('id', pedidoId).maybeSingle();
      if (!ped || !ABIERTOS_PEDIDO.includes(String((ped as any).estado))) {
        await this.db.from('pedidos_reemplazos').update({ estado: 'anulado', ultimo_error: `el pedido ya está ${(ped as any)?.estado ?? 'borrado'}` })
          .eq('pedido_id', pedidoId).in('estado', ['en_cola', 'propuesto']);
        return { enviado: false, motivo: 'el pedido ya no se está armando' };
      }
      if (f.proximo_intento && Date.parse(f.proximo_intento) > Date.now()) return { enviado: false, motivo: 'reintenta en un rato' };
      if (!enHorarioDeMensajes()) return { enviado: false, motivo: 'Son más de las 22: le sale a las 8.' };
      if (!this.puedeMandar(f.sesion)) return { enviado: false, motivo: 'Este servidor no manda WhatsApp (solo el de producción).' };

      const codigo = String((ped as any).qr_retiro || pedidoId.slice(0, 8).toUpperCase());
      const cliente = (ped as any).cliente?.nombre || (ped as any).contacto_nombre || null;
      const numero = tanda.filter((x) => (x.orden ?? 0) <= (f.orden ?? 0)).length;
      const anotado = tanda.some((x) => x.estado === 'aceptado' || x.estado === 'rechazado');
      const texto = textoDePregunta(paraTexto(f), { cliente, codigo, numero, total: tanda.length, anotado });

      const r = await enviarWhatsapp(this.db, { to: f.chat!, sesion: f.sesion, text: texto, origen: 'reemplazo', referencia: `pedido/${pedidoId}` });
      // incierto: lo más probable es que haya salido; repetirlo confunde más que esperar
      if (r.enviado || r.incierto) {
        await this.db.from('pedidos_reemplazos').update({
          estado: 'preguntado', preguntado_en: new Date().toISOString(), waha_id: r.id ?? null, ultimo_error: r.incierto && !r.enviado ? `quizás no salió: ${r.motivo ?? ''}` : null,
        }).eq('id', f.id).eq('estado', 'en_cola');
        await this.anotarEnLaCharla(f, [{ role: 'assistant', content: texto }]);
        this.registrarEnResponde?.(this.waIdDe(f), '', texto).catch(() => null);
        this.log.log(`pedido ${codigo}: pregunta ${numero} de ${tanda.length} enviada (${f.nombre_falta} → ${f.nombre_reemplazo})`);
        return { enviado: true };
      }
      const intentos = (f.intentos ?? 0) + 1;
      await this.db.from('pedidos_reemplazos').update({
        intentos, ultimo_error: r.motivo ?? 'WhatsApp no la mandó', proximo_intento: new Date(Date.now() + Math.min(10, intentos) * 60_000).toISOString(),
      }).eq('id', f.id);
      this.log.warn(`pedido ${codigo}: la pregunta no salió (${r.motivo ?? 'sin motivo'}); reintento ${intentos}`);
      return { enviado: false, motivo: `No salió el WhatsApp (${r.motivo ?? 'sin motivo'}). Lo reintento solo.` };
    } finally {
      this.ocupados.delete(pedidoId);
    }
  }

  // ---------- 3. La respuesta ----------

  /**
   * ¿Es un cliente contestando un cambio? Lo llama el bot ANTES de atender el
   * mensaje como una charla. null: no hay pregunta esperando de este chat.
   * { otra: true }: hay una, pero el mensaje no es un sí ni un no (pregunta
   * algo, pone una condición): lo atiende el bot como siempre y quien arma lo
   * ve en su pantalla.
   */
  async respuestaDelCliente(p: {
    linea: string; clave: string; texto: string; escritoEn?: number;
    /** Sus teléfonos (últimos 10). Se piden solo si hay una pregunta esperando; con `buscar`, se le pregunta a WhatsApp por el de un @lid. */
    candidatos: string[] | ((buscar: boolean) => Promise<string[]>);
  }) {
    const texto = String(p.texto ?? '').trim();
    if (!texto) return null;
    // primero lo barato: ¿hay alguna pregunta esperando en esta línea? (casi siempre no)
    const desde = new Date(Date.now() - DIAS_ESPERA * 86_400_000).toISOString();
    const { data, error } = await this.db.from('pedidos_reemplazos').select(COLUMNAS)
      .eq('estado', 'preguntado').eq('linea', p.linea).gte('preguntado_en', desde).order('preguntado_en', { ascending: false }).limit(20);
    if (error || !data?.length) return null;
    const filas = (data ?? []) as Fila[];
    let f = filas.find((x) => x.chat_clave && x.chat_clave === p.clave);
    if (!f && filas.some((x) => x.telefono)) {
      // pidió por la web o la app y contesta desde un @lid: se lo reconoce por su teléfono
      const tels = async (buscar: boolean) => (typeof p.candidatos === 'function' ? await p.candidatos(buscar) : p.candidatos);
      const de = (c: string[]) => filas.find((x) => x.telefono && c.includes(x.telefono));
      f = de(await tels(false));
      if (!f && typeof p.candidatos === 'function') f = de(await tels(true));
    }
    if (!f) return null;
    // lo que escribió ANTES de que saliera la pregunta no la contesta (un «sí» a otra cosa, un mensaje que
    // llegó tarde). WhatsApp da la hora en segundos: un segundo de tolerancia.
    if (p.escritoEn && f.preguntado_en && p.escritoEn + 1000 < Date.parse(f.preguntado_en)) return null;
    // el pedido ya no se arma (lo cancelaron, lo entregaron): la pregunta ya no vale
    const { data: ped } = await this.db.from('pedidos').select('estado').eq('id', f.pedido_id).maybeSingle();
    if (!ped || !ABIERTOS_PEDIDO.includes(String((ped as any).estado))) {
      await this.db.from('pedidos_reemplazos').update({ estado: 'anulado', ultimo_error: `el pedido ya está ${(ped as any)?.estado ?? 'borrado'}` }).eq('id', f.id).eq('estado', 'preguntado');
      return null;
    }

    // VARIEDAD (20/11/2026): elige una de las que hay, o ninguna
    if (f.tipo === 'variedad') {
      const opciones = f.variedades ?? [];
      let v: { elegida: string } | 'no' | 'otra' | null = leerVariedad(texto, opciones);
      if (!v && soloCortesia(texto)) v = 'otra';
      if (!v && texto.length <= 400) v = await this.leerVariedadConIA(texto, paraTexto(f)).catch((e) => { this.log.warn(`no pude leer la variedad con IA: ${e?.message ?? e}`); return null; });
      if (!v || v === 'otra') {
        await this.db.from('pedidos_reemplazos').update({ otra_respuesta: texto.slice(0, 500), otra_respuesta_en: new Date().toISOString() }).eq('id', f.id);
        this.log.log(`pedido ${f.pedido_id}: el cliente contestó otra cosa sobre ${f.nombre_falta}: «${texto.slice(0, 80)}»`);
        return { otra: true, reemplazoId: f.id };
      }
      await this.anotarEnLaCharla(f, [{ role: 'user', content: texto }]);
      this.registrarEnResponde?.(this.waIdDe(f), texto, null).catch(() => null);
      const elegida = v === 'no' ? null : v.elegida;
      const r = await this.decidir(f.id, !!elegida, { texto, elegida });
      this.log.log(`pedido ${f.pedido_id}: ${f.nombre_falta}${f.pedida ? ` (${f.pedida})` : ''}: el cliente ${elegida ? `eligió ${elegida}` : 'no quiso ninguna'}`);
      return { respondido: true, acepta: !!elegida, elegida, ...r };
    }

    let lectura: 'si' | 'no' | 'otra' | null = leerSiNo(texto);
    // un «gracias» o un saludo solo no contesta (sin gastar IA)
    if (!lectura && soloCortesia(texto)) lectura = 'otra';
    if (!lectura && texto.length <= 400) lectura = await this.leerConIA(texto, paraTexto(f)).catch((e) => { this.log.warn(`no pude leer la respuesta con IA: ${e?.message ?? e}`); return null; });
    if (lectura !== 'si' && lectura !== 'no') {
      await this.db.from('pedidos_reemplazos').update({ otra_respuesta: texto.slice(0, 500), otra_respuesta_en: new Date().toISOString() }).eq('id', f.id);
      this.log.log(`pedido ${f.pedido_id}: el cliente contestó otra cosa sobre ${f.nombre_falta}: «${texto.slice(0, 80)}»`);
      return { otra: true, reemplazoId: f.id };
    }
    await this.anotarEnLaCharla(f, [{ role: 'user', content: texto }]);
    this.registrarEnResponde?.(this.waIdDe(f), texto, null).catch(() => null);
    const r = await this.decidir(f.id, lectura === 'si', { texto });
    this.log.log(`pedido ${f.pedido_id}: el cliente dijo ${lectura.toUpperCase()} a ${f.nombre_reemplazo} (por ${f.nombre_falta})`);
    return { respondido: true, acepta: lectura === 'si', ...r };
  }

  /**
   * El sí o el no: del cliente por WhatsApp (usuarioId vacío) o el que anota
   * quien arma («Lo llamé y dijo que sí»). Aplica el cambio y sigue con la
   * pregunta siguiente.
   */
  async decidir(id: string, acepta: boolean, o: { texto?: string | null; usuarioId?: string | null; pedidoId?: string; elegida?: string | null } = {}) {
    const { data: f } = await this.db.from('pedidos_reemplazos').select('id, pedido_id, producto_id, estado, consultado_en, tipo, pedida, variedades, nombre_falta').eq('id', id).maybeSingle();
    if (!f || (o.pedidoId && (f as any).pedido_id !== o.pedidoId)) throw new BadRequestException('No existe ese cambio');
    // la variedad elegida no cambia producto ni precio: cambia la aclaración del renglón
    // (con «ninguna», sale del pedido como un parecido rechazado: decidir_reemplazo)
    const r = (f as any).tipo === 'variedad' && acepta
      ? await this.aceptarVariedad(f as any, String(o.elegida ?? '').trim(), o)
      : await (async () => {
        const { data, error } = await this.db.rpc('decidir_reemplazo', { p_id: id, p_acepta: acepta, p_respuesta: o.texto ?? null, p_usuario: o.usuarioId ?? null });
        if (error) throw new BadRequestException(this.migracion(error.message));
        return (data ?? {}) as any;
      })();
    // lo consultado sigue con la pregunta siguiente (o cierra); lo que se decidió sin consultar, no manda nada
    const siguiente = (f as any).consultado_en && !r.yaEstaba
      ? await this.preguntarSiguiente(String((f as any).pedido_id)).catch((e) => ({ enviado: false, motivo: String(e?.message ?? e) }))
      : null;
    return { estado: r.estado, error: r.error ?? null, resultado: r.resultado ?? null, siguiente };
  }

  /** Eligió otra variedad: queda anotada en el cambio, en las notas del pedido (la aclaración) y en el historial. */
  private async aceptarVariedad(f: { pedido_id: string; producto_id: string; nombre_falta: string; pedida: string | null; variedades: string[] | null }, elegida: string, o: { texto?: string | null; usuarioId?: string | null }) {
    const opciones = f.variedades ?? [];
    const exacta = opciones.find((v) => v.toLowerCase() === elegida.toLowerCase());
    if (!elegida || (opciones.length && !exacta)) throw new BadRequestException(`Elegí una de las que hay: ${opciones.join(', ')}`);
    const final = exacta ?? elegida;
    const ahora = new Date().toISOString();
    const { data: ped } = await this.db.from('pedidos').select('total, notas').eq('id', f.pedido_id).maybeSingle();
    const total = (ped as any)?.total == null ? null : Number((ped as any).total);
    const resultado = { totalAntes: total, total, variedad: final };
    const { data: tomada, error } = await this.db.from('pedidos_reemplazos').update({
      estado: 'aceptado', elegida: final, respondido_en: ahora, respuesta: String(o.texto ?? '').slice(0, 500) || null, decidido_por: o.usuarioId ?? null, resultado, error: null,
    }).eq('id', (f as any).id ?? '').in('estado', ['propuesto', 'en_cola', 'preguntado']).select('id');
    if (error) throw new BadRequestException(this.migracion(error.message));
    if (!tomada?.length) return { estado: 'aceptado', yaEstaba: true };
    let fallo: string | null = null;
    // la que eligió existe: queda sabida (y vista ahora)
    await this.aprenderVariedades(f.producto_id, [final], o.usuarioId ?? null);
    const { error: eNotas } = await this.db.from('pedidos').update({ notas: cambiarAclaracion((ped as any)?.notas, f.nombre_falta, final) }).eq('id', f.pedido_id);
    if (eNotas) fallo = eNotas.message;
    await this.db.from('pedidos_historial').insert({
      pedido_id: f.pedido_id, evento: 'reemplazo', usuario_id: o.usuarioId ?? null,
      detalle: { acepta: true, falta: `${f.nombre_falta}${f.pedida ? ` (${f.pedida})` : ''}`, reemplazo: `${f.nombre_falta} (${final})`, variedad: true, por_whatsapp: !o.usuarioId, respuesta: String(o.texto ?? '').slice(0, 200) || null },
    }).then(() => null, () => null);
    if (fallo) await this.db.from('pedidos_reemplazos').update({ error: fallo }).eq('id', (f as any).id);
    return { estado: 'aceptado', resultado, error: fallo };
  }

  /** Una respuesta a «¿cuál querés?» que no nombra una sola de las que hay, leída por la IA (Haiku). */
  private async leerVariedadConIA(texto: string, c: CambioParaTexto): Promise<{ elegida: string } | 'no' | 'otra'> {
    const opciones = c.variedades ?? [];
    if (!opciones.length) return 'otra';
    const claude = new Anthropic();
    const r: any = await claude.messages.create({
      model: MODELO_LECTURA,
      max_tokens: 2000,
      thinking: RAZONAMIENTO,
      system: [
        'Un almacén le avisó a un cliente por WhatsApp que no hay la variedad que pidió de un producto y le preguntó cuál de las que hay quiere.',
        'Decidí qué contestó: una de las opciones si elige esa (exactamente una), "no" si no quiere ninguna (que lo saquen),',
        '"otra" si pregunta algo, pone una condición, elige dos, pide algo que no está en la lista, solo saluda o agradece, o no se entiende. Ante la duda, "otra".',
      ].join(' '),
      messages: [{ role: 'user', content: `Pregunta: «${c.nombre_falta}${c.pedida ? ` de ${c.pedida}` : ''} no hay. De ese tenemos: ${opciones.join(', ')}. ¿Cuál querés?»\nRespuesta del cliente: «${texto.slice(0, 400)}»` }],
      output_config: {
        effort: esfuerzo('REEMPLAZOS_ESFUERZO', 'low', { general: false }),
        format: { type: 'json_schema', schema: { type: 'object', properties: { respuesta: { type: 'string', enum: [...opciones, 'no', 'otra'] } }, required: ['respuesta'], additionalProperties: false } },
      },
    } as any);
    if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return 'otra';
    const bloque = (r.content ?? []).find((x: any) => x.type === 'text');
    const v = String(JSON.parse(bloque?.text ?? '{}').respuesta ?? 'otra');
    if (v === 'no') return 'no';
    const elegida = opciones.find((o) => o === v);
    return elegida ? { elegida } : 'otra';
  }

  /** Una respuesta que no es un sí o un no claro, leída por la IA (Haiku). */
  private async leerConIA(texto: string, c: CambioParaTexto): Promise<'si' | 'no' | 'otra'> {
    const claude = new Anthropic();
    const r: any = await claude.messages.create({
      model: MODELO_LECTURA,
      max_tokens: 2000,
      thinking: RAZONAMIENTO,
      system: [
        'Un almacén le preguntó a un cliente por WhatsApp si acepta un reemplazo en su pedido, y que responda SÍ o NO.',
        'Decidí qué contestó: "si" si acepta el reemplazo, "no" si no lo quiere (que lo saquen, que no le manden nada en su lugar),',
        '"otra" si pregunta algo, pone una condición, pide otra cosa distinta, solo saluda o agradece, o no se entiende. Ante la duda, "otra".',
      ].join(' '),
      messages: [{ role: 'user', content: `Pregunta: «${c.nombre_falta} no hay. En su lugar va ${c.cantidad} × ${c.nombre_reemplazo}. ¿Te sirve?»\nRespuesta del cliente: «${texto.slice(0, 400)}»` }],
      output_config: {
        effort: esfuerzo('REEMPLAZOS_ESFUERZO', 'low', { general: false }),
        format: { type: 'json_schema', schema: { type: 'object', properties: { respuesta: { type: 'string', enum: ['si', 'no', 'otra'] } }, required: ['respuesta'], additionalProperties: false } },
      },
    } as any);
    if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') return 'otra';
    const bloque = (r.content ?? []).find((x: any) => x.type === 'text');
    const v = String(JSON.parse(bloque?.text ?? '{}').respuesta ?? 'otra');
    return v === 'si' || v === 'no' ? v : 'otra';
  }

  // ---------- 4. El cierre ----------

  /**
   * Todo contestado: al cliente, cómo queda el pedido; a quien arma, lo que se
   * confirmó (WhatsApp por la cola de avisos, y su pantalla). Una sola vez por tanda.
   */
  private async cerrar(pedidoId: string): Promise<boolean> {
    const { data: cerrados, error } = await this.db.from('pedidos_reemplazos').update({ cerrado_en: new Date().toISOString() })
      .eq('pedido_id', pedidoId).not('consultado_en', 'is', null).is('cerrado_en', null).in('estado', ['aceptado', 'rechazado', 'anulado'])
      .select(COLUMNAS);
    if (error) throw new Error(error.message);
    const cambios = ((cerrados ?? []) as Fila[]).filter((f) => f.estado === 'aceptado' || f.estado === 'rechazado')
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    if (!cambios.length) return false;
    const { data: ped } = await this.db.from('pedidos').select('total, pagado_en, qr_retiro, asignado_a, contacto_nombre, cliente:clientes(nombre)').eq('id', pedidoId).maybeSingle();
    const codigo = String((ped as any)?.qr_retiro || pedidoId.slice(0, 8).toUpperCase());
    const cliente = (ped as any)?.cliente?.nombre || (ped as any)?.contacto_nombre || null;
    const total = (ped as any)?.total == null ? null : Number((ped as any).total);
    const primero = [...cambios].sort((a, b) => Date.parse(a.respondido_en ?? '') - Date.parse(b.respondido_en ?? ''))[0];
    const totalAntes = primero?.resultado?.totalAntes != null ? Number(primero.resultado.totalAntes) : null;
    const pagado = !!(ped as any)?.pagado_en || String((ped as any)?.qr_retiro ?? '').startsWith('PY-');

    // al cliente, si se le preguntó por WhatsApp
    const porChat = cambios.find((f) => f.preguntado_en && f.chat);
    if (porChat && enHorarioDeMensajes() && this.puedeMandar(porChat.sesion)) {
      const texto = textoDeCierre(cambios.map(respondido), { cliente, codigo, total });
      const r = await enviarWhatsapp(this.db, { to: porChat.chat!, sesion: porChat.sesion, text: texto, origen: 'reemplazo', referencia: `pedido/${pedidoId}` });
      if (r.enviado || r.incierto) {
        await this.anotarEnLaCharla(porChat, [{ role: 'assistant', content: texto }]);
        this.registrarEnResponde?.(this.waIdDe(porChat), '', texto).catch(() => null);
      } else this.log.warn(`pedido ${codigo}: el resumen al cliente no salió (${r.motivo ?? 'sin motivo'})`);
    }

    // a quien arma (o a quien consultó). Si todo lo anotó él mismo, ya lo sabe: no hace falta el WhatsApp.
    const usuarioId = (ped as any)?.asignado_a || cambios.find((f) => f.consultado_por)?.consultado_por || null;
    if (usuarioId && cambios.some((f) => f.respondido_en && !f.decidido_por)) {
      const { data: u } = await this.db.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle();
      const texto = textoParaQuienArma(cambios.map(respondido), { cliente, codigo, total, totalAntes, pagado, link: linkDelSalon() });
      await this.encolarAvisoAQuienArma(pedidoId, usuarioId, (u as any)?.nombre ?? null, texto)
        .catch((e) => this.log.error(`pedido ${codigo}: no pude encolar el aviso de cambios confirmados: ${e instanceof Error ? e.message : e}`));
    }
    this.log.log(`pedido ${codigo}: cambios cerrados (${cambios.map((c) => `${c.nombre_falta}: ${c.estado}`).join(', ')})`);
    return true;
  }

  /** Un aviso por pedido (como «PEDIDO PARA ARMAR»): si hay otra tanda, se rearma. */
  private async encolarAvisoAQuienArma(pedidoId: string, usuarioId: string, nombre: string | null, texto: string) {
    const detalle = { usuario_id: usuarioId, nombre, texto };
    const { data: previo, error } = await this.db.from('avisos_pedidos').select('id').eq('pedido_id', pedidoId).eq('tipo', 'cambios_respondidos').maybeSingle();
    if (error) throw new Error(error.message);
    if (!previo) {
      const { error: e } = await this.db.from('avisos_pedidos').insert({ pedido_id: pedidoId, tipo: 'cambios_respondidos', detalle });
      if (e) throw new Error(e.message);
      return;
    }
    const ahora = new Date().toISOString();
    const { error: e } = await this.db.from('avisos_pedidos').update({
      detalle, estado: 'pendiente', pendiente_desde: ahora, proximo_intento: ahora, intentos: 0, tomado_hasta: null,
      destino: null, waha_id: null, waha_ids: [], enviado_en: null, entregado_en: null, ack: null, incierto: false, ultimo_error: null, motivo: null,
    }).eq('id', (previo as any).id);
    if (e) throw new Error(e.message);
  }

  // ---------- La charla ----------

  private waIdDe(f: Fila): string {
    return String(f.chat ?? '').endsWith('@lid') ? String(f.chat) : String(f.chat_clave ?? f.chat ?? '');
  }

  /** La pregunta y la respuesta quedan en la charla: si el cliente escribe otra cosa, el bot sabe qué se le preguntó. */
  private async anotarEnLaCharla(f: Fila, mensajes: { role: 'user' | 'assistant'; content: string }[]) {
    if (!f.linea || !f.chat_clave) return;
    try {
      const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes').eq('linea', f.linea).eq('telefono', f.chat_clave).maybeSingle();
      const hist: any[] = Array.isArray((conv as any)?.mensajes) ? (conv as any).mensajes : [];
      const en = new Date().toISOString();
      // dos del mismo lado seguidos rompen el hilo del modelo: se juntan
      const nuevos = [...hist];
      for (const m of mensajes) {
        const ult = nuevos[nuevos.length - 1];
        if (ult && ult.role === m.role && typeof ult.content === 'string' && !ult.de) nuevos[nuevos.length - 1] = { ...ult, content: `${ult.content}\n\n${m.content}` };
        else nuevos.push({ role: m.role, content: m.content, en });
      }
      await this.db.from('bot_conversaciones').upsert({ linea: f.linea, telefono: f.chat_clave, mensajes: nuevos.slice(-40), actualizado_en: en }, { onConflict: 'linea,telefono' });
    } catch (e) {
      this.log.warn(`no pude anotar en la charla ${f.chat_clave}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------- La cola ----------

  /** Lo que quedó en cola (de noche, o porque no salió) sale solo; y lo contestado se cierra. */
  @Cron('*/20 * * * * *')
  async vuelta() {
    if (this.enVuelta || process.env.ODB_AVISOS_PEDIDOS !== '1' || !enHorarioDeMensajes()) return;
    this.enVuelta = true;
    try {
      const { data, error } = await this.db.from('pedidos_reemplazos').select('pedido_id')
        .not('consultado_en', 'is', null).is('cerrado_en', null).in('estado', ['en_cola', 'aceptado', 'rechazado']).limit(100);
      if (error) return;
      for (const id of new Set(((data ?? []) as any[]).map((f) => String(f.pedido_id)))) {
        await this.preguntarSiguiente(id).catch((e) => this.log.warn(`cola de cambios ${id}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.enVuelta = false;
    }
  }

  private migracion(mensaje: string) {
    return /pedidos_reemplazos|proponer_reemplazo|decidir_reemplazo|precios_en_pedido/.test(mensaje)
      ? 'Falta aplicar la migración de cambios con el cliente (db/migracion-reemplazos-cliente.sql)'
      : mensaje;
  }
}

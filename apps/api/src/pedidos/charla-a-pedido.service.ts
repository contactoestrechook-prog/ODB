import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { SUPABASE } from '../supabase.provider';
import { esfuerzo, jsonDe, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { conRelevo, relevoMs } from '../comun/relevo-ia';
import { PedidosService } from './pedidos.service';
import { faltasEnSistema, lineaDeFalta, stockDe } from './sin-stock';
import {
  autorDe, codigoDePedido, fechaValida, normalizarArmado, notasDelPedido, precioDistinto, resumenDeCharla, textoDelMensaje, transcripcion,
  type ArmadoDeCharla, type MensajeCharla,
} from './charla-a-pedido';

// PASAR A PEDIDO DESDE LA CHARLA (14/11/2026): ver charla-a-pedido.ts.
//
// El pedido queda enlazado a su charla con una fila en bot_cotizaciones
// (confirmada y con pedido_id), como los que cierra el bot. Así: la lista sabe
// que esa charla ya tiene pedido, el aviso a administración dice de qué chat y
// línea viene, el bot no avisa «pedido sin cargar» por esa charla y un
// comprobante que llegue después no crea otro pedido.

const HORAS_DE_CHARLAS = 36;
const DIGITOS = /^\d{6,20}$/;

const ESQUEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          producto: { type: 'string' },
          cantidad: { type: 'number' },
          precioDicho: { type: ['number', 'null'] },
        },
        required: ['producto', 'cantidad', 'precioDicho'],
        additionalProperties: false,
      },
    },
    nombre: { type: ['string', 'null'] },
    tipo: { anyOf: [{ type: 'string', enum: ['retiro', 'envio'] }, { type: 'null' }] },
    direccion: { type: ['string', 'null'] },
    entregaFecha: { type: ['string', 'null'] },
    franja: { type: ['string', 'null'] },
    formaPago: { anyOf: [{ type: 'string', enum: ['efectivo', 'transferencia', 'tarjeta', 'mercadopago'] }, { type: 'null' }] },
    recibe: { type: ['string', 'null'] },
    notas: { type: ['string', 'null'] },
    dudas: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'nombre', 'tipo', 'direccion', 'entregaFecha', 'franja', 'formaPago', 'recibe', 'notas', 'dudas'],
  additionalProperties: false,
};

const INSTRUCCIONES = `Sos quien carga en el sistema los pedidos que un almacén premium de Canning (bebidas, fiambrería, almacén) cerró por WhatsApp. Te paso la charla con un cliente: escriben el cliente, el bot de la casa y a veces una persona de la casa desde el teléfono.

Armá EL PEDIDO QUE SE ESTÁ CERRANDO AHORA, el de lo último que se habló. Si en la charla hay pedidos viejos ya entregados o cerrados, no los mezcles.
- items: cada producto con la cantidad FINAL que quedó (si sumó, sacó o cambió algo, lo último manda). En «producto» escribí el producto como lo nombró la casa en la lista (marca, variedad y medida), no como lo escribió suelto el cliente. Las cajas o packs: la cantidad de unidades que se llevan si la charla lo dice («5 cajas de 6» son 30 unidades). precioDicho: el precio POR UNIDAD que la casa le pasó al cliente en la charla para ese producto, o null si no se dijo.
- nombre: el nombre del cliente (o de quien retira o recibe) si aparece.
- tipo: «envio» si se lo llevan, «retiro» si lo pasa a buscar, null si no se habló.
- direccion: la dirección de entrega completa como quedó (barrio, lote, calle y número), o null.
- entregaFecha: AAAA-MM-DD si se acordó un día («el lunes» → la fecha de ese lunes a partir de HOY), o null. franja: «mañana», «tarde» o el horario acordado, o null.
- formaPago: efectivo, transferencia, tarjeta o mercadopago si lo dijo, o null.
- recibe: quién lo recibe si es otra persona, o null.
- notas: solo lo que necesita quien prepara o entrega y no entra en los otros campos (factura A con CUIT, dejar en la guardia, timbre), en una frase, o null.
- dudas: hasta 4, solo lo que NO quedó claro y cambia lo que se carga (un precio que la casa dijo distinto, una cantidad dudosa, si no se sabe si confirmó, un dato de entrega que falta). Frases cortas. Vacío si está todo claro.
No inventes productos ni cantidades: si la charla no tiene un pedido, devolvé items vacío y explicalo en dudas.`;

@Injectable()
export class CharlaAPedidoService {
  private readonly log = new Logger('CharlaAPedido');
  private readonly claude = new Anthropic();
  private memo: { hasta: number; datos: any[] } | null = null;

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly pedidos: PedidosService,
  ) {}

  /** Las charlas de las últimas horas, cada una con lo último que se dijo y si ya tiene pedido. */
  async charlas() {
    if (this.memo && this.memo.hasta > Date.now()) return this.memo.datos;
    const desde = new Date(Date.now() - HORAS_DE_CHARLAS * 3600_000).toISOString();
    const { data: convs, error } = await this.db
      .from('bot_conversaciones')
      .select('linea, telefono, mensajes, actualizado_en')
      .gte('actualizado_en', desde)
      .neq('linea', 'proveedores')
      .order('actualizado_en', { ascending: false })
      .limit(80);
    if (error) throw new BadRequestException(error.message);
    const filas = ((convs ?? []) as any[]).filter((c) => DIGITOS.test(String(c.telefono ?? '')));
    const tels = [...new Set(filas.map((c) => String(c.telefono)))];
    const [contactos, cotizaciones] = tels.length
      ? await Promise.all([
          this.db.from('bot_contactos').select('telefono, lid, nombre, nombre_wa, telefono_real, es_equipo, tipo').or(`telefono.in.(${tels.join(',')}),lid.in.(${tels.join(',')})`),
          this.db.from('bot_cotizaciones').select('linea, telefono, pedido_id, confirmada_en, pedidos(qr_retiro, estado)').in('telefono', tels).not('pedido_id', 'is', null).gte('confirmada_en', desde),
        ])
      : [{ data: [] }, { data: [] }];
    const contactoDe = new Map<string, any>();
    for (const k of ((contactos as any).data ?? []) as any[]) {
      if (k.telefono) contactoDe.set(String(k.telefono), k);
      if (k.lid) contactoDe.set(String(k.lid), k);
    }
    const pedidoDe = new Map<string, any>();
    for (const q of ((cotizaciones as any).data ?? []) as any[]) {
      const clave = `${q.linea}:${q.telefono}`;
      const previo = pedidoDe.get(clave);
      if (!previo || String(q.confirmada_en) > String(previo.confirmada_en)) pedidoDe.set(clave, q);
    }
    const datos = filas
      .map((c) => {
        const k = contactoDe.get(String(c.telefono));
        if (k?.es_equipo || k?.tipo === 'proveedor') return null;
        const r = resumenDeCharla((c.mensajes ?? []) as MensajeCharla[]);
        if (!r.mensajesCliente) return null;
        const q = pedidoDe.get(`${c.linea}:${c.telefono}`);
        return {
          linea: String(c.linea),
          telefono: String(c.telefono),
          nombre: String(k?.nombre ?? '').trim() || String(k?.nombre_wa ?? '').trim() || null,
          telefonoReal: k?.telefono_real ?? (/^549?\d{10}$/.test(String(c.telefono)) ? String(c.telefono) : null),
          actualizadoEn: c.actualizado_en,
          ...r,
          pedido: q ? { id: q.pedido_id, codigo: q.pedidos?.qr_retiro ?? null, estado: q.pedidos?.estado ?? null, en: q.confirmada_en } : null,
        };
      })
      .filter(Boolean);
    this.memo = { hasta: Date.now() + 20_000, datos };
    return datos;
  }

  private async conversacion(linea: string, telefono: string) {
    if (!DIGITOS.test(telefono) || !/^[a-z][a-z0-9_]{1,29}$/.test(linea)) throw new BadRequestException('Charla inválida');
    const { data, error } = await this.db.from('bot_conversaciones').select('linea, telefono, mensajes, actualizado_en').eq('linea', linea).eq('telefono', telefono).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('No encontré esa charla');
    const { data: k } = await this.db.from('bot_contactos').select('nombre, nombre_wa, telefono_real').or(`telefono.eq.${telefono},lid.eq.${telefono}`).limit(1).maybeSingle();
    return { mensajes: ((data as any).mensajes ?? []) as MensajeCharla[], contacto: k as any, ultimoEn: (data as any).actualizado_en as string | null };
  }

  /** La IA lee la charla y arma el pedido; se matchea con el catálogo. No crea nada. */
  async armar(linea: string, telefono: string) {
    const { mensajes, contacto, ultimoEn } = await this.conversacion(linea, telefono);
    const charla = transcripcion(mensajes);
    if (!charla) throw new BadRequestException('La charla está vacía');
    const hoy = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    const hoyIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    const nombreAgendado = String(contacto?.nombre ?? contacto?.nombre_wa ?? '').trim();
    // «hoy» y «mañana» de la charla se cuentan desde su último mensaje, no desde
    // que se la pasa a pedido (la Coca Zero del 13/11 se leyó el 14 como «hoy»)
    const ultimoMensaje = ultimoEn
      ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ultimoEn))
      : null;
    const t0 = Date.now();
    const espera = relevoMs('ODB_CHARLA_PEDIDO_RELEVO', 45);
    const { valor: r } = await conRelevo<any>(
      (signal) => this.claude.messages.stream({
        model: MODELO_PRINCIPAL,
        max_tokens: 16000,
        thinking: RAZONAMIENTO,
        system: [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: ESQUEMA as any }, effort: esfuerzo('ODB_ESFUERZO_CHARLA_PEDIDO', 'medium', { general: false }) },
        messages: [{ role: 'user', content: `HOY es ${hoy} (${hoyIso}).${ultimoMensaje ? ` El último mensaje de la charla es del ${ultimoMensaje}: el «hoy», «mañana» o «el lunes» que se dicen en la charla se cuentan desde ese día.` : ''}${nombreAgendado ? ` El contacto está agendado como «${nombreAgendado}».` : ''}\n\nLA CHARLA:\n${charla}` }],
      } as any, { signal }).finalMessage(),
      { relevoMs: espera, alRelevar: () => this.log.warn(`charla ${linea}/${telefono}: la IA lleva ${espera / 1000} s sin contestar, sale un segundo pedido`) },
    ).catch((e: any) => {
      this.log.error(`no pude leer la charla ${linea}/${telefono}: ${e?.message ?? e}`);
      throw new BadRequestException('La IA no pudo leer la charla. Probá de nuevo en un momento.');
    });
    const armado: ArmadoDeCharla = normalizarArmado(jsonDe(r, 'El pedido de la charla'));
    const { matched, sinMatch } = await this.pedidos.matchearRenglones(armado.items.map((i) => ({ name: i.producto, quantity: i.cantidad })));
    const dichoDe = new Map(armado.items.map((i) => [i.producto, i.precioDicho]));
    // cuánto hay en la sucursal del retiro (20/11/2026): lo que no alcanza se ve antes de crear
    const suc: any = await this.pedidos.sucursalPickup().catch(() => null);
    const stock = suc?.id ? await stockDe(this.db, matched.map((m: any) => String(m.producto_id))).catch(() => null) : null;
    const items = matched.map((m: any) => {
      const precioDicho = dichoDe.get(m.pedido) ?? null;
      const hay = stock ? stock.get(`${m.producto_id}|${suc.id}`) ?? 0 : null;
      return { ...m, precioDicho, precioDistinto: precioDistinto(precioDicho, m.precio), hay };
    });
    const u: any = r?.usage ?? {};
    this.log.log(`charla ${linea}/${telefono} leída en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${items.length} productos · ${sinMatch.length} sin encontrar · entrada ${u.input_tokens ?? '?'} · salida ${u.output_tokens ?? '?'}`);
    return {
      linea, telefono,
      telefonoReal: contacto?.telefono_real ?? null,
      nombre: armado.nombre ?? (nombreAgendado || null),
      tipo: armado.tipo, direccion: armado.direccion, entregaFecha: armado.entregaFecha, franja: armado.franja,
      formaPago: armado.formaPago, recibe: armado.recibe, notas: armado.notas, dudas: armado.dudas,
      items, sinMatch,
      // para leerla al lado mientras se revisa
      charla: mensajes.slice(-40).map((m) => ({ de: autorDe(m), texto: textoDelMensaje(m).slice(0, 600) })).filter((x) => x.texto),
    };
  }

  /** Crea el pedido revisado por la persona. Queda SIN TOMAR: suena en las cajas. */
  async crear(
    b: {
      linea: string; telefono: string;
      items: { producto_id: string; cantidad: number; precioDicho?: number | null; nombre?: string; precio?: number | null }[];
      nombre?: string | null; tipo?: string | null; direccion?: string | null; entregaFecha?: string | null; franja?: string | null;
      formaPago?: string | null; recibe?: string | null; notas?: string | null; sinMatch?: string[]; telefonoReal?: string | null;
    },
    usuario: { sub?: string; nombre?: string } = {},
  ) {
    const linea = String(b?.linea ?? '');
    const telefono = String(b?.telefono ?? '');
    if (!DIGITOS.test(telefono) || !/^[a-z][a-z0-9_]{1,29}$/.test(linea)) throw new BadRequestException('Charla inválida');
    const items = (Array.isArray(b.items) ? b.items : [])
      .map((i) => ({ ...i, producto_id: String(i?.producto_id ?? ''), cantidad: Number(i?.cantidad) }))
      .filter((i) => /^[0-9a-f-]{36}$/i.test(i.producto_id) && Number.isFinite(i.cantidad) && i.cantidad > 0 && i.cantidad <= 9999);
    if (!items.length) throw new BadRequestException('El pedido no tiene productos');
    const tipo: 'retiro' | 'envio' = b.tipo === 'envio' ? 'envio' : 'retiro';
    const direccion = String(b.direccion ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    if (tipo === 'envio' && !direccion) throw new BadRequestException('Falta la dirección de entrega');

    // dos toques seguidos (o dos personas a la vez) no crean dos pedidos
    const { data: reciente } = await this.db.from('bot_cotizaciones').select('pedido_id, pedidos(qr_retiro)')
      .eq('linea', linea).eq('telefono', telefono).not('pedido_id', 'is', null)
      .gte('confirmada_en', new Date(Date.now() - 10 * 60_000).toISOString()).limit(1).maybeSingle();
    if (reciente) throw new BadRequestException(`Esta charla ya se pasó a pedido hace un momento (${(reciente as any).pedidos?.qr_retiro ?? 'ver Pedidos'}).`);

    const suc: any = await this.pedidos.sucursalPickup();
    if (!suc?.id) throw new BadRequestException('No hay sucursal con retiro configurada');
    const id = randomUUID();
    const codigo = codigoDePedido(id, tipo);
    const preciosDichos = items
      .filter((i) => precioDistinto(i.precioDicho ?? null, i.precio ?? null))
      .map((i) => ({ producto: String(i.nombre ?? 'un producto'), dicho: Number(i.precioDicho), sistema: i.precio ?? null }));
    // qué no alcanza, con nombre (antes decía solo «no alcanzaba» y nadie sabía qué)
    const stock = await stockDe(this.db, items.map((i) => i.producto_id)).catch(() => null);
    const sinStock = stock
      ? faltasEnSistema(items.map((i) => ({ productoId: i.producto_id, nombre: String(i.nombre ?? 'un producto'), cantidad: i.cantidad })), (pid) => stock.get(`${pid}|${suc.id}`) ?? 0)
      : [];
    const armarNotas = (sinReserva: boolean) => notasDelPedido({
      recibe: b.recibe ?? null, notas: b.notas ?? null, sinMatch: (b.sinMatch ?? []).map(String).slice(0, 10), preciosDichos, sinReserva,
      sinStock: sinStock.map(lineaDeFalta),
    });
    const canal = tipo === 'envio' ? 'domicilio' : 'pickup';
    const renglones = items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad }));
    // reserva el stock como los del bot; si no alcanza, el pedido entra igual (se avisa en las notas)
    let pedidoId: string;
    let sinReserva = false;
    try {
      pedidoId = await this.pedidos.crear({ canal, sucursalId: suc.id, items: renglones, referencia: codigo, notas: armarNotas(false) || undefined, reservar: true });
    } catch (e: any) {
      if (!/stock/i.test(String(e?.message ?? ''))) throw e;
      sinReserva = true;
      pedidoId = await this.pedidos.crear({ canal, sucursalId: suc.id, items: renglones, referencia: codigo, notas: armarNotas(true) || undefined, reservar: false });
    }
    const ahora = new Date().toISOString();
    const nombre = String(b.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
    const telReal = /^549?\d{10}$/.test(String(b.telefonoReal ?? '')) ? String(b.telefonoReal) : /^549?\d{10}$/.test(telefono) ? telefono : null;
    const formaPago = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago'].includes(String(b.formaPago)) ? String(b.formaPago) : null;
    const { error: eDatos } = await this.db.from('pedidos').update({
      origen: 'charla',
      contacto_nombre: nombre,
      contacto_telefono: telReal,
      destino_direccion: tipo === 'envio' ? direccion : null,
      entrega_fecha: fechaValida(b.entregaFecha),
      entrega_franja: String(b.franja ?? '').trim().slice(0, 60) || null,
      forma_pago: formaPago,
      // SIN tomado_por: entra como cualquier pedido nuevo y suena en las cajas
      ...(usuario.sub ? { creado_por: usuario.sub, cambio_por: usuario.sub, cambio_en: ahora } : {}),
    }).eq('id', pedidoId);
    if (eDatos) this.log.warn(`no pude completar los datos del pedido ${codigo}: ${eDatos.message}`);

    const { data: ped } = await this.db.from('pedidos').select('total').eq('id', pedidoId).maybeSingle();
    const { error: eEnlace } = await this.db.from('bot_cotizaciones').insert({
      id, linea, telefono, sucursal_id: suc.id,
      items: items.map((i) => ({ producto_id: i.producto_id, nombre: i.nombre ?? null, cantidad: i.cantidad, precioUnitario: i.precio ?? null })),
      total: Number((ped as any)?.total) || 0,
      tipo: canal, direccion: tipo === 'envio' ? direccion : null, nombre,
      notas: formaPago ? `Paga con ${formaPago}` : null,
      entrega_fecha: fechaValida(b.entregaFecha), entrega_franja: String(b.franja ?? '').trim().slice(0, 60) || null,
      resumen: `Pasado a pedido desde la charla en el panel${usuario.nombre ? ` por ${usuario.nombre}` : ''}`,
      vence_en: ahora, pedido_id: pedidoId,
      confirmacion: `charla: ${usuario.nombre ?? 'panel'}`.slice(0, 120), confirmada_en: ahora,
    });
    if (eEnlace) this.log.warn(`el pedido ${codigo} quedó creado pero sin enlace a la charla ${linea}/${telefono}: ${eEnlace.message}`);
    this.memo = null;
    this.log.log(`charla ${linea}/${telefono} pasada a pedido ${codigo}${sinReserva ? ' (sin reserva de stock)' : ''}${usuario.nombre ? ` por ${usuario.nombre}` : ''}`);
    return { pedidoId, codigo, sinReserva, sinStock };
  }
}

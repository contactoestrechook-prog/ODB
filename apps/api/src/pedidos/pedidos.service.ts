import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';
import { transicionValida } from './transiciones';
import { verificarFirmaMercadoPago } from '../comun/firmas';
import { fetchConTimeout } from '../comun/http';
import { celularWhatsapp, enviarTextoWhatsapp } from '../comun/whatsapp';
import { Lineas } from '../comun/lineas';

// Radio (m) para considerar que el cliente "está llegando" y asignarle estacionamiento.
const GEOFENCE_M = 400;

// Distancia entre dos coordenadas en metros (haversine).
function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const t = (g: number) => (g * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLng = t(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Pipeline de pedidos externos (PedidosYa, web, pick-up).
// El canal real se codifica en el prefijo de la referencia (PY- / WEB- / PICKUP-)
// hasta aplicar db/migracion-pedidos.sql (suma 'pedidosya' al enum y funciones atómicas).

export type ItemPedidoYa = {
  sku?: string;
  name: string;
  quantity: number;
};

export type PedidoYaPayload = {
  orderId: string | number;
  customer?: { name?: string; dni?: string };
  items: ItemPedidoYa[];
  notes?: string;
};

// Velocidad urbana promedio para estimar el ETA del repartidor (~22 km/h)
const METROS_POR_MIN = 360;

// Por dónde entró un pedido (6/10/2026). Los nuevos lo traen en pedidos.origen;
// los viejos se deducen del código (PY-, TN-, WA-) como hacía la cola.
export type OrigenPedido = 'bot' | 'web' | 'app' | 'panel' | 'pedidosya' | 'tiendanube';
export function origenDe(p: { origen?: string | null; qr_retiro?: string | null; canal?: string | null }): string {
  if (p.origen) return p.origen;
  const qr = String(p.qr_retiro ?? '');
  if (qr.startsWith('PY-')) return 'pedidosya';
  if (qr.startsWith('TN-')) return 'tiendanube';
  if (qr.startsWith('WA-') || p.canal === 'whatsapp') return 'panel';
  return String(p.canal ?? 'otro');
}

const NOMBRE_ORIGEN: Record<string, string> = {
  bot: 'el WhatsApp de la casa (bot)',
  web: 'la tienda web',
  app: 'la app',
  panel: 'el panel (cargado a mano)',
  pedidosya: 'PedidosYa',
  tiendanube: 'Tiendanube',
  pickup: 'la tienda web o la app',
  domicilio: 'la tienda web o la app',
};
export const ETIQUETA_ESTADO: Record<string, string> = {
  recibido: 'Recibido',
  pagado: 'Pagado',
  en_preparacion: 'Empezó a prepararlo',
  listo: 'Lo marcó listo',
  en_camino: 'Salió a entregarlo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** El WhatsApp que deja quien compra sin cuenta: 10 dígitos argentinos (con o sin 0, 15 o +54). null si no sirve. */
export function telefonoDeContacto(crudo: unknown): string | null {
  const d = celularWhatsapp(String(crudo ?? ''));
  return /^549\d{10}$/.test(d) ? d : null;
}

@Injectable()
export class PedidosService {
  private readonly claude = new Anthropic();
  private readonly log = new Logger(PedidosService.name);
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  // --- Geolocalización pick-up: el cliente reporta su posición; si está cerca,
  //     se le asigna un estacionamiento libre y se le avisa. ---
  async reportarUbicacion(pedidoId: string, lat: number, lng: number) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      throw new BadRequestException('Ubicación inválida');
    }
    const { data: p } = await this.db
      .from('pedidos')
      .select('id, estado, canal, cliente_id, estacionamiento, sucursal:sucursales(nombre, lat, lng, direccion)')
      .eq('id', pedidoId)
      .single();
    if (!p) throw new BadRequestException('No existe el pedido');
    const suc: any = p.sucursal;
    if (!suc?.lat || !suc?.lng) return this.estadoSeguimiento(p, null);

    const dist = distanciaM(Number(lat), Number(lng), Number(suc.lat), Number(suc.lng));
    await this.db.from('pedidos').update({ cliente_lat: lat, cliente_lng: lng, distancia_m: dist }).eq('id', pedidoId);

    const activo = !['entregado', 'cancelado'].includes(p.estado);
    let estac: number | null = p.estacionamiento ?? null;
    // El estacionamiento es solo para pick-up (no para domicilio).
    if (p.canal === 'pickup' && activo && estac == null && dist <= GEOFENCE_M) {
      const { data: num } = await this.db.rpc('asignar_estacionamiento', { p_pedido: pedidoId });
      estac = (num as number) ?? null;
      if (estac != null && p.cliente_id) {
        await this.notificar.aCliente(
          p.cliente_id,
          `Llegaste 🚗 Estacioná en el N° ${estac}`,
          `Dejá el auto en el estacionamiento ${estac} de ${suc.nombre} y te llevamos tu pedido.`,
          'pickup',
        );
      }
    }
    return this.estadoSeguimiento({ ...p, estacionamiento: estac }, dist);
  }

  async seguimiento(pedidoId: string) {
    const { data: p } = await this.db
      .from('pedidos')
      .select(`id, estado, canal, estacionamiento, distancia_m,
               destino_direccion, destino_lat, destino_lng,
               repartidor_id, repartidor_lat, repartidor_lng, repartidor_en,
               sucursal:sucursales(nombre, lat, lng, direccion)`)
      .eq('id', pedidoId)
      .single();
    if (!p) throw new BadRequestException('No existe el pedido');
    if (p.canal === 'domicilio') return this.seguimientoDomicilio(p);
    return this.estadoSeguimiento(p, p.distancia_m ?? null);
  }

  private estadoSeguimiento(p: any, dist: number | null) {
    const suc: any = p.sucursal;
    return {
      tipo: 'pickup',
      estado: p.estado,
      distancia_m: dist,
      llegando: dist != null && dist <= GEOFENCE_M,
      estacionamiento: p.estacionamiento ?? null,
      sucursal: suc ? { nombre: suc.nombre, direccion: suc.direccion, lat: suc.lat, lng: suc.lng } : null,
    };
  }

  private async seguimientoDomicilio(p: any) {
    let repartidor: any = null;
    if (p.repartidor_id) {
      const { data: u } = await this.db.from('usuarios').select('nombre').eq('id', p.repartidor_id).maybeSingle();
      repartidor = { nombre: u?.nombre ?? 'Repartidor', lat: p.repartidor_lat, lng: p.repartidor_lng, en: p.repartidor_en };
    }
    let distancia: number | null = null;
    let etaMin: number | null = null;
    if (p.repartidor_lat != null && p.destino_lat != null) {
      distancia = distanciaM(Number(p.repartidor_lat), Number(p.repartidor_lng), Number(p.destino_lat), Number(p.destino_lng));
      etaMin = Math.max(1, Math.round(distancia / METROS_POR_MIN));
    }
    const suc: any = p.sucursal;
    return {
      tipo: 'domicilio',
      estado: p.estado,
      destino: { direccion: p.destino_direccion, lat: p.destino_lat, lng: p.destino_lng },
      repartidor,
      distancia_m: distancia,
      etaMin,
      sucursal: suc ? { nombre: suc.nombre, lat: suc.lat, lng: suc.lng } : null,
    };
  }

  async estacionamientos(sucursalId?: string) {
    let q = this.db
      .from('estacionamientos')
      .select('numero, ocupado, asignado_en, sucursal:sucursales(nombre), pedido:pedidos(id, qr_retiro, cliente:clientes(nombre, dni))')
      .order('numero');
    if (sucursalId) q = q.eq('sucursal_id', sucursalId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // --- Recepción desde PedidosYa (webhook o simulador) ---
  async recibirDePedidosYa(payload: PedidoYaPayload, opciones: { simulado?: boolean } = {}) {
    const referencia = `PY-${payload.orderId}`;
    const { data: existente } = await this.db
      .from('pedidos')
      .select('id')
      .eq('qr_retiro', referencia)
      .maybeSingle();
    if (existente) return { pedidoId: existente.id, duplicado: true };

    // matching de renglones contra el catálogo
    const items: { producto_id: string; cantidad: number }[] = [];
    const sinMatch: string[] = [];
    for (const item of payload.items ?? []) {
      let productoId: string | null = null;
      if (item.sku) {
        const { data } = await this.db
          .from('productos')
          .select('id')
          .eq('sku', item.sku)
          .maybeSingle();
        productoId = data?.id ?? null;
      }
      if (!productoId && item.name) {
        const { data } = await this.db
          .rpc('buscar_producto_similar', { p_texto: item.name })
          .maybeSingle();
        if (data) {
          const { data: prod } = await this.db
            .from('productos')
            .select('id')
            .eq('sku', (data as any).sku)
            .single();
          productoId = prod?.id ?? null;
        }
      }
      if (productoId) items.push({ producto_id: productoId, cantidad: Number(item.quantity) });
      else sinMatch.push(item.name);
    }
    if (!items.length) {
      throw new BadRequestException(
        `Ningún renglón del pedido matcheó con el catálogo: ${sinMatch.join(', ')}`,
      );
    }

    const { data: suc } = await this.db
      .from('sucursales')
      .select('id')
      .order('nombre')
      .limit(1)
      .single();

    const pedidoId = await this.crear({
      canal: 'web', // TODO(migracion-pedidos): 'pedidosya' cuando esté el enum
      sucursalId: suc!.id,
      items,
      clienteDni: payload.customer?.dni,
      referencia,
      notas: [payload.customer?.name, payload.notes, sinMatch.length ? `SIN MATCHEAR: ${sinMatch.join(', ')}` : null]
        .filter(Boolean)
        .join(' · '),
      reservar: false,
    });
    // El simulador del panel es una prueba: no se le avisa a administración
    // (la base deja el aviso pendiente y se toma recién a los 10 segundos).
    if (opciones.simulado) {
      await this.db.from('avisos_pedidos').update({ estado: 'omitido', motivo: 'simulador de PedidosYa (prueba)' }).eq('pedido_id', pedidoId).then(() => null, () => null);
    }
    return { pedidoId, renglones: items.length, sinMatch };
  }

  // --- Pedido por WhatsApp: el cliente escribe en lenguaje natural, la IA arma el pedido ---
  private async parsearWhatsApp(texto: string) {
    const ESQ = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' } }, required: ['name', 'quantity'], additionalProperties: false } },
        nombre: { type: ['string', 'null'] },
        notas: { type: ['string', 'null'] },
      },
      required: ['items', 'nombre', 'notas'],
      additionalProperties: false,
    };
    const PROMPT = `Sos quien toma pedidos por WhatsApp de un comercio de bebidas, fiambrería y almacén en Argentina. Del mensaje del cliente extraé: items (cada PRODUCTO pedido: name = lo que pidió tal cual, quantity = cantidad; si no aclara cantidad poné 1; "una docena"=12, "un cajón/caja"=1), nombre del cliente si aparece, y notas (aclaraciones de entrega, dirección, horario, forma de pago). Ignorá saludos y charla. Si pide algo sin cantidad clara igual incluilo con quantity 1.`;
    const r = await this.claude.messages
      .stream({ model: 'claude-haiku-4-5', max_tokens: 2048, output_config: { format: { type: 'json_schema', schema: ESQ } } as any, messages: [{ role: 'user', content: [{ type: 'text', text: `Mensaje del cliente: "${texto.trim()}"` }, { type: 'text', text: PROMPT }] }] })
      .finalMessage();
    return JSON.parse(((r.content as any[]).find((b) => b.type === 'text')?.text) ?? '{"items":[],"nombre":null,"notas":null}');
  }

  private async matchearRenglones(items: { sku?: string; name: string; quantity: number }[]) {
    const matched: any[] = [];
    const sinMatch: string[] = [];
    for (const item of items ?? []) {
      let prod: any = null;
      if (item.sku) { const { data } = await this.db.from('productos').select('id, nombre, sku').eq('sku', item.sku).maybeSingle(); prod = data; }
      if (!prod && item.name) {
        const { data: sim } = await this.db.rpc('buscar_producto_similar', { p_texto: item.name }).maybeSingle();
        if (sim) { const { data } = await this.db.from('productos').select('id, nombre, sku').eq('sku', (sim as any).sku).maybeSingle(); prod = data; }
      }
      if (prod) matched.push({ producto_id: prod.id, cantidad: Number(item.quantity) || 1, pedido: item.name, match: prod.nombre, sku: prod.sku });
      else sinMatch.push(item.name);
    }
    // el precio vigente de cada renglón, para la Placa roja de la vista previa
    // (2/10/2026: sin precio la placa no podía mostrar subtotal ni total)
    const ids = [...new Set(matched.map((m) => m.producto_id))];
    if (ids.length) {
      const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: ids });
      const precioDe = new Map(((precios ?? []) as any[]).map((r) => [r.producto_id ?? r.id, r]));
      for (const m of matched) {
        const pr: any = precioDe.get(m.producto_id);
        const precio = pr?.precio_final ?? pr?.precio_lista ?? null;
        m.precio = precio != null && Number.isFinite(Number(precio)) ? Number(precio) : null;
      }
    }
    return { matched, sinMatch };
  }

  // Preview: interpreta el mensaje y matchea (sin crear nada).
  async analizarWhatsApp(texto: string) {
    if (!texto?.trim()) throw new BadRequestException('Pegá o dictá el mensaje del cliente');
    const parsed = await this.parsearWhatsApp(texto);
    const { matched, sinMatch } = await this.matchearRenglones(parsed.items);
    return { nombre: parsed.nombre ?? null, notas: parsed.notas ?? null, items: matched, sinMatch };
  }

  // Confirmar: crea el pedido (canal whatsapp) con los ítems ya matcheados/editados.
  async recibirWhatsApp(p: { items: { producto_id: string; cantidad: number }[]; nombre?: string; notas?: string; dni?: string }, usuarioId?: string) {
    if (!p.items?.length) throw new BadRequestException('No hay ítems para crear el pedido');
    const { data: suc } = await this.db.from('sucursales').select('id').order('nombre').limit(1).single();
    const pedidoId = await this.crear({
      canal: 'whatsapp',
      sucursalId: suc!.id,
      items: p.items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad) || 1 })),
      clienteDni: p.dni,
      referencia: `WA-${Date.now()}`,
      notas: [p.nombre, p.notas].filter(Boolean).join(' · ') || undefined,
      reservar: false, // pedido "a pedido": no bloquea por stock
    });
    // quién lo cargó (6/10/2026): el alta del historial queda a su nombre y,
    // como lo cargó, ya lo tiene tomado
    const ahora = new Date().toISOString();
    await this.db.from('pedidos').update({
      origen: 'panel',
      contacto_nombre: p.nombre?.trim() || null,
      ...(usuarioId ? { creado_por: usuarioId, tomado_por: usuarioId, tomado_en: ahora, cambio_por: usuarioId, cambio_en: ahora } : {}),
    }).eq('id', pedidoId).then(({ error }) => { if (error) this.log.warn(`no pude anotar quién cargó ${pedidoId}: ${error.message}`); });
    return { pedidoId, renglones: p.items.length };
  }

  // --- Núcleo: crear pedido con reserva de stock ---
  // Todo (pedido + items + reservas) corre en UNA transacción en la base
  // (RPC crear_pedido): si un renglón no tiene stock, no queda nada persistido.
  async crear(p: {
    canal: string;
    sucursalId: string;
    items: { producto_id: string; cantidad: number }[];
    clienteDni?: string;
    clienteId?: string;
    referencia?: string;
    notas?: string;
    reservar?: boolean; // false = pedido "a pedido" (no reserva stock, p.ej. WhatsApp)
  }) {
    const { data, error } = await this.db.rpc('crear_pedido', {
      p_canal: p.canal,
      p_sucursal: p.sucursalId,
      p_items: p.items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
      p_cliente_id: p.clienteId ?? null,
      p_cliente_dni: p.clienteDni ?? null,
      p_qr_retiro: p.referencia ?? null,
      p_reservar: p.reservar !== false,
    });
    if (error) {
      const m = error.message ?? '';
      throw new BadRequestException(m.includes('Stock insuficiente') ? `Sin stock disponible: ${m}` : m);
    }
    const pedidoId = (data as any).pedido_id as string;
    // crear_pedido no recibe las notas (nombre del cliente, "SIN MATCHEAR", lo
    // que pidió): se perdían. Van acá, antes de que salga el aviso a
    // administración, que se arma 10 segundos después con el pedido completo.
    if (p.notas?.trim()) {
      const { error: eNotas } = await this.db.from('pedidos').update({ notas: p.notas.trim().slice(0, 1000) }).eq('id', pedidoId);
      if (eNotas) this.log.warn(`no pude guardar las notas del pedido ${pedidoId}: ${eNotas.message}`);
    }
    return pedidoId;
  }

  // --- Pedidos desde la app del cliente (pick-up) ---
  async crearDesdeApp(p: {
    tipo?: 'pickup' | 'domicilio';
    items: { sku: string; cantidad: number }[];
    dni?: string;
    clienteId?: string;
    destino?: { direccion?: string; lat?: number; lng?: number };
    origen?: string;
    contacto?: { nombre?: string; telefono?: string };
  }) {
    if (!p.items?.length) throw new BadRequestException('El pedido está vacío');
    // el WhatsApp de quien compra (6/10/2026): sin él no había a quién avisarle
    // que el pedido estaba listo ni a quién llamar desde el local
    const telefonoContacto = p.contacto?.telefono ? telefonoDeContacto(p.contacto.telefono) : null;
    if (p.contacto?.telefono && !telefonoContacto) {
      throw new BadRequestException('Revisá el WhatsApp: tiene que ser un celular con código de área (ej. 11 2345-6789)');
    }
    // tope del canal self-checkout: es venta minorista, no mayorista — un
    // pedido "real" de un cliente no necesita cientos de renglones ni miles
    // de unidades de un mismo producto (endpoint público, sin login).
    const maxRenglonesApp = Number(process.env.ODB_APP_MAX_RENGLONES ?? 20);
    if (p.items.length > maxRenglonesApp) {
      throw new BadRequestException(`El pedido supera el máximo de renglones (${maxRenglonesApp})`);
    }
    const domicilio = p.tipo === 'domicilio';
    if (domicilio && !p.destino?.direccion?.trim()) {
      throw new BadRequestException('Falta la dirección de entrega');
    }
    const items: { producto_id: string; cantidad: number }[] = [];
    for (const i of p.items) {
      const cant = Number(i.cantidad);
      if (!Number.isFinite(cant) || cant <= 0 || cant > 50) {
        throw new BadRequestException(`Cantidad inválida para ${i.sku}`);
      }
      const { data } = await this.db.from('productos').select('id, activo, vendido_por_peso').eq('sku', i.sku).maybeSingle();
      if (!data || data.activo === false) throw new BadRequestException(`No existe el producto ${i.sku}`);
      if (!data.vendido_por_peso && !Number.isInteger(cant)) throw new BadRequestException(`El producto ${i.sku} requiere unidades enteras`);
      items.push({ producto_id: data.id, cantidad: cant });
    }
    // Todos los pedidos de la app (pick-up y domicilio) salen de la sucursal
    // central (Suc Sant Thomas, la única con pickup habilitado).
    const sucursalId = await this.sucursalPickupId();
    const referencia = `${domicilio ? 'DOM' : 'PICKUP'}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const pedidoId = await this.crear({
      canal: domicilio ? 'domicilio' : 'pickup',
      sucursalId,
      items,
      clienteDni: p.dni,
      clienteId: p.clienteId,
      referencia,
    });
    // dirección, origen y contacto en una sola escritura, antes de que salga el
    // aviso a administración (se arma 10 segundos después con el pedido completo)
    const origen = p.origen === 'web' || p.origen === 'app' ? p.origen : 'app';
    await this.db.from('pedidos').update({
      origen,
      contacto_nombre: p.contacto?.nombre?.trim().slice(0, 120) || null,
      contacto_telefono: telefonoContacto,
      ...(domicilio
        ? { destino_direccion: p.destino!.direccion!.trim(), destino_lat: p.destino?.lat ?? null, destino_lng: p.destino?.lng ?? null }
        : {}),
    }).eq('id', pedidoId);
    return this.obtener(pedidoId);
  }

  // --- Delivery a domicilio ---
  async asignarRepartidor(pedidoId: string, repartidorId: string, usuarioId?: string) {
    const { error } = await this.db.from('pedidos')
      .update({ repartidor_id: repartidorId, ...(usuarioId ? { cambio_por: usuarioId, cambio_en: new Date().toISOString() } : {}) })
      .eq('id', pedidoId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // El repartidor comparte su ubicación; el cliente la ve en el seguimiento.
  async repartidorUbicacion(pedidoId: string, lat: number, lng: number) {
    const { error } = await this.db
      .from('pedidos')
      .update({ repartidor_lat: lat, repartidor_lng: lng, repartidor_en: new Date().toISOString() })
      .eq('id', pedidoId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async misEntregas(repartidorId: string) {
    const { data } = await this.db
      .from('pedidos')
      .select('id, estado, total, destino_direccion, destino_lat, destino_lng, notas, qr_retiro, creado_en, cliente:clientes(nombre, dni)')
      .eq('canal', 'domicilio')
      .eq('repartidor_id', repartidorId)
      .in('estado', ['listo', 'en_camino'])
      .order('creado_en');
    return data ?? [];
  }

  // Despacho (panel): todos los envíos a domicilio activos + ETA si hay repartidor en ruta.
  async enviosDomicilio() {
    const { data } = await this.db
      .from('pedidos')
      .select('id, estado, total, destino_direccion, destino_lat, destino_lng, notas, repartidor_id, repartidor_lat, repartidor_lng, repartidor_en, qr_retiro, creado_en, cliente:clientes(nombre, dni)')
      .eq('canal', 'domicilio')
      .in('estado', ['recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino'])
      .order('creado_en');
    const filas = (data ?? []) as any[];
    const ids = [...new Set(filas.filter((f) => f.repartidor_id).map((f) => f.repartidor_id))];
    const nombres = new Map<string, string>();
    if (ids.length) {
      const { data: us } = await this.db.from('usuarios').select('id, nombre').in('id', ids);
      (us ?? []).forEach((u: any) => nombres.set(u.id, u.nombre));
    }
    return filas.map((f) => {
      let distancia: number | null = null;
      let etaMin: number | null = null;
      if (f.repartidor_lat != null && f.destino_lat != null) {
        distancia = distanciaM(Number(f.repartidor_lat), Number(f.repartidor_lng), Number(f.destino_lat), Number(f.destino_lng));
        etaMin = Math.max(1, Math.round(distancia / METROS_POR_MIN));
      }
      return { ...f, repartidor_nombre: f.repartidor_id ? nombres.get(f.repartidor_id) ?? 'Repartidor' : null, distancia_m: distancia, etaMin };
    });
  }

  async repartidores() {
    const { data } = await this.db.from('usuarios').select('id, nombre, email').eq('rol', 'repartidor').order('nombre');
    return data ?? [];
  }

  // --- Mercado Pago: checkout del pedido ---
  async crearPreferenciaMP(pedidoId: string) {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) {
      throw new BadRequestException(
        'Mercado Pago sin configurar: poné MERCADOPAGO_ACCESS_TOKEN (Access Token de tu cuenta MP) en apps/api/.env',
      );
    }
    const ped: any = await this.obtener(pedidoId);
    if (ped.pagado_en || !['recibido', 'en_preparacion', 'listo'].includes(ped.estado)) throw new BadRequestException('Este pedido no admite un nuevo cobro');
    const items = (ped.items ?? [])
      .map((i: any) => ({
        title: `${Number(i.cantidad)} × ${i.producto?.nombre ?? 'Producto O.D.B'}`,
        quantity: 1,
        unit_price: Math.round(Number(i.cantidad) * Number(i.precio_unitario) * 100) / 100,
        currency_id: 'ARS',
      }))
      .filter((i: any) => i.unit_price > 0);
    if (!items.length) {
      throw new BadRequestException('El pedido no tiene importes válidos para cobrar (revisá los precios).');
    }
    if (items.reduce((n: number, i: any) => n + Math.round(i.unit_price * 100), 0) !== Math.round(Number(ped.total) * 100)) throw new BadRequestException('El total del pedido no coincide con sus renglones');
    const base = process.env.API_PUBLIC_URL ?? 'https://odb-api-production.up.railway.app';
    const res = await fetchConTimeout("https://api.mercadopago.com/checkout/preferences", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items,
        external_reference: pedidoId,
        // la web vuelve a su pantalla de seguimiento; la app, a la página de la API
        back_urls: ped.origen === 'web'
          ? Object.fromEntries(['success', 'pending', 'failure'].map((k) => [k, `${(process.env.WEB_PUBLIC_URL ?? 'https://odb-web-production.up.railway.app').replace(/\/$/, '')}/pedido/${pedidoId}`]))
          : { success: `${base}/pago/ok`, pending: `${base}/pago/ok`, failure: `${base}/pago/ok` },
        auto_return: 'approved',
        notification_url: `${base}/mercadopago/webhook`,
        statement_descriptor: 'O.D.B',
      }),
    });
    const d: any = await res.json();
    if (!res.ok) throw new BadRequestException(d?.message ?? 'No se pudo crear el pago en Mercado Pago');
    return { url: d.init_point ?? d.sandbox_init_point, preferenciaId: d.id };
  }

  async webhookMP(body: any, query: any, headers: Record<string, string> = {}) {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return { ok: true };
    const tipo = body?.type ?? query?.type ?? query?.topic;
    const pagoId = body?.data?.id ?? query?.['data.id'] ?? query?.id;
    if (tipo !== 'payment' || !pagoId) return { ok: true };
    // rechaza notificaciones falsificadas antes de tocar la base
    verificarFirmaMercadoPago(headers, pagoId);
    try {
      const r = await fetchConTimeout(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pay: any = await r.json();
      if (pay?.status === 'approved' && pay?.external_reference) {
        // marca durable del pago: aunque el pedido ya haya avanzado de estado,
        // pagado_en le dice a entregar_pedido que el cobro real fue por MP
        await this.db.from('pedidos').update({ pagado_en: new Date().toISOString() }).eq('id', pay.external_reference);
        await this.db.from('pedidos').update({ estado: 'pagado' }).eq('id', pay.external_reference).eq('estado', 'recibido');
      }
    } catch {
      // si MP falla, no rompemos el webhook (MP reintenta)
    }
    return { ok: true };
  }

  // La sucursal central (única con pick-up); de acá salen los pedidos de la app.
  async sucursalPickup() {
    const { data } = await this.db
      .from('sucursales')
      .select('id, nombre, direccion, lat, lng')
      .eq('pickup', true)
      .order('nombre')
      .limit(1)
      .maybeSingle();
    return data;
  }

  private async sucursalPickupId(): Promise<string> {
    const s = await this.sucursalPickup();
    if (!s?.id) throw new BadRequestException('No hay una sucursal con pick-up configurada');
    return s.id;
  }

  // Perfil mínimo para personalizar la home de la app (solo el segmento)
  // Perfil del cliente para la app: además de nombre y puntos, LO QUE CONSUME.
  // Con eso la app puede mostrarle destacado lo que lleva siempre, en vez de
  // una portada igual para todos. El perfil recién aparece con 3 compras: con
  // una sola visita, "lo que consume habitualmente" es una invención.
  async perfil(dni: string) {
    const { data } = await this.db
      .from('clientes')
      .select('id, nombre, tipo, puntos')
      .eq('dni', dni.trim())
      .maybeSingle();
    if (!data) return { existe: false, tipo: 'nuevo' };

    const { data: perfil } = await this.db.rpc('perfil_compra', { p_cliente: data.id });
    const p: any = perfil ?? {};
    const listo = p?.listo === true;

    // los habituales se devuelven con precio y stock actual: la app los muestra
    // como "lo de siempre" y se pueden agregar al carrito de una
    let habituales: any[] = [];
    if (listo && Array.isArray(p.habituales) && p.habituales.length) {
      const skus = p.habituales.map((h: any) => h.sku);
      const { data: prods } = await this.db
        .from('productos')
        .select('id, sku, nombre, activo')
        .in('sku', skus)
        .eq('activo', true);
      const ids = (prods ?? []).map((x: any) => x.id);
      const { data: precios } = ids.length ? await this.db.rpc('catalogo_precios', { p_ids: ids }) : { data: [] as any[] };
      const precioDe = new Map((precios ?? []).map((r: any) => [r.producto_id ?? r.id, r]));
      habituales = (prods ?? []).map((x: any) => {
        const h = p.habituales.find((y: any) => y.sku === x.sku);
        const pr: any = precioDe.get(x.id);
        return {
          sku: x.sku,
          nombre: x.nombre,
          veces: h?.veces ?? 0,
          precio: pr?.precio_final != null ? Math.round(Number(pr.precio_final)) : null,
        };
      }).sort((a, b) => b.veces - a.veces);
    }

    return {
      existe: true,
      nombre: data.nombre,
      tipo: data.tipo,
      puntos: data.puntos,
      // el perfil solo viaja cuando tiene sustento
      perfil: listo
        ? {
            compras: p.compras,
            ticketPromedio: p.ticketPromedio,
            cadaCuantosDias: p.cadaCuantosDias,
            rubros: p.rubros ?? [],
          }
        : null,
      habituales,
    };
  }

  async obtener(pedidoId: string) {
    const { data, error } = await this.db
      .from('pedidos')
      .select(
        `id, canal, estado, total, qr_retiro, creado_en, listo_en, pagado_en, en_camino_en, entregado_en, origen, destino_direccion,
         sucursal:sucursales(nombre, direccion),
         items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`,
      )
      .eq('id', pedidoId)
      .single();
    if (error || !data) throw new BadRequestException('No existe el pedido');
    return data;
  }

  // --- Cola del depósito ---
  // Los nombres del equipo (id → nombre) para mostrar quién tomó o hizo cada cosa.
  private async nombresDelEquipo(): Promise<Map<string, string>> {
    const { data } = await this.db.from('usuarios').select('id, nombre');
    return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.nombre ?? '')]));
  }

  async cola(estados: string[] = ['recibido', 'pagado', 'en_preparacion', 'listo'], desde?: string) {
    let q = this.db
      .from('pedidos')
      .select(
        `id, canal, estado, total, qr_retiro, creado_en, listo_en, pagado_en, en_camino_en, entregado_en, notas, entrega_fecha, entrega_franja,
         destino_direccion, origen, contacto_nombre, contacto_telefono, tomado_por, tomado_en, repartidor_id,
         sucursal:sucursales(nombre),
         cliente:clientes(dni, tipo, nombre, telefono),
         items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`,
      )
      .in('estado', estados);
    if (desde) q = q.gte('creado_en', desde);
    const [{ data, error }, nombres] = await Promise.all([q.order('creado_en', { ascending: !desde }).limit(desde ? 200 : 1000), this.nombresDelEquipo()]);
    if (error) throw new BadRequestException(error.message);
    // "hoy" en Buenos Aires: después de las 21 h, toISOString() ya da mañana
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    return (data ?? []).map((p: any) => ({
      ...p,
      // programado = tiene fecha y NO es para hoy: depósito lo ve aparte y no
      // lo prepara antes de tiempo ("reparto no es delivery")
      programado: !!(p.entrega_fecha && p.entrega_fecha > hoy),
      entregaEtiqueta: p.entrega_fecha
        ? `${p.entrega_fecha === hoy ? 'HOY' : new Date(`${p.entrega_fecha}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' })}${p.entrega_franja ? ` · ${p.entrega_franja}` : ''}`
        : null,
      origen: origenDe(p),
      // quién es el cliente: la ficha, o lo que dejó al comprar sin cuenta
      clienteNombre: p.cliente?.nombre?.trim() || p.contacto_nombre?.trim() || null,
      clienteTelefono: p.cliente?.telefono || p.contacto_telefono || null,
      tomadoPorNombre: p.tomado_por ? nombres.get(String(p.tomado_por)) ?? 'alguien del equipo' : null,
      repartidorNombre: p.repartidor_id ? nombres.get(String(p.repartidor_id)) ?? null : null,
      minutos: Math.round((Date.now() - new Date(p.creado_en).getTime()) / 60000),
    }));
  }

  // Entregados y cancelados de los últimos días: el panel no tenía dónde verlos.
  async terminados(dias = 7) {
    const d = Math.min(Math.max(Math.round(Number(dias) || 7), 1), 60);
    return this.cola(['entregado', 'cancelado', 'en_camino'], new Date(Date.now() - d * 86400_000).toISOString());
  }

  // "Lo tomo": queda el nombre de quien recibió el pedido. El primero gana; el
  // segundo ve quién lo tiene (tomar_pedido es atómica en la base).
  async tomar(pedidoId: string, usuarioId: string) {
    if (!usuarioId) throw new BadRequestException('No sé quién sos: volvé a entrar al sistema');
    const { data, error } = await this.db.rpc('tomar_pedido', { p_pedido: pedidoId, p_usuario: usuarioId });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Todo lo que pasó con un pedido, con quién y cuándo: el historial de la base
  // (cada cambio de estado, quién lo tomó, el repartidor, el pago) más los
  // WhatsApp a administración (cuándo salió, cuándo llegó, quién marcó "Ya avisé").
  async historial(pedidoId: string) {
    const [{ data: pasos, error }, { data: avisos }, nombres, { data: pedido }] = await Promise.all([
      this.db.from('pedidos_historial').select('evento, estado_antes, estado_despues, usuario_id, detalle, creado_en').eq('pedido_id', pedidoId).order('creado_en'),
      this.db.from('avisos_pedidos').select('tipo, estado, enviado_en, entregado_en, visto_en, visto_por, escalado_en, motivo').eq('pedido_id', pedidoId),
      this.nombresDelEquipo(),
      this.db.from('pedidos').select('origen, qr_retiro, canal').eq('id', pedidoId).maybeSingle(),
    ]);
    if (error) throw new BadRequestException(error.message);
    const origenPedido = pedido ? origenDe(pedido as any) : null;
    const quien = (id: unknown) => (id ? nombres.get(String(id)) ?? 'alguien del equipo' : null);
    const lineas: { cuando: string; que: string; quien: string | null; tono: 'neutro' | 'ok' | 'atencion' | 'error' | 'info'; reconstruido?: boolean }[] = [];
    for (const h of (pasos ?? []) as any[]) {
      const reconstruido = !!h.detalle?.reconstruido;
      if (h.evento === 'alta') {
        lineas.push({ cuando: h.creado_en, que: `Entró por ${NOMBRE_ORIGEN[String(h.detalle?.origen ?? origenPedido ?? '')] ?? 'otro canal'}`, quien: quien(h.usuario_id), tono: 'info', reconstruido });
      } else if (h.evento === 'tomado') {
        lineas.push({ cuando: h.creado_en, que: 'Lo tomó', quien: quien(h.usuario_id), tono: 'ok' });
      } else if (h.evento === 'estado') {
        // el pago por Mercado Pago ya tiene su línea (evento 'pago')
        if (h.estado_despues === 'pagado') continue;
        lineas.push({ cuando: h.creado_en, que: ETIQUETA_ESTADO[String(h.estado_despues)] ?? String(h.estado_despues), quien: quien(h.usuario_id) ?? (h.estado_despues === 'pagado' ? 'Mercado Pago' : null), tono: h.estado_despues === 'cancelado' ? 'error' : h.estado_despues === 'entregado' ? 'ok' : 'neutro', reconstruido });
      } else if (h.evento === 'repartidor') {
        lineas.push({ cuando: h.creado_en, que: h.detalle?.repartidor ? `Repartidor: ${h.detalle.repartidor}` : 'Se sacó el repartidor', quien: quien(h.usuario_id), tono: 'neutro' });
      } else if (h.evento === 'pago') {
        lineas.push({ cuando: h.creado_en, que: 'Pagado por Mercado Pago', quien: null, tono: 'ok' });
      }
    }
    const TIPO_AVISO: Record<string, string> = { pedido_nuevo: 'el pedido', pedido_cancelado: 'la cancelación', pedido_pagado: 'el pago', pedido_sin_tomar: 'el reclamo (nadie lo había tomado)' };
    for (const a of (avisos ?? []) as any[]) {
      const de = TIPO_AVISO[String(a.tipo)] ?? 'un aviso';
      if (a.entregado_en) lineas.push({ cuando: a.entregado_en, que: `Le llegó a administración el WhatsApp con ${de}`, quien: null, tono: 'neutro' });
      else if (a.enviado_en) lineas.push({ cuando: a.enviado_en, que: `Salió el WhatsApp a administración con ${de}`, quien: null, tono: 'neutro' });
      if (a.escalado_en) lineas.push({ cuando: a.escalado_en, que: `El WhatsApp con ${de} no llegaba: se avisó a los dueños`, quien: null, tono: 'atencion' });
      if (a.visto_en) lineas.push({ cuando: a.visto_en, que: 'Marcó «Ya avisé al local»', quien: quien(a.visto_por), tono: 'neutro' });
    }
    lineas.sort((x, y) => Date.parse(x.cuando) - Date.parse(y.cuando));
    return lineas;
  }

  // --- Avance de estados (al entregar: libera reserva y registra la venta) ---
  async avanzar(pedidoId: string, estado: string, usuarioId?: string, medioPago?: string) {
    const { data: pedido, error } = await this.db
      .from('pedidos')
      .select('*, items:pedidos_items(producto_id, cantidad, producto:productos(nombre)), cliente:clientes(dni, nombre, telefono, tipo, verificado)')
      .eq('id', pedidoId)
      .single();
    if (error || !pedido) throw new BadRequestException('No existe el pedido');
    if (!transicionValida(pedido.estado, estado)) {
      throw new BadRequestException(`Transición inválida: ${pedido.estado} → ${estado}`);
    }

    // ENTREGAR es la operación crítica: liberar reserva + registrar venta +
    // cambiar estado tienen que ser atómicos. Todo eso vive ahora en la RPC
    // entregar_pedido (una sola transacción, con lock de fila e idempotente),
    // así un corte a mitad de camino no deja stock fantasma ni venta doble.
    let venta: any = null;
    if (estado === 'entregado') {
      const { data, error: errEntregar } = await this.db.rpc('entregar_pedido', {
        p_pedido: pedidoId,
        p_usuario: usuarioId ?? null,
        // medio REAL del cobro (efectivo/tarjeta al retirar); la RPC lo pisa con
        // 'mercadopago'/'pedidosya' cuando el pago vino por esos canales
        p_medio: medioPago ?? null,
      });
      if (errEntregar) throw new BadRequestException(errEntregar.message);
      venta = (data as any)?.venta ?? data;
    } else if (estado === 'cancelado') {
      // CANCELAR también toca stock (libera la reserva): misma receta que la
      // entrega — RPC con lock de fila e idempotente, así dos cancelaciones
      // concurrentes no liberan la reserva dos veces.
      const { error: errCancelar } = await this.db.rpc('cancelar_pedido', {
        p_pedido: pedidoId,
        p_usuario: usuarioId ?? null,
      });
      if (errCancelar) throw new BadRequestException(errCancelar.message);
    } else {
      // Estados intermedios (no tocan stock): update condicionado al estado leído,
      // así dos avances concurrentes no pisan la máquina de estados.
      const ahora = new Date().toISOString();
      const { data: filas, error: errUpdate } = await this.db
        .from('pedidos')
        .update({
          estado,
          // quién hizo este paso (queda en pedidos_historial por el trigger)
          ...(usuarioId ? { cambio_por: usuarioId, cambio_en: ahora } : {}),
          // preparar un pedido que nadie había tomado, lo toma
          ...(usuarioId && !pedido.tomado_por && estado === 'en_preparacion' ? { tomado_por: usuarioId, tomado_en: ahora } : {}),
          // cronometraje + responsable de cada etapa (eficiencia por empleado)
          preparacion_en: estado === 'en_preparacion' ? ahora : pedido.preparacion_en,
          preparado_por: estado === 'en_preparacion' ? (usuarioId ?? pedido.preparado_por) : pedido.preparado_por,
          listo_en: estado === 'listo' ? ahora : pedido.listo_en,
          en_camino_en: estado === 'en_camino' ? ahora : pedido.en_camino_en,
        })
        .eq('id', pedidoId)
        .eq('estado', pedido.estado)
        .select('id');
      if (errUpdate) throw new BadRequestException(errUpdate.message);
      if (!filas?.length) throw new BadRequestException('El pedido cambió de estado mientras tanto: actualizá la pantalla');
    }

    // aviso al cliente por WhatsApp (lo envía n8n; acá solo se dispara el evento)
    this.notificarWhatsApp(pedido, estado).catch((e) =>
      this.log.warn(`No se pudo notificar el pedido ${pedidoId}: ${e?.message ?? e}`),
    );

    return { estado, venta };
  }

  // Dispara un webhook a n8n para que mande el WhatsApp "pedido listo / en camino
  // / entregado". Fire-and-forget: si n8n no responde, NO rompe el cambio de estado.
  private async notificarWhatsApp(pedido: any, estado: string) {
    const url = process.env.N8N_PEDIDOS_WEBHOOK_URL;
    // la ficha del cliente o el WhatsApp que dejó al comprar sin cuenta (6/10/2026)
    const telefono = pedido.cliente?.telefono || pedido.contacto_telefono;
    // solo estados que le importan al cliente y solo si tenemos su teléfono
    const avisables: Record<string, string> = {
      listo: `Su pedido de O.D.B está listo para retirar.${pedido.qr_retiro ? ` Código: ${pedido.qr_retiro}.` : ''} Lo esperamos en la sucursal Saint Thomas (Castex 3601).`,
      en_camino: `Su pedido de O.D.B${pedido.qr_retiro ? ` (${pedido.qr_retiro})` : ''} salió y está en camino a su domicilio.`,
      entregado: `Su pedido de O.D.B${pedido.qr_retiro ? ` (${pedido.qr_retiro})` : ''} fue entregado. Gracias por su compra.`,
    };
    if (!telefono || !avisables[estado]) return;
    // Sale por el WhatsApp de la casa (WAHA), igual que los avisos a
    // administración. n8n queda solo si WAHA no está configurado: antes el
    // aviso dependía de un webhook que nadie verificaba.
    if (process.env.WAHA_URL && process.env.WAHA_API_KEY) {
      // un pedido del bot le avisa al cliente por la línea por la que lo pidió
      // (6/10/2026); el resto, por la principal como siempre
      const { data: cot } = await this.db.from('bot_cotizaciones').select('linea').eq('pedido_id', pedido.id).limit(1).maybeSingle();
      const sesion = (cot as any)?.linea ? await new Lineas(this.db).sesion(String((cot as any).linea)) : undefined;
      const r = await enviarTextoWhatsapp(this.db, String(telefono), avisables[estado], 'aviso-cliente-pedido', sesion);
      if (!r.enviado) this.log.warn(`aviso al cliente del pedido ${pedido.id} (${estado}) no salió: ${r.motivo ?? 'sin motivo'}`);
      return;
    }
    if (!url) return;

    const payload = {
      pedidoId: pedido.id,
      estado,
      telefono: String(telefono).replace(/\D/g, ''),
      nombre: pedido.cliente?.nombre ?? null,
      total: Number(pedido.total),
      codigoRetiro: pedido.qr_retiro ?? null,
      canal: pedido.canal,
      resumen: (pedido.items ?? []).map((i: any) => `${i.cantidad}x ${i.producto?.nombre ?? ''}`.trim()).join(', '),
      mensaje: avisables[estado],
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_WEBHOOK_TOKEN ? { 'x-webhook-token': process.env.N8N_WEBHOOK_TOKEN } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

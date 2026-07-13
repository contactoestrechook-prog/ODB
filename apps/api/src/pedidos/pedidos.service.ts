import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';
import { transicionValida, liberaReserva } from './transiciones';
import { verificarFirmaMercadoPago } from '../comun/firmas';
import { fetchConTimeout } from '../comun/http';

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
  async recibirDePedidosYa(payload: PedidoYaPayload) {
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
  async recibirWhatsApp(p: { items: { producto_id: string; cantidad: number }[]; nombre?: string; notas?: string; dni?: string }) {
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
    return (data as any).pedido_id as string;
  }

  // --- Pedidos desde la app del cliente (pick-up) ---
  async crearDesdeApp(p: {
    tipo?: 'pickup' | 'domicilio';
    items: { sku: string; cantidad: number }[];
    dni?: string;
    clienteId?: string;
    destino?: { direccion?: string; lat?: number; lng?: number };
  }) {
    if (!p.items?.length) throw new BadRequestException('El pedido está vacío');
    const domicilio = p.tipo === 'domicilio';
    if (domicilio && !p.destino?.direccion?.trim()) {
      throw new BadRequestException('Falta la dirección de entrega');
    }
    const items: { producto_id: string; cantidad: number }[] = [];
    for (const i of p.items) {
      const cant = Number(i.cantidad);
      if (!Number.isFinite(cant) || cant <= 0 || cant > 1000) {
        throw new BadRequestException(`Cantidad inválida para ${i.sku}`);
      }
      const { data } = await this.db.from('productos').select('id').eq('sku', i.sku).maybeSingle();
      if (!data) throw new BadRequestException(`No existe el producto ${i.sku}`);
      items.push({ producto_id: data.id, cantidad: Math.floor(cant) });
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
    if (domicilio) {
      await this.db.from('pedidos').update({
        destino_direccion: p.destino!.direccion!.trim(),
        destino_lat: p.destino?.lat ?? null,
        destino_lng: p.destino?.lng ?? null,
      }).eq('id', pedidoId);
    }
    return this.obtener(pedidoId);
  }

  // --- Delivery a domicilio ---
  async asignarRepartidor(pedidoId: string, repartidorId: string) {
    const { error } = await this.db.from('pedidos').update({ repartidor_id: repartidorId }).eq('id', pedidoId);
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
      .select('id, estado, total, destino_direccion, destino_lat, destino_lng, qr_retiro, creado_en, cliente:clientes(nombre, dni)')
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
      .select('id, estado, total, destino_direccion, destino_lat, destino_lng, repartidor_id, repartidor_lat, repartidor_lng, repartidor_en, qr_retiro, creado_en, cliente:clientes(nombre, dni)')
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
    const items = (ped.items ?? [])
      .map((i: any) => ({
        title: i.producto?.nombre ?? 'Producto O.D.B',
        quantity: Math.round(Number(i.cantidad)) || 1,
        unit_price: Math.round(Number(i.precio_unitario)),
        currency_id: 'ARS',
      }))
      .filter((i: any) => i.unit_price > 0);
    if (!items.length) {
      throw new BadRequestException('El pedido no tiene importes válidos para cobrar (revisá los precios).');
    }
    const base = process.env.API_PUBLIC_URL ?? 'https://odb-api-production.up.railway.app';
    const res = await fetchConTimeout("https://api.mercadopago.com/checkout/preferences", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items,
        external_reference: pedidoId,
        back_urls: { success: `${base}/pago/ok`, pending: `${base}/pago/ok`, failure: `${base}/pago/ok` },
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
  async perfil(dni: string) {
    const { data } = await this.db
      .from('clientes')
      .select('nombre, tipo, puntos')
      .eq('dni', dni.trim())
      .maybeSingle();
    if (!data) return { existe: false, tipo: 'nuevo' };
    return { existe: true, nombre: data.nombre, tipo: data.tipo, puntos: data.puntos };
  }

  async obtener(pedidoId: string) {
    const { data, error } = await this.db
      .from('pedidos')
      .select(
        `id, canal, estado, total, qr_retiro, creado_en, listo_en,
         sucursal:sucursales(nombre, direccion),
         items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`,
      )
      .eq('id', pedidoId)
      .single();
    if (error || !data) throw new BadRequestException('No existe el pedido');
    return data;
  }

  // --- Cola del depósito ---
  async cola() {
    const { data, error } = await this.db
      .from('pedidos')
      .select(
        `id, canal, estado, total, qr_retiro, creado_en, listo_en,
         sucursal:sucursales(nombre),
         cliente:clientes(dni, tipo),
         items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`,
      )
      .in('estado', ['recibido', 'pagado', 'en_preparacion', 'listo'])
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((p: any) => ({
      ...p,
      origen: p.qr_retiro?.startsWith('PY-')
        ? 'pedidosya'
        : p.qr_retiro?.startsWith('WEB-')
          ? 'web'
          : p.qr_retiro?.startsWith('TN-')
            ? 'tiendanube'
            : p.canal,
      minutos: Math.round((Date.now() - new Date(p.creado_en).getTime()) / 60000),
    }));
  }

  // --- Avance de estados (al entregar: libera reserva y registra la venta) ---
  async avanzar(pedidoId: string, estado: string, usuarioId?: string) {
    const { data: pedido, error } = await this.db
      .from('pedidos')
      .select('*, items:pedidos_items(producto_id, cantidad, producto:productos(nombre)), cliente:clientes(dni, nombre, telefono, tipo, verificado)')
      .eq('id', pedidoId)
      .single();
    if (error || !pedido) throw new BadRequestException('No existe el pedido');
    if (!transicionValida(pedido.estado, estado)) {
      throw new BadRequestException(`Transición inválida: ${pedido.estado} → ${estado}`);
    }

    if (liberaReserva(estado)) {
      // Solo se libera stock si el pedido realmente lo reservó al crearse
      // (crear_pedido con p_reservar=true). Los pedidos "a pedido" —
      // PedidosYa, Tienda Nube, WhatsApp manual (canal web/whatsapp) — nunca
      // descontaron stock, así que "liberar" acá sumaría stock fantasma al
      // cancelar, o neutralizaría el descuento real al entregar (ver
      // registrar_venta más abajo, que si descuenta de verdad).
      if (pedido.reserva_stock) {
        for (const item of pedido.items as any[]) {
          const { error: errMov } = await this.db.rpc('registrar_movimiento', {
            p_producto_id: item.producto_id,
            p_sucursal_id: pedido.sucursal_id,
            p_tipo: 'liberacion_reserva',
            p_cantidad: Number(item.cantidad),
            p_referencia_tipo: 'pedido',
            p_referencia_id: pedidoId,
            p_usuario_id: usuarioId ?? null,
          });
          if (errMov) throw new BadRequestException(errMov.message);
        }
      }
      // libera el estacionamiento que tuviera reservado (no depende de si hubo reserva de stock)
      await this.db.rpc('liberar_estacionamiento', { p_pedido: pedidoId });
    }

    let venta: any = null;
    let ventaId: string | null = pedido.venta_id ?? null;
    if (estado === 'entregado') {
      // Id de venta estable, reservado en el pedido ANTES de llamar a
      // registrar_venta (no después): si el proceso se corta entre el RPC y
      // el UPDATE de estado de más abajo, un reintento de avanzar() relee
      // este mismo venta_id y registrar_venta lo detecta como duplicado, en
      // vez de cobrar y descontar stock dos veces.
      if (!ventaId) {
        ventaId = randomUUID();
        const { error: errReserva } = await this.db.from('pedidos').update({ venta_id: ventaId }).eq('id', pedidoId);
        if (errReserva) throw new BadRequestException(errReserva.message);
      }
      const esPY = pedido.qr_retiro?.startsWith('PY-');
      const medio = esPY ? 'pedidosya' : 'mercadopago';
      // mismo cálculo que hará registrar_venta (segmento + medio) para que el pago cierre exacto
      let monto = 0;
      for (const item of pedido.items as any[]) {
        const base = {
          p_producto_id: item.producto_id,
          p_fecha: new Date().toISOString(),
          p_segmento: pedido.cliente?.tipo ?? null,
          p_medio_pago: medio,
        };
        // intenta con la dimensión Comunidad; si la migración no corrió, cae al formato viejo
        let { data: pv, error: errPv } = await this.db
          .rpc('precio_vigente', { ...base, p_verificado: pedido.cliente?.verificado === true })
          .maybeSingle();
        if (errPv) {
          ({ data: pv } = await this.db.rpc('precio_vigente', base).maybeSingle());
        }
        monto += Math.round(Number(item.cantidad) * Number((pv as any)?.precio_final ?? 0) * 100) / 100;
      }
      const { data, error: errVenta } = await this.db.rpc('registrar_venta', {
        p_sucursal: pedido.sucursal_id,
        p_items: (pedido.items as any[]).map((i) => ({
          producto_id: i.producto_id,
          cantidad: Number(i.cantidad),
        })),
        p_pagos: [{ medio, monto: Math.round(monto * 100) / 100 }],
        p_canal: pedido.canal,
        p_cliente_dni: pedido.cliente?.dni ?? null,
        p_usuario: usuarioId ?? null,
        p_venta_id: ventaId,
      });
      if (errVenta) throw new BadRequestException(errVenta.message);
      venta = data;
    }

    const ahora = new Date().toISOString();
    const { error: errUpdate } = await this.db
      .from('pedidos')
      .update({
        estado,
        // cronometraje + responsable de cada etapa (eficiencia por empleado)
        preparacion_en: estado === 'en_preparacion' ? ahora : pedido.preparacion_en,
        preparado_por: estado === 'en_preparacion' ? (usuarioId ?? pedido.preparado_por) : pedido.preparado_por,
        listo_en: estado === 'listo' ? ahora : pedido.listo_en,
        en_camino_en: estado === 'en_camino' ? ahora : pedido.en_camino_en,
        entregado_en: estado === 'entregado' ? ahora : pedido.entregado_en,
        entregado_por: estado === 'entregado' ? (usuarioId ?? null) : pedido.entregado_por,
      })
      .eq('id', pedidoId);
    // Si esto falla habiendo ya una venta registrada, no queda oculto: el
    // caller se entera y puede reintentar avanzar() sin riesgo de duplicar
    // (venta_id ya quedó reservado arriba).
    if (errUpdate) throw new BadRequestException(errUpdate.message);

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
    const telefono = pedido.cliente?.telefono;
    // solo estados que le importan al cliente y solo si tenemos su teléfono
    const avisables: Record<string, string> = {
      listo: `¡Tu pedido de O.D.B está LISTO para retirar! 🎉${pedido.qr_retiro ? ` Código: ${pedido.qr_retiro}.` : ''} Te esperamos en Suc Sant Thomas.`,
      en_camino: '🛵 ¡Tu pedido de O.D.B salió y está en camino a tu domicilio!',
      entregado: '✅ Tu pedido de O.D.B fue entregado. ¡Gracias por tu compra! 🍷',
    };
    if (!url || !telefono || !avisables[estado]) return;

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

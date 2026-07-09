import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from '../catalogo/catalogo.service';
import { NotificarService } from '../mensajes/notificar.service';

// Catálogo de recompensas: el cliente canjea puntos por beneficios concretos.
// Es desacoplado del cobro: el canje genera un código que se entrega en el local.
export const RECOMPENSAS = [
  { id: 'desc-500', nombre: '$500 de regalo en tu próxima compra', puntos: 500, emoji: '🎁' },
  { id: 'envio-gratis', nombre: 'Envío a domicilio gratis', puntos: 700, emoji: '🛵' },
  { id: 'vino-sorpresa', nombre: 'Botella sorpresa de la Comunidad ODB', puntos: 1000, emoji: '🍷' },
  { id: 'desc-1500', nombre: '$1.500 de regalo', puntos: 1200, emoji: '💸' },
  { id: 'desc-4000', nombre: '$4.000 de regalo', puntos: 3000, emoji: '👑' },
] as const;

// Niveles por puntos ACUMULADOS de por vida (canjear no te baja de nivel).
const NIVELES = [
  { nombre: 'Bronce', desde: 0 },
  { nombre: 'Plata', desde: 1500 },
  { nombre: 'Oro', desde: 4000 },
  { nombre: 'Platino', desde: 10000 },
];

@Injectable()
export class FidelizacionService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly catalogo: CatalogoService,
    private readonly notificar: NotificarService,
  ) {}

  private async perfil(clienteId: string): Promise<{ tipo?: string; verificado: boolean }> {
    const { data } = await this.db
      .from('clientes')
      .select('tipo, verificado')
      .eq('id', clienteId)
      .maybeSingle();
    return { tipo: data?.tipo ?? undefined, verificado: data?.verificado === true };
  }

  // ---------- Historial de compras (pedidos de la app + ventas en el local) ----------
  async compras(clienteId: string) {
    const [{ tipo, verificado }, pedidos, ventas] = await Promise.all([
      this.perfil(clienteId),
      this.db
        .from('pedidos')
        .select('id, estado, total, canal, creado_en, items:pedidos_items(cantidad, producto:productos(id, sku, nombre))')
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .limit(20),
      this.db
        .from('ventas')
        .select('id, estado, total, canal, vendida_en, items:ventas_items(cantidad, producto:productos(id, sku, nombre))')
        .eq('cliente_id', clienteId)
        .eq('estado', 'completada')
        .order('vendida_en', { ascending: false })
        .limit(20),
    ]);

    // una sola búsqueda de tarjetas para todos los productos del historial
    const ids = new Set<string>();
    for (const p of [...(pedidos.data ?? []), ...(ventas.data ?? [])] as any[]) {
      for (const i of p.items ?? []) if (i.producto?.id) ids.add(i.producto.id);
    }
    const cards = await this.catalogo.cardsPorIds([...ids], verificado, tipo);
    const cardPorId = new Map(cards.map((c: any) => [c.id, c]));

    const mapItems = (items: any[]) =>
      (items ?? []).map((i) => ({
        sku: i.producto?.sku,
        nombre: i.producto?.nombre ?? 'Producto',
        cantidad: Number(i.cantidad),
        producto: cardPorId.get(i.producto?.id) ?? null, // tarjeta actual para recomprar
      }));

    const dePedidos = (pedidos.data ?? []).map((p: any) => ({
      tipo: 'pedido' as const,
      id: p.id,
      fecha: p.creado_en,
      estado: p.estado,
      canal: p.canal,
      total: Number(p.total),
      items: mapItems(p.items),
    }));
    const deVentas = (ventas.data ?? []).map((v: any) => ({
      tipo: 'compra' as const,
      id: v.id,
      fecha: v.vendida_en,
      estado: v.estado,
      canal: v.canal,
      total: Number(v.total),
      items: mapItems(v.items),
    }));

    return [...dePedidos, ...deVentas]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 30);
  }

  // ---------- Mis frecuentes (lo que más compra) ----------
  async frecuentes(clienteId: string) {
    const { data } = await this.db
      .from('ventas_items')
      .select('producto_id, cantidad, venta:ventas!inner(cliente_id, estado)')
      .eq('venta.cliente_id', clienteId)
      .eq('venta.estado', 'completada')
      .limit(3000);
    const acum = new Map<string, number>();
    for (const r of (data ?? []) as any[]) {
      acum.set(r.producto_id, (acum.get(r.producto_id) ?? 0) + Number(r.cantidad));
    }
    const ids = [...acum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
    const { tipo, verificado } = await this.perfil(clienteId);
    return this.catalogo.cardsPorIds(ids, verificado, tipo);
  }

  // ---------- Favoritos ----------
  async favoritos(clienteId: string) {
    const { data } = await this.db
      .from('favoritos')
      .select('producto_id')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(100);
    const ids = (data ?? []).map((r: any) => r.producto_id);
    const { tipo, verificado } = await this.perfil(clienteId);
    return this.catalogo.cardsPorIds(ids, verificado, tipo);
  }

  async toggleFavorito(clienteId: string, productoId: string) {
    const { data: existe } = await this.db
      .from('favoritos')
      .select('producto_id')
      .eq('cliente_id', clienteId)
      .eq('producto_id', productoId)
      .maybeSingle();
    if (existe) {
      await this.db.from('favoritos').delete().eq('cliente_id', clienteId).eq('producto_id', productoId);
      return { favorito: false };
    }
    const { error } = await this.db.from('favoritos').insert({ cliente_id: clienteId, producto_id: productoId });
    if (error) throw new BadRequestException(error.message);
    return { favorito: true };
  }

  // ---------- Puntos: saldo, ledger, nivel, recompensas ----------
  async puntos(clienteId: string) {
    const [{ data: cliente }, { data: movs }, { data: canjes }] = await Promise.all([
      this.db.from('clientes').select('puntos').eq('id', clienteId).maybeSingle(),
      this.db
        .from('puntos_movimientos')
        .select('puntos, concepto, creado_en')
        .eq('cliente_id', clienteId)
        .order('id', { ascending: false })
        .limit(500),
      this.db
        .from('canjes')
        .select('recompensa, codigo, estado, puntos, creado_en')
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .limit(10),
    ]);

    const saldo = Number(cliente?.puntos ?? 0);
    const movimientos = (movs ?? []) as any[];
    const acumulado = movimientos.filter((m) => m.puntos > 0).reduce((s, m) => s + m.puntos, 0);

    const idx = Math.max(0, NIVELES.map((n) => acumulado >= n.desde).lastIndexOf(true));
    const nivelActual = NIVELES[idx];
    const siguiente = NIVELES[idx + 1] ?? null;

    return {
      saldo,
      acumulado,
      // 1 punto por cada $100 gastado
      gana: 'Sumás 1 punto por cada $100 de compra',
      nivel: {
        nombre: nivelActual.nombre,
        proximo: siguiente ? { nombre: siguiente.nombre, faltan: Math.max(0, siguiente.desde - acumulado) } : null,
      },
      recompensas: RECOMPENSAS.map((r) => ({ ...r, alcanza: saldo >= r.puntos })),
      movimientos: movimientos.slice(0, 50),
      canjes: canjes ?? [],
    };
  }

  async canjear(clienteId: string, recompensaId: string) {
    const r = RECOMPENSAS.find((x) => x.id === recompensaId);
    if (!r) throw new BadRequestException('Recompensa inexistente');

    const codigo = 'ODB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data: canje, error: errCanje } = await this.db
      .from('canjes')
      .insert({ cliente_id: clienteId, recompensa: r.nombre, puntos: r.puntos, codigo })
      .select('id')
      .single();
    if (errCanje) throw new BadRequestException(errCanje.message);

    // descuento atómico: devuelve null si no le alcanzaban los puntos
    const { data: saldo, error: errDesc } = await this.db.rpc('descontar_puntos', {
      p_cliente: clienteId,
      p_puntos: r.puntos,
    });
    if (errDesc || saldo === null || saldo === undefined) {
      await this.db.from('canjes').delete().eq('id', canje.id);
      throw new BadRequestException('No te alcanzan los puntos para este canje');
    }

    await this.db.from('puntos_movimientos').insert({
      cliente_id: clienteId,
      puntos: -r.puntos,
      concepto: 'Canje: ' + r.nombre,
      referencia: 'canje:' + canje.id,
    });

    await this.notificar.aCliente(
      clienteId,
      `Canje confirmado ${r.emoji}`,
      `Mostrá el código ${codigo} en Suc Sant Thomas para usar: ${r.nombre}`,
      'canje',
    );

    return { ok: true, codigo, recompensa: r.nombre, saldo: Number(saldo) };
  }

  // ---------- Aviso de reposición ----------
  async avisos(clienteId: string) {
    const { data } = await this.db
      .from('avisos_reposicion')
      .select('producto_id')
      .eq('cliente_id', clienteId)
      .is('notificado_en', null)
      .limit(100);
    const ids = (data ?? []).map((r: any) => r.producto_id);
    const { tipo, verificado } = await this.perfil(clienteId);
    return this.catalogo.cardsPorIds(ids, verificado, tipo);
  }

  async suscribirAviso(clienteId: string, productoId: string) {
    const { data: existe } = await this.db
      .from('avisos_reposicion')
      .select('id')
      .eq('cliente_id', clienteId)
      .eq('producto_id', productoId)
      .is('notificado_en', null)
      .maybeSingle();
    if (existe) return { ok: true, yaSuscripto: true };
    const { error } = await this.db
      .from('avisos_reposicion')
      .insert({ cliente_id: clienteId, producto_id: productoId });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---------- Referidos: "invitá un amigo y ganá" ----------
  async referidos(clienteId: string) {
    const { data: codigo } = await this.db.rpc('asegurar_codigo_referido', { p_cliente: clienteId });
    const { data: lista } = await this.db
      .from('referidos')
      .select('estado, puntos_referrer, creado_en, referido:clientes!referidos_referido_id_fkey(nombre)')
      .eq('referrer_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(50);
    const refs = (lista ?? []) as any[];
    const acreditados = refs.filter((r) => r.estado === 'acreditado');
    return {
      codigo,
      recompensaReferrer: 500,
      recompensaReferido: 300,
      invitados: refs.length,
      acreditados: acreditados.length,
      pendientes: refs.length - acreditados.length,
      puntosGanados: acreditados.reduce((s, r) => s + Number(r.puntos_referrer), 0),
      lista: refs.map((r) => ({
        nombre: r.referido?.nombre ?? 'Invitado',
        estado: r.estado,
        creado_en: r.creado_en,
      })),
    };
  }
}

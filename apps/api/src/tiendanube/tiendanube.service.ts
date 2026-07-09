import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { PedidosService } from '../pedidos/pedidos.service';
import { mapProductoATN, mapPedidoTN } from './mapeo';
import { tnConfig, tnConfigurado, tnGet, tnPost, tnPut } from './cliente';
import { verificarFirmaTiendaNube } from '../comun/firmas';

const SUC_CENTRAL = '229906e6-df69-48eb-b027-2b57fefb89fe';

@Injectable()
export class TiendanubeService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly pedidos: PedidosService,
  ) {}

  // Estado de la integración: si está configurada, qué se sincronizó y la última corrida.
  async estado() {
    const [pEnTN, pedidosTN, ult] = await Promise.all([
      this.db.from('productos').select('*', { count: 'exact', head: true }).not('tiendanube_id', 'is', null),
      this.db.from('pedidos').select('*', { count: 'exact', head: true }).like('qr_retiro', 'TN-%'),
      this.db.from('sync_runs').select('corrida_en, productos_actualizados, ok, error').eq('origen', 'tiendanube').order('corrida_en', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      configurado: tnConfigurado(),
      storeId: tnConfig().storeId || null,
      productosEnTiendanube: pEnTN.count ?? 0,
      pedidosImportados: pedidosTN.count ?? 0,
      ultimaSync: ult.data ?? null,
    };
  }

  // Push de catálogo ODB → Tienda Nube (productos vendibles: con stock en Central).
  // Crea los que faltan (guarda tiendanube_id) y actualiza nombre/publicación de los ya creados.
  async syncCatalogo(opts: { limite?: number } = {}) {
    if (!tnConfigurado()) throw new BadRequestException('Tienda Nube no está configurada: cargá TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.');
    const limite = Math.min(opts.limite ?? 50, 200);
    const t0 = Date.now();

    const { data: stockRows, error } = await this.db
      .from('stock')
      .select('cantidad, producto:productos!inner(id, sku, nombre, activo, tiendanube_id)')
      .eq('sucursal_id', SUC_CENTRAL)
      .gt('cantidad', 0);
    if (error) throw new BadRequestException(error.message);

    const candidatos = (stockRows ?? [])
      .map((r: any) => ({ ...r.producto, stock: Number(r.cantidad) }))
      .filter((p: any) => p && p.activo)
      .sort((a: any, b: any) => (a.tiendanube_id ? 1 : 0) - (b.tiendanube_id ? 1 : 0)); // primero los que faltan crear
    const lote = candidatos.slice(0, limite);

    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: lote.map((p: any) => p.id) });
    const precioPor = new Map<string, number>((precios ?? []).map((r: any) => [r.producto_id, Number(r.precio_final)]));

    let creados = 0, actualizados = 0, errores = 0;
    for (const p of lote) {
      try {
        const payload = mapProductoATN(p, precioPor.get(p.id) ?? 0);
        if (p.tiendanube_id) {
          await tnPut(`/products/${p.tiendanube_id}`, { name: payload.name, published: true });
          actualizados += 1;
        } else {
          const creado = await tnPost('/products', payload);
          if (creado?.id) await this.db.from('productos').update({ tiendanube_id: creado.id }).eq('id', p.id);
          creados += 1;
        }
      } catch {
        errores += 1;
      }
    }

    await this.log({ productos_leidos: candidatos.length, productos_actualizados: creados + actualizados, ok: errores === 0, error: errores ? `${errores} con error` : null, duracion_ms: Date.now() - t0 });
    return { totalVendibles: candidatos.length, procesados: lote.length, creados, actualizados, errores, faltanPorCrear: candidatos.filter((p: any) => !p.tiendanube_id).length - creados };
  }

  // Pull de pedidos Tienda Nube → pedidos ODB (omnicanal). Dedupe por referencia TN-<id>.
  async importarPedidos() {
    if (!tnConfigurado()) throw new BadRequestException('Tienda Nube no está configurada.');
    const orders = await tnGet('/orders?per_page=50&sort_by=created_at_descending');
    let importados = 0, duplicados = 0, errores = 0;
    for (const o of (orders ?? [])) {
      try {
        const r = await this.importarUno(o);
        if (r.duplicado) duplicados += 1; else importados += 1;
      } catch {
        errores += 1;
      }
    }
    return { revisados: (orders ?? []).length, importados, duplicados, errores };
  }

  // Webhook order/created: re-consulta el pedido a TN (no confía en el body) y lo importa.
  async recibirWebhook(body: any, rawBody?: Buffer, headers: Record<string, string> = {}) {
    if (!tnConfigurado()) return { ok: false, motivo: 'no configurado' };
    // rechaza POSTs falsificados: la firma HMAC del cuerpo debe coincidir
    verificarFirmaTiendaNube(rawBody, headers);
    if (String(body?.store_id ?? '') !== String(tnConfig().storeId)) return { ok: false, motivo: 'store_id no coincide' };
    const orderId = body?.id;
    if (!orderId) return { ok: false, motivo: 'sin id' };
    const order = await tnGet(`/orders/${orderId}`); // si no existe en NUESTRA tienda, tira error → no crea nada
    const r = await this.importarUno(order);
    return { ok: true, ...r };
  }

  // ---------- internos ----------

  private async importarUno(order: any) {
    const m = mapPedidoTN(order);
    const { data: existente } = await this.db.from('pedidos').select('id').eq('qr_retiro', m.referencia).maybeSingle();
    if (existente) return { pedidoId: existente.id, duplicado: true };

    const items: { producto_id: string; cantidad: number }[] = [];
    const sinMatch: string[] = [];
    for (const it of m.items) {
      let pid: string | null = null;
      if (it.sku) {
        const { data } = await this.db.from('productos').select('id').eq('sku', it.sku).maybeSingle();
        pid = data?.id ?? null;
      }
      if (!pid && it.name) {
        const { data } = await this.db.rpc('buscar_producto_similar', { p_texto: it.name }).maybeSingle();
        if (data) {
          const { data: prod } = await this.db.from('productos').select('id').eq('sku', (data as any).sku).single();
          pid = prod?.id ?? null;
        }
      }
      if (pid) items.push({ producto_id: pid, cantidad: Number(it.quantity) });
      else if (it.name) sinMatch.push(it.name);
    }
    if (!items.length) throw new BadRequestException(`Ningún renglón del pedido TN matcheó con el catálogo: ${sinMatch.join(', ')}`);

    const { data: suc } = await this.db.from('sucursales').select('id').order('nombre').limit(1).single();
    const pedidoId = await this.pedidos.crear({
      canal: 'web',
      sucursalId: suc!.id,
      items,
      clienteDni: m.clienteDni ?? undefined,
      referencia: m.referencia,
      notas: [m.clienteNombre, m.notas, sinMatch.length ? `SIN MATCHEAR: ${sinMatch.join(', ')}` : null].filter(Boolean).join(' · '),
      reservar: false, // pedido externo: no bloquea por stock
    });
    return { pedidoId, duplicado: false, sinMatch };
  }

  private async log(reg: { productos_leidos?: number; productos_actualizados?: number; ok: boolean; error: string | null; duracion_ms: number }) {
    await this.db.from('sync_runs').insert({ ...reg, origen: 'tiendanube' }).then(({ error }) => error && undefined);
  }
}

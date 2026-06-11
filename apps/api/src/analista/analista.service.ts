import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

export type MensajeChat = { rol: 'usuario' | 'analista'; texto: string };

export type FilaAnalisis = {
  sku: string;
  producto: string;
  sucursal: string;
  sucursalId: string;
  stock: number;
  enTransito: number;
  ventasDia7: number;
  ventasDia30: number;
  diasDeStock: number | null;
  proveedor: string | null;
  proveedorId: string | null;
  leadTimeDias: number | null;
  costo: number | null;
  margenPct: number | null;
  estado: 'quiebre_inminente' | 'reponer' | 'sobrestock' | 'muerto' | 'ok';
  sugerido: number;
};

const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: {
      type: 'string',
      description: 'Análisis o respuesta para el comprador, en texto plano sin markdown',
    },
    ordenes: {
      type: 'array',
      description: 'Borradores de orden de compra concretos, solo si la respuesta propone comprar',
      items: {
        type: 'object',
        properties: {
          proveedor: { type: 'string', description: 'Razón social exacta del proveedor' },
          sucursal: { type: 'string', description: 'Nombre exacto de la sucursal destino' },
          motivo: { type: 'string', description: 'Una línea: por qué esta compra' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                cantidad: { type: 'number' },
              },
              required: ['sku', 'cantidad'],
              additionalProperties: false,
            },
          },
        },
        required: ['proveedor', 'sucursal', 'motivo', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['respuesta', 'ordenes'],
  additionalProperties: false,
} as const;

const PERSONALIDAD = `Sos el Analista ODB, el asesor de compras y abastecimiento de O.D.B Premium Market (outlet de bebidas, 2 sucursales, Argentina). Le hablás al comprador y al dueño: directo, ejecutivo, en español rioplatense, sin vueltas ni markdown.

Reglas estrictas:
- Trabajás SOLO con los números de la tabla de abajo: nunca inventes cifras, productos ni proveedores. Citá los números al recomendar (stock, días de cobertura, ritmo de venta).
- Prioridad 1: quiebres inminentes (días de stock <= plazo de entrega del proveedor). Eso es venta perdida.
- Prioridad 2: reposiciones normales. Prioridad 3: alertas de sobrestock y productos muertos (capital inmovilizado: sugerir liquidación con promo).
- Las cantidades sugeridas ya vienen calculadas (cobertura = plazo de entrega + 14 días). Podés ajustarlas con criterio comercial redondeando a bultos razonables, explicando por qué.
- Mencioná los aumentos de costos recientes cuando afecten la decisión (¿conviene stockearse antes del próximo aumento?).
- Si proponés una compra concreta, completá el campo "ordenes" agrupando por proveedor y sucursal, con los SKU exactos de la tabla.
- Si te preguntan algo que los datos no responden, decilo y pedí el dato.
- Máximo ~200 palabras en "respuesta".`;

@Injectable()
export class AnalistaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async metricas(): Promise<FilaAnalisis[]> {
    const hace30 = new Date(Date.now() - 30 * 86400_000).toISOString();
    const hace7 = new Date(Date.now() - 7 * 86400_000).toISOString();

    const [productosR, stockR, ventasR, transitoR] = await Promise.all([
      this.db
        .from('productos')
        .select('id, sku, nombre, costo, activo')
        .eq('activo', true),
      this.db
        .from('stock')
        .select('producto_id, sucursal_id, cantidad, punto_reposicion, sucursal:sucursales(nombre)'),
      this.db
        .from('ventas_items')
        .select('producto_id, cantidad, venta:ventas!inner(sucursal_id, vendida_en, estado)')
        .gte('venta.vendida_en', hace30)
        .eq('venta.estado', 'completada')
        .limit(10000),
      this.db
        .from('ordenes_compra_items')
        .select('producto_id, cantidad, cantidad_recibida, oc:ordenes_compra!inner(sucursal_id, estado)')
        .in('oc.estado', ['aprobada', 'enviada', 'recibida_parcial']),
    ]);
    if (productosR.error) throw new BadRequestException(productosR.error.message);

    const productos = productosR.data ?? [];
    const ids = productos.map((p: any) => p.id);
    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: ids });
    const precioPor = new Map((precios ?? []).map((r: any) => [r.producto_id, r]));

    // mejor proveedor (menor costo) por producto
    const { data: provs } = await this.db
      .from('proveedor_productos')
      .select('producto_id, ultimo_costo, proveedor:proveedores(id, razon_social, lead_time_dias)');
    const mejorProv = new Map<string, any>();
    for (const r of (provs ?? []) as any[]) {
      const previo = mejorProv.get(r.producto_id);
      if (!previo || Number(r.ultimo_costo ?? Infinity) < Number(previo.ultimo_costo ?? Infinity)) {
        mejorProv.set(r.producto_id, r);
      }
    }

    // ventas agregadas por producto×sucursal
    const vendidas = new Map<string, { u7: number; u30: number }>();
    for (const r of (ventasR.data ?? []) as any[]) {
      const clave = `${r.producto_id}|${r.venta.sucursal_id}`;
      const acumulado = vendidas.get(clave) ?? { u7: 0, u30: 0 };
      acumulado.u30 += Number(r.cantidad);
      if (r.venta.vendida_en >= hace7) acumulado.u7 += Number(r.cantidad);
      vendidas.set(clave, acumulado);
    }

    const transito = new Map<string, number>();
    for (const r of (transitoR.data ?? []) as any[]) {
      const clave = `${r.producto_id}|${r.oc.sucursal_id}`;
      transito.set(clave, (transito.get(clave) ?? 0) + Number(r.cantidad) - Number(r.cantidad_recibida));
    }

    const productoPor = new Map(productos.map((p: any) => [p.id, p]));
    const filas: FilaAnalisis[] = [];
    for (const st of (stockR.data ?? []) as any[]) {
      const p = productoPor.get(st.producto_id);
      if (!p) continue;
      const clave = `${st.producto_id}|${st.sucursal_id}`;
      const v = vendidas.get(clave) ?? { u7: 0, u30: 0 };
      const vd30 = v.u30 / 30;
      const vd7 = v.u7 / 7;
      const stock = Number(st.cantidad);
      const enTransito = transito.get(clave) ?? 0;
      const prov = mejorProv.get(st.producto_id);
      const lead = prov?.proveedor?.lead_time_dias ?? null;
      const diasDeStock = vd30 > 0 ? Math.round((stock / vd30) * 10) / 10 : null;
      const pr = precioPor.get(st.producto_id);
      const margenPct =
        pr && p.costo
          ? Math.round(((Number(pr.precio_final) - Number(p.costo)) / Number(p.costo)) * 1000) / 10
          : null;

      let estado: FilaAnalisis['estado'] = 'ok';
      if (vd30 === 0) estado = 'muerto';
      else if (lead != null && diasDeStock != null && diasDeStock <= lead) estado = 'quiebre_inminente';
      else if (stock + enTransito <= Number(st.punto_reposicion)) estado = 'reponer';
      else if (diasDeStock != null && diasDeStock > 60) estado = 'sobrestock';

      const sugerido =
        estado === 'quiebre_inminente' || estado === 'reponer'
          ? Math.max(Math.ceil(vd30 * ((lead ?? 7) + 14) - stock - enTransito), 0)
          : 0;

      filas.push({
        sku: p.sku,
        producto: p.nombre,
        sucursal: st.sucursal?.nombre ?? '—',
        sucursalId: st.sucursal_id,
        stock: Math.round(stock),
        enTransito: Math.round(enTransito),
        ventasDia7: Math.round(vd7 * 100) / 100,
        ventasDia30: Math.round(vd30 * 100) / 100,
        diasDeStock,
        proveedor: prov?.proveedor?.razon_social ?? null,
        proveedorId: prov?.proveedor?.id ?? null,
        leadTimeDias: lead,
        costo: p.costo != null ? Number(p.costo) : null,
        margenPct,
        estado,
        sugerido,
      });
    }

    const orden = { quiebre_inminente: 0, reponer: 1, sobrestock: 2, muerto: 3, ok: 4 };
    filas.sort((a, b) => orden[a.estado] - orden[b.estado] || (a.diasDeStock ?? 999) - (b.diasDeStock ?? 999));
    return filas;
  }

  async charlar(mensajes: MensajeChat[]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la ANTHROPIC_API_KEY en apps/api/.env');
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    const [filas, aumentos] = await Promise.all([this.metricas(), this.aumentosRecientes()]);
    const tabla = filas
      .map(
        (f) =>
          `${f.sku} · ${f.producto} · ${f.sucursal} · stock ${f.stock}${f.enTransito ? ` (+${f.enTransito} en tránsito)` : ''} · vende ${f.ventasDia30}/día (últ.7d: ${f.ventasDia7}/día) · cobertura ${f.diasDeStock ?? '∞'} días · prov: ${f.proveedor ?? 'sin asignar'} (entrega ${f.leadTimeDias ?? '?'}d, costo $${f.costo ?? '?'}) · margen ${f.margenPct ?? '?'}% · estado: ${f.estado.toUpperCase()}${f.sugerido ? ` · sugerido comprar ${f.sugerido}u` : ''}`,
      )
      .join('\n');

    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      system: [
        {
          type: 'text',
          text: `${PERSONALIDAD}\n\nTabla de abastecimiento (producto × sucursal), ordenada por urgencia:\n${tabla}\n\nAumentos de costo en los últimos 45 días:\n${aumentos}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA_RESPUESTA as any } },
      messages: mensajes.slice(-10).map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
    });

    const texto = respuesta.content.find((b) => b.type === 'text');
    const datos = JSON.parse(texto && 'text' in texto ? texto.text : '{"respuesta":"","ordenes":[]}');

    // Resuelvo nombres → ids para que la UI pueda crear las OC con un click
    const [{ data: provs }, { data: sucs }] = await Promise.all([
      this.db.from('proveedores').select('id, razon_social'),
      this.db.from('sucursales').select('id, nombre'),
    ]);
    const ordenes = (datos.ordenes ?? [])
      .map((o: any) => ({
        ...o,
        proveedorId: (provs ?? []).find((p) => p.razon_social === o.proveedor)?.id ?? null,
        sucursalId: (sucs ?? []).find((s) => s.nombre === o.sucursal)?.id ?? null,
      }))
      .filter((o: any) => o.proveedorId && o.sucursalId && o.items?.length);

    return { respuesta: datos.respuesta, ordenes };
  }

  private async aumentosRecientes(): Promise<string> {
    const hace45 = new Date(Date.now() - 45 * 86400_000).toISOString();
    const { data } = await this.db
      .from('costos_historial')
      .select('costo, creado_en, producto:productos(sku, nombre), proveedor:proveedores(razon_social)')
      .gte('creado_en', hace45)
      .order('creado_en', { ascending: true });
    if (!data?.length) return '(sin cambios de costo registrados)';

    const porProducto = new Map<string, any[]>();
    for (const r of data as any[]) {
      const sku = r.producto?.sku;
      if (!sku) continue;
      porProducto.set(sku, [...(porProducto.get(sku) ?? []), r]);
    }
    const lineas: string[] = [];
    for (const [sku, regs] of porProducto) {
      const ultimo = regs[regs.length - 1];
      lineas.push(
        `${sku} ${ultimo.producto.nombre}: costo nuevo $${Math.round(ultimo.costo)} (${ultimo.proveedor?.razon_social ?? '?'})`,
      );
    }
    return lineas.join('\n');
  }
}

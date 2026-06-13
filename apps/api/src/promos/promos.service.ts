import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { AnalistaService } from '../analista/analista.service';

// Borrador de promo que la UI puede crear con un click (POST /descuentos)
const ESQUEMA_PROPUESTAS = {
  type: 'object',
  properties: {
    promociones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre comercial corto' },
          motivo: { type: 'string', description: 'Una línea: por qué conviene esta promo ahora' },
          segmento: {
            type: 'string',
            enum: ['', 'nuevo', 'ocasional', 'frecuente', 'mayorista', 'vip'],
            description: 'Segmento de comportamiento objetivo, o vacío para todos',
          },
          alcance: { type: 'string', enum: ['global', 'categoria', 'marca', 'producto'] },
          sku: { type: 'string', description: 'Si alcance=producto, el SKU exacto de la tabla' },
          categoria: { type: 'string', description: 'Si alcance=categoria, el nombre exacto' },
          tipo: { type: 'string', enum: ['porcentaje', 'monto_fijo', 'precio_fijo'] },
          valor: { type: 'number' },
          diasVigencia: { type: 'number', description: 'Cuántos días debería durar' },
          soloComunidad: { type: 'boolean' },
        },
        required: ['nombre', 'motivo', 'segmento', 'alcance', 'tipo', 'valor', 'diasVigencia'],
        additionalProperties: false,
      },
    },
  },
  required: ['promociones'],
  additionalProperties: false,
} as const;

@Injectable()
export class PromosService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly analista: AnalistaService,
  ) {}

  // ---------- según stock (determinista, sin IA) ----------
  // Candidatos a promo: hay que mover la mercadería (sobrestock / sin rotación /
  // vencimiento próximo) y el margen banca el descuento.
  async segunStock() {
    const [filas, lotesR] = await Promise.all([
      this.analista.metricas(),
      this.db.from('lotes').select('vencimiento, cantidad, producto:productos(sku)').gt('cantidad', 0),
    ]);

    const porVencer = new Map<string, number>();
    const hoy = new Date().setHours(0, 0, 0, 0);
    for (const l of (lotesR.data ?? []) as any[]) {
      const dias = Math.round((new Date(l.vencimiento).getTime() - hoy) / 86400_000);
      const sku = l.producto?.sku;
      if (sku && dias >= 0 && dias <= 20) porVencer.set(sku, Math.min(porVencer.get(sku) ?? 999, dias));
    }

    const porSku = new Map<string, any>();
    for (const f of filas) {
      const previo = porSku.get(f.sku);
      const motivos: string[] = previo?.motivos ?? [];
      if (f.estado === 'sobrestock' && !motivos.includes('sobrestock')) motivos.push('sobrestock');
      if (f.estado === 'muerto' && !motivos.includes('sin rotación')) motivos.push('sin rotación');
      porSku.set(f.sku, {
        sku: f.sku,
        nombre: f.producto,
        margenPct: Math.max(previo?.margenPct ?? 0, f.margenPct ?? 0),
        stock: (previo?.stock ?? 0) + f.stock,
        capital: (previo?.capital ?? 0) + Math.round(f.stock * Number(f.costo ?? 0)),
        motivos,
      });
    }
    for (const [sku, dias] of porVencer) {
      const r = porSku.get(sku);
      if (r) r.motivos.push(`vence en ${dias} días`);
    }

    return [...porSku.values()]
      .filter((r) => r.motivos.length > 0 && r.margenPct >= 25)
      .map((r) => ({
        ...r,
        descuentoSugerido: r.motivos.some((m: string) => m.startsWith('vence'))
          ? 30
          : Math.min(Math.round(r.margenPct / 2), 25),
      }))
      .sort((a, b) => b.capital - a.capital)
      .slice(0, 15);
  }

  // ---------- sugeridas por IA ----------
  async sugerir() {
    this.exigirClave();
    const [candidatos, segmentos] = await Promise.all([this.segunStock(), this.ticketsSegmento()]);
    const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

    const tabla = candidatos.length
      ? candidatos
          .map(
            (c) =>
              `${c.sku} · ${c.nombre} · margen ${c.margenPct}% · stock ${c.stock} · capital $${c.capital} · ${c.motivos.join(', ')}`,
          )
          .join('\n')
      : '(sin productos con sobrestock/vencimiento ahora)';
    const segTxt = segmentos
      .map((s) => `${s.etiqueta}: ${s.clientes} clientes, ticket ${s.ticketPromedio ?? '—'}`)
      .join(' · ');

    const datos = await this.claude(
      `Sos el estratega de promociones de O.D.B Premium Market (outlet de bebidas con almacén y fiambrería, 2 sucursales, Argentina). Hoy es ${hoy}. Proponé 3 a 5 promociones CONCRETAS y rentables.

Reglas:
- Usá SOLO los SKU/datos de abajo. El margen tiene que bancar el descuento (no propongas % que deje el producto por debajo del costo).
- Priorizá mover el capital inmovilizado (sobrestock, sin rotación) y lo que vence pronto (ahí el descuento puede ser mayor).
- Segmentá por comportamiento cuando convenga: a los de ticket alto, fidelización; a los de ticket bajo, empuje. Es segmentación por CONDUCTA, nunca socioeconómica.
- Tené en cuenta el calendario comercial argentino (fechas, estación, fútbol, fines de semana).
- Cada promo: nombre corto, motivo en una línea, segmento, alcance, tipo y valor, días de vigencia.

Productos candidatos (mover stock):
${tabla}

Segmentos de clientes (ticket promedio):
${segTxt}`,
      ESQUEMA_PROPUESTAS,
    );
    return { promociones: datos.promociones ?? [] };
  }

  // ---------- por contexto (IA temática) ----------
  async porContexto(contexto: string) {
    this.exigirClave();
    if (!contexto?.trim()) throw new BadRequestException('Indicá un contexto (ej: "partido de Argentina")');
    const catalogo = await this.catalogoConStock(120);
    const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

    const datos = await this.claude(
      `Sos el estratega de promociones de O.D.B Premium Market (Argentina). Hoy es ${hoy}.
Armá 3 o 4 promociones temáticas para este contexto: "${contexto.trim()}".

Reglas:
- Usá SOLO productos del catálogo de abajo (SKU exactos). Elegí lo que pega con la ocasión (ej: para un partido → cervezas, snacks, picada).
- Descuentos rentables. Podés apuntar a un segmento o a todos.
- Nombres con gancho, atados a la ocasión. Motivo en una línea.

Catálogo con stock y precio:
${catalogo}`,
      ESQUEMA_PROPUESTAS,
    );
    return { promociones: datos.promociones ?? [] };
  }

  // ---------- rendimiento (determinista) ----------
  // Para cada promo, cuánto se vendió de su alcance durante su ventana activa.
  async rendimiento() {
    const { data: descuentos } = await this.db
      .from('descuentos')
      .select('id, nombre, alcance, tipo, valor, desde, hasta, segmento, categoria_id, marca_id, producto_id, activo')
      .order('desde', { ascending: false })
      .limit(20);

    const ahora = new Date();
    const resultados: any[] = [];
    for (const d of (descuentos ?? []) as any[]) {
      const desde = new Date(d.desde).toISOString();
      const hasta = new Date(Math.min(new Date(d.hasta).getTime(), ahora.getTime())).toISOString();
      if (new Date(d.desde) > ahora) continue; // todavía no arrancó

      // ids de producto del alcance
      let productoIds: string[] | null = null;
      if (d.alcance === 'producto') productoIds = [d.producto_id];
      else if (d.alcance === 'categoria') productoIds = await this.idsPorCol('categoria_id', d.categoria_id);
      else if (d.alcance === 'marca') productoIds = await this.idsPorCol('marca_id', d.marca_id);

      let unidades = 0;
      let facturado = 0;
      // global: medimos el total vendido en la ventana (proxy de impacto)
      let query = this.db
        .from('ventas_items')
        .select('cantidad, precio_unitario, venta:ventas!inner(vendida_en, estado)')
        .gte('venta.vendida_en', desde)
        .lte('venta.vendida_en', hasta)
        .eq('venta.estado', 'completada')
        .limit(5000);
      if (productoIds) {
        if (!productoIds.length) {
          resultados.push({ ...this.resumenPromo(d), unidades: 0, facturado: 0 });
          continue;
        }
        query = query.in('producto_id', productoIds.slice(0, 300));
      }
      const { data: items } = await query;
      for (const i of (items ?? []) as any[]) {
        unidades += Number(i.cantidad);
        facturado += Number(i.cantidad) * Number(i.precio_unitario);
      }
      resultados.push({ ...this.resumenPromo(d), unidades: Math.round(unidades), facturado: Math.round(facturado) });
    }
    return resultados.sort((a, b) => b.facturado - a.facturado);
  }

  // ---------- anuncio para pauta (IA) ----------
  async anuncio(body: { nombre?: string; descripcion?: string; segmento?: string; red?: string }) {
    this.exigirClave();
    const red = body.red ?? 'Instagram/Facebook (Meta)';
    const datos = await this.claude(
      `Sos el redactor publicitario de O.D.B Premium Market (outlet de bebidas y almacén, Argentina, tono cercano y vendedor, español rioplatense).
Escribí un aviso para ${red} de esta promoción: "${body.nombre ?? 'Promoción'}"${body.descripcion ? ` (${body.descripcion})` : ''}${body.segmento ? `, dirigido al público ${body.segmento}` : ''}.

Devolvé: un titular de hasta 8 palabras, un cuerpo de 2 a 3 líneas, un llamado a la acción, y 5 a 8 hashtags relevantes. Sin inventar precios que no estén en la promo.`,
      {
        type: 'object',
        properties: {
          titular: { type: 'string' },
          cuerpo: { type: 'string' },
          cta: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          publicoMeta: { type: 'string', description: 'Sugerencia de segmentación de público para el administrador de anuncios de Meta' },
        },
        required: ['titular', 'cuerpo', 'cta', 'hashtags', 'publicoMeta'],
        additionalProperties: false,
      },
    );
    return datos;
  }

  // ---------- helpers ----------
  private resumenPromo(d: any) {
    const ahora = new Date();
    const estado = !d.activo
      ? 'inactivo'
      : ahora < new Date(d.desde)
        ? 'programado'
        : ahora > new Date(d.hasta)
          ? 'vencido'
          : 'vigente';
    return {
      id: d.id,
      nombre: d.nombre,
      alcance: d.alcance,
      tipo: d.tipo,
      valor: Number(d.valor),
      segmento: d.segmento,
      desde: d.desde,
      hasta: d.hasta,
      estado,
    };
  }

  private async idsPorCol(col: string, valor: string): Promise<string[]> {
    if (!valor) return [];
    const { data } = await this.db.from('productos').select('id').eq(col, valor).limit(2000);
    return (data ?? []).map((p: any) => p.id);
  }

  private async ticketsSegmento() {
    const SEG = ['nuevo', 'ocasional', 'frecuente', 'mayorista', 'vip'];
    const ETIQ: Record<string, string> = {
      nuevo: 'Nuevos', ocasional: 'Ocasionales', frecuente: 'Frecuentes', mayorista: 'Mayoristas', vip: 'VIP',
    };
    const { data: clientes } = await this.db.from('clientes').select('id, tipo').limit(5000);
    const idTipo = new Map((clientes ?? []).map((c: any) => [c.id, c.tipo]));
    const acc = new Map(SEG.map((s) => [s, { clientes: 0, suma: 0, n: 0 }]));
    for (const c of clientes ?? []) {
      const a = acc.get((c as any).tipo);
      if (a) a.clientes += 1;
    }
    const { data: ventas } = await this.db
      .from('ventas')
      .select('total, cliente_id')
      .eq('estado', 'completada')
      .not('cliente_id', 'is', null)
      .limit(5000);
    for (const v of ventas ?? []) {
      const a = acc.get(idTipo.get((v as any).cliente_id));
      if (a) { a.suma += Number((v as any).total); a.n += 1; }
    }
    return SEG.map((s) => {
      const a = acc.get(s)!;
      return { etiqueta: ETIQ[s], clientes: a.clientes, ticketPromedio: a.n ? Math.round(a.suma / a.n) : null };
    });
  }

  private async catalogoConStock(limite: number) {
    const { data: prods } = await this.db
      .from('productos')
      .select('id, sku, nombre, categoria:categorias(nombre), stock(cantidad)')
      .eq('activo', true)
      .limit(1500);
    const conStock = (prods ?? []).filter(
      (p: any) => (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) > 0,
    );
    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: conStock.map((p: any) => p.id) });
    const precioPor = new Map((precios ?? []).map((r: any) => [r.producto_id, Number(r.precio_final)]));
    return conStock
      .filter((p: any) => precioPor.get(p.id))
      .slice(0, limite)
      .map((p: any) => `${p.sku} · ${p.nombre} · ${p.categoria?.nombre ?? 'sin rubro'} · $${Math.round(precioPor.get(p.id) ?? 0)}`)
      .join('\n');
  }

  private exigirClave() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la ANTHROPIC_API_KEY en apps/api/.env');
    }
  }

  private async claude(prompt: string, schema: any): Promise<any> {
    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } } as any,
    });
    const texto = respuesta.content.find((b) => b.type === 'text');
    return JSON.parse(texto && 'text' in texto ? texto.text : '{}');
  }
}

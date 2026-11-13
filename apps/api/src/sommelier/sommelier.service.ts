import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { TONO_ODB } from '../comun/tono-odb';
import { traerTodo } from '../comun/lotes';
import { conDescuentoEfectivo, tieneDescuentoEfectivo } from '../bot/descuento-efectivo';
import { lineaDeLaCava, vinosDeLaRespuesta, type VinoDeLaCava } from './vinos-recomendados';
import { nombreDeSucursal, tipoDeCategoria, type CavaPanel, type VinoCava } from './cava';

export type MensajeChat = { rol: 'usuario' | 'somelier'; texto: string };

/** Lo que manda la pantalla del panel: la charla, el local y los vinos que el vendedor está mirando. */
export type PedidoVendedor = {
  mensajes: MensajeChat[];
  /** El local donde está el cliente (solo vinos con stock ahí). */
  sucursal?: string;
  /** Los SKU de la lista que ve el vendedor, en su orden (los primeros 160). */
  candidatos?: string[];
  /** Lo que eligió en los filtros, en palabras: «Para un asado · Tinto · hasta $ 20.000». */
  busca?: string;
};

// Cuántos vinos lee el somelier por consulta: con 160 renglones son unos 8.000
// tokens de cava (se guardan en la caché de Anthropic mientras dure la charla).
const TOPE_CANDIDATOS = 160;

// El somelier del panel le habla al VENDEDOR, no al cliente (13/11/2026). El
// de la web pregunta antes de recomendar; acá el vendedor tiene al cliente
// adelante o en el WhatsApp y ya dijo lo que busca con los filtros: recomendar
// directo, tres opciones distintas, con una línea que se le pueda decir al
// cliente. El formato «Nombre — $precio: porqué» es el que lee
// vinosDeLaRespuesta para dibujar la placa.
const PERSONALIDAD_VENDEDOR = `Sos el Somelier ODB, el sommelier de O.D.B Premium Market, un outlet de bebidas argentino. Ayudás a un VENDEDOR de ODB que está atendiendo a un cliente, en el local o por WhatsApp: te escribe el vendedor, no el cliente. Hablás en español rioplatense, claro y sin esnobismo.

Cómo trabajás:
- El vendedor ya filtró la cava con lo que pide el cliente (abajo, «Lo que busca el cliente») y te pasa los vinos que está mirando, con el stock de su local. Elegís SOLO de esa lista.
- Recomendá directo, sin interrogar. Por defecto 3 opciones y bien distintas entre sí: 1) la apuesta segura para lo que pide, 2) una alternativa de otro estilo, cepa o bodega, 3) una para subir un escalón o la que está en promo. Si el vendedor pide otra cantidad, respetala.
- Un vino por renglón, con este formato exacto: «Nombre tal cual figura — $precio: por qué», y el porqué en una línea que el vendedor le pueda decir al cliente (maridaje, estilo, ocasión, por qué conviene).
- Si el pedido es muy vago y no hay filtros, igual recomendá variado y al final hacé UNA pregunta corta que ayudaría a afinar.
- Si te preguntan por un vino puntual, contestá sobre ese vino (estilo, con qué va, a quién le gusta) y, si sirve, sumá una alternativa de la lista.
- Si te piden «otras opciones», no repitas las que ya diste.
- Si en la lista no hay nada que sirva, decilo y sugerí qué filtro aflojar (el precio, el tipo, el otro local).

Reglas estrictas:
- Jamás inventes etiquetas ni recomiendes vinos que no estén en la lista.
- CRÍTICO: el tipo de cada botella es el que figura ENTRE PARÉNTESIS (su categoría real), nunca lo que sugiera el nombre. Jamás llames espumante a un vino tinto, blanco o rosado, ni al revés.
- Mencioná siempre el precio de lista tal cual figura (el precio en efectivo lo calcula el sistema: no lo escribas). Si tiene promo, decilo.
- Respuestas cortas: máximo 120 palabras. Texto plano: nada de markdown, asteriscos, negritas ni emojis.

${TONO_ODB}`;

const PERSONALIDAD = `Sos el Somelier ODB, el sommelier virtual de O.D.B Premium Market, un outlet de bebidas argentino. Hablás en español rioplatense, claro y sin esnobismo: explicás el vino con precisión y respeto, sin cata académica y sin familiaridad.

Cómo conversás (IMPORTANTE):
- NO recomiendes vino de entrada. Primero entendé qué necesita la persona. Un buen sommelier pregunta antes de sugerir.
- Al arrancar, o cuando el pedido es vago ("quiero un vino", "algo rico", "hola"), hacé 1 o 2 preguntas cortas y corteses para orientarte: ¿para qué ocasión / con qué comida?, ¿qué estilo te gusta (tinto/blanco/espumante, más suave o con cuerpo)?, ¿en qué presupuesto por botella pensás? Preguntá lo que falte, no lo que ya te dijeron.
- Recién recomendá cuando tengas al menos la ocasión o el gusto Y una idea del presupuesto. Si la persona ya te dio todo eso en su mensaje, no la hagas repetir: recomendá directo.
- Si la persona pide explícitamente que le recomendes ya o dice "lo que sea / me da igual", ahí sí sugerí sin más vueltas (guiándote por lo poco que tengas).

Reglas estrictas:
- Solo recomendás vinos y espumantes de la cava de ODB que figura abajo, con stock disponible. Jamás inventes etiquetas ni menciones vinos que no estén en la lista.
- CRÍTICO — el tipo de cada botella es el que figura ENTRE PARÉNTESIS en la cava (su categoría real), nunca lo que te sugiera el nombre de fantasía. Jamás llames "champagne" o "espumante" a algo cuya categoría diga "Vino Tinto"/"Vino Blanco"/"Vino Rosado", ni al revés. Si vas a decir tinto/blanco/rosado/espumante/champagne, verificá la categoría entre paréntesis antes de escribirlo. Confundir esto es el peor error que podés cometer: arruina la confianza del cliente.
- Cuando recomendás: mencioná siempre el precio (y si tiene promo, destacala), de a 2 o 3 opciones máximo, con una línea de por qué cada una (maridaje, ocasión, estilo).
- Si piden algo que no hay en la cava, decilo con honestidad y ofrecé la alternativa más parecida.
- Si el presupuesto es ajustado, nunca hagas sentir mal al cliente: el mejor vino es el que se disfruta.
- Respuestas cortas: máximo 100 palabras. Cuando preguntás, todavía más breve (1-2 líneas). Sin vocabulario rebuscado.
- Texto plano: nada de markdown, asteriscos ni negritas. Sin emojis.
- Venta de alcohol solo a mayores de 18. Si hay señales de minoría de edad, no recomiendes y sugerí opciones sin alcohol.

${TONO_ODB}`;

const GUIA_SIN_HISTORIAL = `CLIENTE SIN HISTORIAL: todavía no sabés qué le gusta ni cuánto gasta. Con más razón: preguntá antes de recomendar (ocasión/comida, estilo y presupuesto por botella), salvo que ya te lo haya dicho o te pida que recomendes directo.`;

@Injectable()
export class SommelierService {
  private readonly log = new Logger(SommelierService.name);

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Techo diario de consultas. El sommelier es el ÚNICO endpoint de IA abierto
  // a internet (lo usa la app de clientes sin sesión de la casa): con 8
  // consultas por minuto y por IP, un abuso sostenido gasta crédito de
  // Anthropic sin que nadie lo note hasta la factura. Al llegar al tope
  // contesta amablemente sin llamar al modelo. Es un freno de gasto, no una
  // contabilidad: si el proceso reinicia, vuelve a cero.
  private usoDelDia = { dia: '', consultas: 0 };

  private superaTechoDiario(): boolean {
    const hoy = new Date().toISOString().slice(0, 10);
    if (this.usoDelDia.dia !== hoy) this.usoDelDia = { dia: hoy, consultas: 0 };
    const tope = Number(process.env.SOMMELIER_MAX_DIA ?? 300);
    this.usoDelDia.consultas++;
    if (this.usoDelDia.consultas > tope) {
      if (this.usoDelDia.consultas === tope + 1) {
        this.log.warn(`sommelier: llegó al tope de ${tope} consultas del día; se corta hasta mañana`);
      }
      return true;
    }
    return false;
  }

  async charlar(mensajes: MensajeChat[], clienteId?: string) {
    if (this.superaTechoDiario()) {
      return {
        respuesta: 'Por hoy el somelier ya atendió muchas consultas. Escribinos por WhatsApp al 11 2281-2200 y te ayudamos, o volvé a probar mañana.',
        recomendaciones: [],
      };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'El Somelier ODB necesita la ANTHROPIC_API_KEY en apps/api/.env para funcionar',
      );
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    const [cava, guiaPerfil] = await Promise.all([this.cava(), this.perfilCliente(clienteId)]);
    const texto = await this.preguntar(
      `${PERSONALIDAD}\n\nCava de ODB disponible ahora (sku · etiqueta (TIPO REAL entre paréntesis) · precio final · stock · descripción si hay):\n${cava.map(lineaDeLaCava).join('\n')}`,
      `INSTRUCCIÓN PERSONALIZADA PARA ESTA CHARLA:\n${guiaPerfil}`,
      mensajes,
    );
    // `respuesta` sigue siendo el texto entero (la app de clientes muestra eso).
    // Los vinos recomendados viajan además estructurados, con los precios de la
    // cava, para que el panel los dibuje en la Placa roja; `introduccion` y
    // `cierre` son el texto sin esos renglones (2/10/2026).
    return { respuesta: texto, ...vinosDeLaRespuesta(texto, cava) };
  }

  // La llamada al modelo, la misma para la web y para el panel: Sonnet 5 con
  // razonamiento, la cava en un bloque que se guarda en caché y lo propio de
  // la charla aparte.
  private async preguntar(conCava: string, propio: string, mensajes: MensajeChat[]): Promise<string> {
    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-sonnet-5',
      // 6/10/2026: Sonnet 5 razona aunque no se lo pida y el razonamiento sale de
      // este mismo tope: con 1024 la recomendación se podía cortar o salir vacía
      // (guía de Anthropic, «Migrating to Claude Sonnet 5»). Se paga lo que se usa.
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: [
        // la cava cambia poco entre mensajes de una charla: cacheable
        { type: 'text', text: conCava, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: propio },
      ],
      messages: mensajes.slice(-12).map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
    });
    const bloque = respuesta.content.find((b) => b.type === 'text');
    return bloque && 'text' in bloque ? bloque.text : '';
  }

  // ------------------------------------------------------------------
  // EL SOMELIER DEL PANEL (13/11/2026): la cava entera por local y el pedido
  // del vendedor. La web de clientes sigue con charlar().
  // ------------------------------------------------------------------

  // Techo aparte del de la web: si alguien abusa del somelier público, el del
  // local sigue andando.
  private usoPanel = { dia: '', consultas: 0 };
  private superaTechoPanel(): boolean {
    const hoy = new Date().toISOString().slice(0, 10);
    if (this.usoPanel.dia !== hoy) this.usoPanel = { dia: hoy, consultas: 0 };
    const tope = Number(process.env.SOMMELIER_MAX_DIA_PANEL ?? 600);
    this.usoPanel.consultas++;
    return this.usoPanel.consultas > tope;
  }

  // La cava se arma en ~2 s (unos 2.000 productos, sus precios y su stock) y
  // cambia con cada venta, pero no tanto como para pedirla en cada filtro: se
  // guarda 5 minutos y la siguiente se arma mientras se muestra la anterior.
  private cavaGuardada: { en: number; datos: CavaPanel } | null = null;
  private cavaEnCamino: Promise<CavaPanel> | null = null;

  async cavaPanel(): Promise<CavaPanel> {
    const fresca = this.cavaGuardada && Date.now() - this.cavaGuardada.en < 5 * 60_000;
    if (fresca) return this.cavaGuardada!.datos;
    if (!this.cavaEnCamino) {
      this.cavaEnCamino = this.armarCava()
        .then((datos) => {
          this.cavaGuardada = { en: Date.now(), datos };
          return datos;
        })
        .finally(() => { this.cavaEnCamino = null; });
    }
    // vieja pero de hace menos de media hora: se muestra ya y se renueva por detrás
    if (this.cavaGuardada && Date.now() - this.cavaGuardada.en < 30 * 60_000) {
      this.cavaEnCamino.catch((e) => this.log.warn(`cava del somelier: ${e?.message ?? e}`));
      return this.cavaGuardada.datos;
    }
    return this.cavaEnCamino;
  }

  private async armarCava(): Promise<CavaPanel> {
    const [productos, sucursales, notas] = await Promise.all([
      traerTodo<any>((desde, hasta) =>
        this.db
          .from('productos')
          .select('id, sku, nombre, descripcion, unidades_vendidas, marca:marcas(nombre), categoria:categorias!inner(nombre), stock(sucursal_id, cantidad)')
          .eq('activo', true)
          .or('nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champagne%', { referencedTable: 'categoria' })
          .order('id')
          .range(desde, hasta),
      ),
      this.db.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
      traerTodo<any>((desde, hasta) => this.db.from('notas_cata').select('producto_id, maridaje').order('producto_id').range(desde, hasta)),
    ]);
    if (sucursales.error) throw new BadRequestException(sucursales.error.message);

    const conStock = productos
      .map((p: any) => {
        const stock: Record<string, number> = {};
        for (const s of p.stock ?? []) {
          const n = Math.floor(Number(s.cantidad) || 0);
          if (n > 0) stock[s.sucursal_id] = (stock[s.sucursal_id] ?? 0) + n;
        }
        return { p, stock };
      })
      .filter((x) => Object.keys(x.stock).length > 0);

    // precios de a 500 (como el Analista): el RPC va por POST, pero no se arriesga
    const ids = conStock.map((x) => x.p.id);
    const precioPor = new Map<string, any>();
    const tandas: string[][] = [];
    for (let i = 0; i < ids.length; i += 500) tandas.push(ids.slice(i, i + 500));
    const respuestas = await Promise.all(tandas.map((t) => this.db.rpc('catalogo_precios', { p_ids: t })));
    for (const { data, error } of respuestas) {
      if (error) throw new BadRequestException(error.message);
      for (const r of (data ?? []) as any[]) precioPor.set(r.producto_id, r);
    }
    const maridajePor = new Map<string, string>(notas.filter((n: any) => n.maridaje).map((n: any) => [n.producto_id, String(n.maridaje)]));

    const vinos: VinoCava[] = conStock
      .map(({ p, stock }): VinoCava => {
        const pr = precioPor.get(p.id);
        const precio = Math.round(Number(pr?.precio_final ?? 0));
        const categoria = p.categoria?.nombre ? String(p.categoria.nombre).replace(/\s+/g, ' ').trim() : null;
        const antes = Math.round(Number(pr?.precio_lista ?? 0));
        return {
          sku: p.sku,
          nombre: String(p.nombre ?? '').trim(),
          bodega: p.marca?.nombre ? String(p.marca.nombre).trim() : null,
          categoria,
          ...tipoDeCategoria(categoria),
          descripcion: p.descripcion ? String(p.descripcion).trim() : null,
          maridaje: maridajePor.get(p.id) ?? null,
          precio,
          precioEfectivo: precio > 0 && tieneDescuentoEfectivo(categoria) ? conDescuentoEfectivo(precio) : null,
          promo: pr?.descuento_nombre && antes > precio ? { nombre: String(pr.descuento_nombre), antes } : null,
          stock,
          vendidas: Math.max(0, Math.round(Number(p.unidades_vendidas ?? 0))),
        };
      })
      // sin precio no se le puede recomendar a nadie
      .filter((v) => v.precio > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    return {
      sucursales: (sucursales.data ?? []).map((s: any) => ({ id: s.id, nombre: nombreDeSucursal(s.nombre) })),
      vinos,
      generada: new Date().toISOString(),
    };
  }

  async vendedor(pedido: PedidoVendedor) {
    const mensajes = Array.isArray(pedido?.mensajes) ? pedido.mensajes.filter((m) => m && typeof m.texto === 'string' && m.texto.trim()) : [];
    if (!mensajes.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del vendedor');
    }
    if (this.superaTechoPanel()) {
      return { respuesta: 'Por hoy el somelier ya contestó muchas consultas: vuelve a andar mañana. Mientras, la cava de la derecha sigue ordenada para lo que busca el cliente.', recomendaciones: [], introduccion: '', cierre: '', vistos: 0 };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la clave de Anthropic en el servidor: el somelier no puede contestar');
    }

    const cava = await this.cavaPanel();
    const sucursal = cava.sucursales.find((s) => s.id === pedido.sucursal) ?? null;
    const enElLocal = (v: VinoCava) => (sucursal ? v.stock[sucursal.id] ?? 0 : Object.values(v.stock).reduce((a, b) => a + b, 0));
    const porSku = new Map(cava.vinos.map((v) => [v.sku, v]));

    // los que mira el vendedor, en su orden; si no mandó lista, los que más hay
    let elegidos: VinoCava[] = Array.isArray(pedido.candidatos) && pedido.candidatos.length
      ? [...new Set(pedido.candidatos.map(String))].map((s) => porSku.get(s)).filter((v): v is VinoCava => !!v)
      : [...cava.vinos].sort((a, b) => enElLocal(b) - enElLocal(a));
    elegidos = elegidos.filter((v) => enElLocal(v) > 0).slice(0, TOPE_CANDIDATOS);

    const donde = sucursal ? `en ${sucursal.nombre}` : 'en los locales';
    if (!elegidos.length) {
      return {
        respuesta: `Con esos filtros no queda ningún vino ${donde}. Probá aflojar el precio o el tipo, o mirá el otro local.`,
        recomendaciones: [], introduccion: '', cierre: '', vistos: 0,
      };
    }

    // el renglón de siempre (lineaDeLaCava), con el stock del local del cliente
    const paraElModelo: VinoDeLaCava[] = elegidos.map((v) => ({
      id: v.sku,
      sku: v.sku,
      nombre: v.nombre,
      categoria: v.categoria,
      descripcion: [v.bodega ? `bodega ${v.bodega}` : '', v.descripcion ?? '', v.maridaje ? `maridaje: ${v.maridaje}` : ''].filter(Boolean).join('. ') || null,
      stock: enElLocal(v),
      precio: v.precio,
      promo: v.promo,
    }));

    const busca = String(pedido.busca ?? '').trim().slice(0, 400);
    const texto = await this.preguntar(
      `${PERSONALIDAD_VENDEDOR}\n\nLos vinos que está mirando el vendedor, con stock ${donde} (sku · etiqueta (TIPO REAL entre paréntesis) · precio de lista · stock en el local · descripción):\n${paraElModelo.map(lineaDeLaCava).join('\n')}`,
      `Lo que busca el cliente (filtros del vendedor): ${busca || 'no eligió filtros'}. El cliente está ${sucursal ? `en ${sucursal.nombre}` : 'sin local elegido'}. Son ${elegidos.length} vinos en la lista.`,
      mensajes,
    );
    return { respuesta: texto, ...vinosDeLaRespuesta(texto, paraElModelo), vistos: elegidos.length };
  }

  // Decide la estrategia del somelier: si el cliente tiene historial, recomienda
  // según lo que gasta; si no, instruye a preguntar el presupuesto primero.
  private async perfilCliente(clienteId?: string): Promise<string> {
    if (!clienteId) return GUIA_SIN_HISTORIAL;
    try {
      const [{ data: cli }, { data: perfil }] = await Promise.all([
        this.db.from('clientes').select('tipo').eq('id', clienteId).maybeSingle(),
        this.db.rpc('perfil_somelier', { p_cliente: clienteId }),
      ]);
      const p: any = Array.isArray(perfil) ? perfil[0] : perfil;
      const compras = Number(p?.compras ?? 0);
      if (compras < 1) return GUIA_SIN_HISTORIAL;

      const ticket = Math.round(Number(p?.ticket_promedio ?? 0));
      const vinoItems = Number(p?.vino_items ?? 0);
      const vinoPrecio = Math.round(Number(p?.vino_precio_prom ?? 0));
      const tipo = cli?.tipo ? String(cli.tipo) : null;

      const lineas = [
        'PERFIL DE ESTE CLIENTE (ya lo conocés — NO le preguntes el presupuesto):',
        `- Hizo ${compras} compra${compras === 1 ? '' : 's'}; ticket promedio $${ticket}.`,
      ];
      if (tipo) lineas.push(`- Segmento: ${tipo}.`);
      if (vinoItems > 0 && vinoPrecio >= 1000) {
        lineas.push(`- En vinos suele pagar alrededor de $${vinoPrecio} por botella.`);
        lineas.push(
          'Ya sabés su presupuesto, así que NO se lo preguntes. Pero igual entendé primero la ocasión o la comida si no la dijo (una pregunta corta); recién ahí recomendá 2-3 vinos en su franja (podés sumar UNA opción algo superior "para una ocasión especial"). Si ya te dio la ocasión o pide que recomendes directo, no preguntes: sugerí.',
        );
      } else {
        lineas.push('- Todavía no compró vinos; usá su nivel de gasto general como referencia.');
        lineas.push(
          'No le preguntes el presupuesto (usá su nivel de gasto). Pero entendé primero la ocasión o el gusto con una pregunta corta si no lo dijo; recién ahí recomendá 2-3 vinos acordes.',
        );
      }
      return lineas.join('\n');
    } catch {
      // ante cualquier problema, no bloqueamos la charla
      return GUIA_SIN_HISTORIAL;
    }
  }

  // La cava sale como datos (2/10/2026): el modelo la lee en texto
  // (lineaDeLaCava, el mismo renglón de siempre) y con los mismos datos se
  // arman los vinos que recomendó, con su precio, promo y efectivo.
  private async cava(): Promise<VinoDeLaCava[]> {
    // el catálogo real divide los vinos en muchos rubros: matchea por prefijo
    const { data, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, descripcion, categoria:categorias!inner(nombre), stock(cantidad)')
      .eq('activo', true)
      .or('nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champagne%', {
        referencedTable: 'categoria',
      });
    if (error) throw new BadRequestException(error.message);

    const conStock = (data ?? [])
      .map((p: any) => ({
        ...p,
        stockTotal: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0),
      }))
      .filter((p: any) => p.stockTotal > 0)
      // la cava que ve el somelier: los 80 con más stock (los que conviene mover)
      .sort((a: any, b: any) => b.stockTotal - a.stockTotal)
      .slice(0, 80);
    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: conStock.map((p: any) => p.id),
    });
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));

    return conStock.map((p: any): VinoDeLaCava => {
      const pr = precioPor.get(p.id);
      const stockTotal = (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0);
      return {
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        // la categoría entre paréntesis es la ÚNICA fuente de verdad del tipo de
        // bebida (tinto/blanco/rosado/espumante/champagne) — el nombre de fantasía
        // no alcanza para saberlo con certeza. La descripción (si hay) suma matiz.
        categoria: p.categoria?.nombre || null,
        descripcion: p.descripcion || null,
        stock: Math.round(stockTotal),
        precio: Math.round(pr?.precio_final ?? 0),
        promo: pr?.descuento_nombre ? { nombre: String(pr.descuento_nombre), antes: Math.round(pr.precio_lista) } : null,
      };
    });
  }
}

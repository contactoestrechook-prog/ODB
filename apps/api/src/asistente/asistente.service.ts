import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CatalogoService } from '../catalogo/catalogo.service';
import { respuestaSinVueltas } from '../comun/sin-vueltas';
import { armarRespuesta, grupoDeRespaldo, type PropuestaModelo } from './armar-respuesta';

// Asistente de compras de la tienda online (11/9/2026). Pedido de Leandro:
// «que tenga un botón y ahí empezar a usar la inteligencia artificial: que le
// pueda escribir o mandar audio de lo que está buscando, que se le despliegue
// todo lo de ese sector y empiece a agregar al carrito. Una compra súper
// guiada, súper intuitiva, orgánica».
//
// Busca con el MISMO buscador de la tienda (CatalogoService): mismos precios,
// mismas fotos, mismo carrito. El modelo no puede mostrar nada que no haya
// salido de una búsqueda de esta charla (armar-respuesta.ts lo controla).
const MODELO = process.env.ASISTENTE_MODELO ?? 'claude-opus-4-8';

const SYSTEM = `Sos el asistente de compras de la tienda online de O.D.B Premium Market, un premium market de Canning: almacén gourmet, fiambrería, quesos, bebidas, bodega, dulces y regalería, unos 10.000 productos. Envío a domicilio, retiro en el local y pick-up al auto.

La persona te escribe o te habla lo que está buscando. Tu trabajo es MOSTRARLE productos reales para que los agregue al carrito, rápido y con buen criterio.

Cómo trabajás:
- Antes de mostrar algo, buscalo con la herramienta buscar. Nunca inventes productos, marcas ni precios.
- Hacé TODAS las búsquedas que necesitás juntas, en una misma vuelta (varias llamadas a buscar a la vez), y después respondé. Buscar de a una hace esperar a la persona.
- Buscá con términos cortos, como los escribiría alguien en un buscador: "malbec", "queso brie", "jamón crudo", "grisines", "fernet".
- Si pide algo compuesto (una picada, un asado, un regalo, una cena), buscá cada parte por separado y armá un grupo por parte: por ejemplo Quesos, Fiambres, Para acompañar, Vino.
- Si falta un dato (para cuántas personas, presupuesto, tinto o blanco), igual mostrá una primera propuesta y al final preguntá UNA sola cosa. Nunca contestes solo con preguntas.
- Si una búsqueda no trae nada, probá otra palabra antes de decir que no hay.
- Priorizá lo que tiene stock. Si lo único que hay está sin stock, decilo.
- Entre opciones parecidas, preferí las que tienen foto (conFoto: true): la persona elige mirando. Una sin foto, solo si no hay otra igual de buena.
- Algunos productos se venden por peso (porKilo: true): su precio es por KILO. Para una picada o algo para compartir, preferí lo envasado o feteado (por ejemplo "jamón crudo feteado", "queso en hebras", "salame x 100 g"). Si mostrás algo por kilo, aclaralo en el mensaje ("el jamón es por kilo, lo pedís por peso").
- Terminá SIEMPRE llamando a responder, con los skus exactos que devolvió buscar.

Cómo hablás: de vos, cálido y corto, como alguien del local que conoce la mercadería. Dos o tres oraciones como mucho: los productos hablan solos en la pantalla. Nada de listas ni markdown en el mensaje. No repitas precios en el texto: ya se ven en cada producto.

Las sugerencias son 3 o 4 botones cortos para seguir (menos de 40 caracteres cada uno), escritos como los diría la persona: "Sumale un vino", "Algo sin TACC", "Más barato", "Para 10 personas".`;

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'buscar',
    description: 'Busca en el catálogo real de la tienda. Devuelve hasta 10 productos con sku, nombre, precio, categoría y si hay stock. Única fuente válida de productos y precios.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Término corto de búsqueda (nombre, marca, tipo de producto)' },
        precioMax: { type: ['number', 'null'], description: 'Precio máximo por unidad, si la persona dio un presupuesto. null si no.' },
      },
      required: ['q', 'precioMax'],
      additionalProperties: false,
    },
  },
  {
    name: 'responder',
    description: 'Lo que se le muestra a la persona: el mensaje, los grupos de productos (con skus que salieron de buscar) y las sugerencias para seguir. Llamala una sola vez, al final.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', description: 'Dos o tres oraciones, de vos, sin listas ni precios.' },
        grupos: {
          type: 'array',
          description: 'De 1 a 4 grupos. Cada uno con un título corto y de 2 a 6 skus.',
          items: {
            type: 'object',
            properties: { titulo: { type: 'string' }, skus: { type: 'array', items: { type: 'string' } } },
            required: ['titulo', 'skus'],
            additionalProperties: false,
          },
        },
        sugerencias: { type: 'array', items: { type: 'string' }, description: '3 o 4 botones cortos para seguir.' },
      },
      required: ['mensaje', 'grupos', 'sugerencias'],
      additionalProperties: false,
    },
  },
];

// Se vende por peso: la marca del producto, o "x fracción" en el nombre (así
// los nombra el sistema viejo). Su precio es por kilo.
export const esPorKilo = (p: any) => !!(p?.porPeso || p?.vendidoPorPeso || /\bx\s*fracci[oó]n\b|fraccionad|\bx\s*kg\b/i.test(String(p?.nombre ?? '')));

export type MensajeAsistente = { rol: 'usuario' | 'asistente'; texto: string };

@Injectable()
export class AsistenteService {
  private readonly log = new Logger(AsistenteService.name);
  constructor(private readonly catalogo: CatalogoService) {}

  async charlar(mensajes: MensajeAsistente[], verificado = false, segmento?: string) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('El asistente no está disponible en este momento.');
    const limpios = (mensajes ?? [])
      .filter((m) => m && (m.rol === 'usuario' || m.rol === 'asistente') && String(m.texto ?? '').trim())
      .slice(-12)
      .map((m) => ({ rol: m.rol, texto: String(m.texto).trim().slice(0, 600) }));
    if (!limpios.length || limpios[limpios.length - 1].rol !== 'usuario') {
      throw new BadRequestException('Contame qué estás buscando.');
    }

    const claude = new Anthropic();
    const vistos = new Map<string, any>();
    const busquedas: { q: string; skus: string[] }[] = [];
    const historial: Anthropic.MessageParam[] = limpios.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.texto }));
    const yaDicho = limpios.filter((m) => m.rol === 'asistente').map((m) => m.texto);
    const limite = Date.now() + 50_000;
    let propuesta: PropuestaModelo | null = null;
    let textoSuelto = '';

    for (let vuelta = 0; vuelta < 6 && !propuesta; vuelta++) {
      const queda = limite - Date.now();
      if (queda < 5_000) break;
      let res: Anthropic.Message;
      try {
        res = await claude.messages.create(
          {
            model: MODELO,
            max_tokens: 2500,
            // Una compra guiada tiene que contestar rápido: esfuerzo bajo. Las
            // cuentas y los precios no los hace el modelo, salen del catálogo.
            output_config: { effort: 'low' as any },
            system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
            tools: HERRAMIENTAS,
            messages: historial,
          },
          { signal: AbortSignal.timeout(queda) },
        );
      } catch (e) {
        this.log.warn(`asistente falló: ${e instanceof Error ? e.message : e}`);
        break;
      }

      const pedidos = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      textoSuelto = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim() || textoSuelto;
      if (!pedidos.length) break;

      historial.push({ role: 'assistant', content: res.content });
      // Las búsquedas que el modelo pidió juntas corren en simultáneo: de a una,
      // una picada con cuatro partes hacía esperar 30 segundos.
      const hallados = new Map<string, any[]>();
      await Promise.all(
        pedidos.filter((p) => p.name === 'buscar').map(async (p) => {
          const input = p.input as any;
          hallados.set(p.id, await this.buscar(String(input.q ?? ''), input.precioMax, verificado, segmento));
        }),
      );
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const p of pedidos) {
        const input = p.input as any;
        if (p.name === 'responder') {
          propuesta = input;
          resultados.push({ type: 'tool_result', tool_use_id: p.id, content: 'ok' });
          continue;
        }
        if (p.name === 'buscar') {
          const encontrados = hallados.get(p.id) ?? [];
          for (const it of encontrados) vistos.set(it.sku, it);
          busquedas.push({ q: String(input.q ?? ''), skus: encontrados.map((x) => x.sku) });
          resultados.push({
            type: 'tool_result',
            tool_use_id: p.id,
            content: JSON.stringify(
              encontrados.map((x) => ({ sku: x.sku, nombre: x.nombre, precio: x.precio, porKilo: esPorKilo(x), conFoto: !!x.imagenUrl, categoria: x.categoria, marca: x.marca, sinStock: x.stockTotal != null && x.stockTotal <= 0 })),
            ),
          });
          continue;
        }
        resultados.push({ type: 'tool_result', tool_use_id: p.id, content: 'herramienta desconocida', is_error: true });
      }
      if (propuesta) break;
      historial.push({ role: 'user', content: resultados });
    }

    const armada = propuesta
      ? armarRespuesta(propuesta, vistos)
      : { mensaje: textoSuelto, grupos: grupoDeRespaldo(busquedas, vistos), sugerencias: [] as string[] };
    if (!armada.grupos.length && !armada.mensaje) {
      armada.mensaje = 'No encontré eso con esas palabras. Contámelo de otra forma, o decime la marca o para qué lo querés.';
    }
    const mensaje = respuestaSinVueltas(armada.mensaje || 'Mirá lo que encontré.', yaDicho).texto;
    return { ...armada, mensaje };
  }

  // El mismo buscador de la tienda: con foto primero, precio del segmento del cliente.
  private async buscar(q: string, precioMax: unknown, verificado: boolean, segmento?: string) {
    const termino = q.trim().slice(0, 60);
    if (termino.length < 2) return [];
    const r: any = await this.catalogo.buscarProductos({ buscar: termino, porPagina: 12, pagina: 1, orden: 'foto' }, verificado, segmento);
    const max = typeof precioMax === 'number' && precioMax > 0 ? precioMax : null;
    const items: any[] = (r?.items ?? []).filter((p: any) => p.precio != null && (max == null || Number(p.precio) <= max));
    // lo que tiene stock, primero
    items.sort((a, b) => Number((b.stockTotal ?? 1) > 0) - Number((a.stockTotal ?? 1) > 0));
    return items.slice(0, 10);
  }
}

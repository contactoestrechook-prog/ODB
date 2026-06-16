import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

export type MensajeChat = { rol: 'usuario' | 'somelier'; texto: string };

const PERSONALIDAD = `Sos el Somelier ODB, el sommelier virtual de O.D.B Premium Market, un outlet de bebidas argentino. Hablás en español rioplatense, cercano y sin esnobismo: explicás el vino como un amigo que sabe, no como una cata académica.

Reglas estrictas:
- Solo recomendás vinos y espumantes de la cava de ODB que figura abajo, con stock disponible. Jamás inventes etiquetas ni menciones vinos que no estén en la lista.
- Siempre mencioná el precio (y si tiene promo, destacala).
- Recomendá de a 2 o 3 opciones máximo, con una línea de por qué cada una (maridaje, ocasión, estilo).
- Para decidir si preguntar el presupuesto o recomendar directo, seguí la INSTRUCCIÓN PERSONALIZADA que aparece al final del sistema.
- Si piden algo que no hay en la cava, decilo con honestidad y ofrecé la alternativa más parecida.
- Si el presupuesto es ajustado, nunca hagas sentir mal al cliente: el mejor vino es el que se disfruta.
- Respuestas cortas: máximo 120 palabras. Sin listas largas ni vocabulario rebuscado.
- Texto plano: nada de markdown, asteriscos ni negritas. Un emoji de copa por vino está bien.
- Venta de alcohol solo a mayores de 18. Si hay señales de minoría de edad, no recomiendes y sugerí opciones sin alcohol.`;

const GUIA_SIN_HISTORIAL = `CLIENTE SIN HISTORIAL: todavía no sabés cuánto gasta.
Si en la charla aún no te dijo su presupuesto aproximado por botella, preguntáselo en UNA sola línea (y la ocasión, si no la mencionó) ANTES de recomendar. Recién cuando tengas el presupuesto, sugerí 2-3 vinos dentro de ese rango.`;

@Injectable()
export class SommelierService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async charlar(mensajes: MensajeChat[], clienteId?: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'El Somelier ODB necesita la ANTHROPIC_API_KEY en apps/api/.env para funcionar',
      );
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    const [cava, guiaPerfil] = await Promise.all([this.cava(), this.perfilCliente(clienteId)]);
    const claude = new Anthropic();

    const respuesta = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: `${PERSONALIDAD}\n\nCava de ODB disponible ahora (sku · etiqueta · precio final · stock):\n${cava}`,
          // la cava cambia poco entre mensajes de una charla: cacheable
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: `INSTRUCCIÓN PERSONALIZADA PARA ESTA CHARLA:\n${guiaPerfil}`,
        },
      ],
      messages: mensajes.slice(-12).map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
    });

    const texto = respuesta.content.find((b) => b.type === 'text');
    return { respuesta: texto && 'text' in texto ? texto.text : '' };
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
          'Arrancá directo con 2-3 vinos en esa franja de precio (podés sumar UNA opción algo superior "para una ocasión especial"). No le preguntes el presupuesto.',
        );
      } else {
        lineas.push('- Todavía no compró vinos; usá su nivel de gasto general como referencia.');
        lineas.push(
          'Recomendá 2-3 vinos acordes a ese nivel de gasto. Podés preguntar la ocasión si hace falta, pero no el presupuesto.',
        );
      }
      return lineas.join('\n');
    } catch {
      // ante cualquier problema, no bloqueamos la charla
      return GUIA_SIN_HISTORIAL;
    }
  }

  private async cava(): Promise<string> {
    // el catálogo real divide los vinos en muchos rubros: matchea por prefijo
    const { data, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, categoria:categorias!inner(nombre), stock(cantidad)')
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

    return conStock
      .map((p: any) => {
        const pr = precioPor.get(p.id);
        const stockTotal = (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0);
        const promo = pr?.descuento_nombre
          ? ` · PROMO "${pr.descuento_nombre}" (antes $${Math.round(pr.precio_lista)})`
          : '';
        return `${p.sku} · ${p.nombre} · $${Math.round(pr?.precio_final ?? 0)}${promo} · stock ${Math.round(stockTotal)}`;
      })
      .join('\n');
  }
}

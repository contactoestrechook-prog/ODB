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
- Si no conocés la ocasión, el gusto o el presupuesto del cliente, preguntá primero (una sola pregunta corta).
- Si piden algo que no hay en la cava, decilo con honestidad y ofrecé la alternativa más parecida.
- Si el presupuesto es ajustado, nunca hagas sentir mal al cliente: el mejor vino es el que se disfruta.
- Respuestas cortas: máximo 120 palabras. Sin listas largas ni vocabulario rebuscado.
- Texto plano: nada de markdown, asteriscos ni negritas. Un emoji de copa por vino está bien.
- Venta de alcohol solo a mayores de 18. Si hay señales de minoría de edad, no recomiendes y sugerí opciones sin alcohol.`;

@Injectable()
export class SommelierService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async charlar(mensajes: MensajeChat[]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'El Somelier ODB necesita la ANTHROPIC_API_KEY en apps/api/.env para funcionar',
      );
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    const cava = await this.cava();
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
      ],
      messages: mensajes.slice(-12).map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: m.texto,
      })),
    });

    const texto = respuesta.content.find((b) => b.type === 'text');
    return { respuesta: texto && 'text' in texto ? texto.text : '' };
  }

  private async cava(): Promise<string> {
    const { data, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, categoria:categorias!inner(nombre), stock(cantidad)')
      .eq('activo', true)
      .in('categoria.nombre', ['Vinos', 'Espumantes']);
    if (error) throw new BadRequestException(error.message);

    const conStock = (data ?? []).filter(
      (p: any) => (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) > 0,
    );
    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: conStock.map((p: any) => p.id),
    });
    const precioPor = new Map((precios ?? []).map((r: any) => [r.producto_id, r]));

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

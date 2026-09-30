import { BadRequestException, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CartaService } from '../carta/carta.service';

export type MensajeChat = { rol: 'cliente' | 'anfitrion'; texto: string };
export type Idioma = 'es' | 'pt' | 'en';

const NOMBRE_IDIOMA: Record<Idioma, string> = { es: 'español rioplatense', pt: 'português do Brasil', en: 'English' };

const PERSONALIDAD = (idioma: Idioma) => `Sos el Anfitrión de Gran Caminito, un asador de Puerto Iguazú (Argentina).
Respondé siempre en ${NOMBRE_IDIOMA[idioma]}, close y cálido, sin sonar a folleto.

Reglas estrictas:
- Recomendá SOLO platos y bebidas que figuren en la carta de abajo. Jamás inventes algo que no esté.
- Siempre mencioná el precio.
- Sugerí de a 2-3 opciones máximo, con una línea de por qué (maridaje, para compartir, si es fuerte o liviano).
- Si preguntan por vino para acompañar una carne, priorizá tintos de la carta.
- Si piden algo que no está en la carta, decilo con honestidad y ofrecé lo más parecido.
- Respuestas cortas: máximo 90 palabras. Texto plano, nada de markdown ni asteriscos. Un emoji está bien, no abuses.
- Sos anfitrión, no mozo: no tomás el pedido, solo ayudás a elegir.`;

@Injectable()
export class AnfitrionService {
  constructor(private readonly carta: CartaService) {}

  async charlar(mensajes: MensajeChat[], idioma: Idioma = 'es') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('El Anfitrión necesita ANTHROPIC_API_KEY en apps/gastro-api/.env para funcionar');
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'cliente') {
      throw new BadRequestException('El último mensaje debe ser del cliente');
    }

    const { categorias } = await this.carta.publica();
    const cartaTexto = categorias
      .map((c: any) => `${c.nombre}:\n` + c.items.map((i: any) => `- ${i.nombre}: $${i.precio}${i.descripcion ? ` (${i.descripcion})` : ''}`).join('\n'))
      .join('\n\n');

    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      system: [
        { type: 'text', text: `${PERSONALIDAD(idioma)}\n\nCarta de Gran Caminito:\n${cartaTexto}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: mensajes.map((m) => ({ role: m.rol === 'cliente' ? ('user' as const) : ('assistant' as const), content: m.texto })),
    });

    const bloque = respuesta.content.find((b) => b.type === 'text');
    return { texto: bloque && 'text' in bloque ? bloque.text.trim() : '' };
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

const PERSONALIDAD = `Sos quien responde las reseñas de Google de Gran Caminito, un asador en Puerto Iguazú.
Tono cercano, agradecido, nunca genérico ni robótico. Respondé en el mismo idioma de la reseña
(español, portugués o inglés). Si la reseña es positiva: agradecé algo concreto que mencionó (un
plato, la atención, etc.), sin exagerar. Si es negativa: pedí disculpas de verdad, sin excusas
vacías, y ofrecé un canal para que vuelvan a contactarlos. Máximo 3 oraciones. Sin emojis de más
(como mucho uno). Nunca inventes promociones ni promesas que el restaurante no pueda cumplir.`;

@Injectable()
export class ResenasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar(estado?: string) {
    let query = this.db.from('resenas_google').select('*').order('creado_en', { ascending: false });
    if (estado) query = query.eq('respuesta_estado', estado);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Carga manual mientras no haya OAuth con el Google Business Profile real de
  // Gran Caminito (ver .env.example): el encargado copia la reseña nueva acá,
  // o se arma un importador cuando el acceso esté aprobado.
  async cargarManual(input: { autor: string; rating: number; texto: string; idioma?: string }) {
    const { data, error } = await this.db
      .from('resenas_google')
      .insert({
        autor: input.autor,
        rating: input.rating,
        texto: input.texto,
        idioma: input.idioma ?? 'es',
        respuesta_estado: 'pendiente',
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async generarRespuesta(id: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta ANTHROPIC_API_KEY en apps/gastro-api/.env');
    }
    const { data: resena, error } = await this.db.from('resenas_google').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!resena) throw new NotFoundException('No existe esa reseña');

    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system: PERSONALIDAD,
      messages: [
        {
          role: 'user',
          content: `Reseña de ${resena.autor} (${resena.rating}★, idioma: ${resena.idioma}):\n"${resena.texto}"`,
        },
      ],
    });
    const bloque = respuesta.content.find((b) => b.type === 'text');
    const texto = bloque && 'text' in bloque ? bloque.text.trim() : '';

    const { data: actualizada, error: errUpd } = await this.db
      .from('resenas_google')
      .update({ respuesta_ia: texto, respuesta_estado: 'borrador' })
      .eq('id', id)
      .select()
      .single();
    if (errUpd) throw new BadRequestException(errUpd.message);
    return actualizada;
  }

  // Damián aprueba el texto (puede editarlo antes). Esto NO la publica en
  // Google todavía: publicar requiere la Business Profile API + que Damián
  // autorice el acceso OAuth a su cuenta real — ver publicar() más abajo.
  async aprobar(id: string, textoFinal?: string) {
    const patch: Record<string, any> = { respuesta_estado: 'aprobada' };
    if (textoFinal) patch.respuesta_ia = textoFinal;
    const { data, error } = await this.db.from('resenas_google').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe esa reseña');
    return data;
  }

  // TODO(integración real): Google Business Profile API (accounts.locations.reviews.updateReply)
  // requiere OAuth de la cuenta de Gran Caminito en Google — pendiente de que Damián
  // la autorice. Hasta entonces esto solo marca el estado; la respuesta se pega a mano
  // en Google Maps con el texto ya aprobado acá.
  async marcarPublicadaManualmente(id: string) {
    const { data, error } = await this.db
      .from('resenas_google')
      .update({ respuesta_estado: 'publicada', publicado_en: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe esa reseña');
    return data;
  }
}

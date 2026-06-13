import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

// Difusiones de WhatsApp con cumplimiento: SOLO a clientes con opt-in y teléfono.
// El envío real usa la API oficial de WhatsApp Business (Cloud API) con
// plantillas aprobadas — pendiente de credenciales (WHATSAPP_TOKEN/PHONE_ID).
@Injectable()
export class DifusionesService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private configurado() {
    return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  }

  // Audiencia elegible = opt-in + teléfono (+ filtros). Nunca incluye a quien no consintió.
  async audiencia(q: { segmento?: string; soloComunidad?: boolean }) {
    let query = this.db
      .from('clientes')
      .select('id, nombre, telefono', { count: 'exact' })
      .eq('acepta_marketing', true)
      .not('telefono', 'is', null);
    if (q.segmento) query = query.eq('tipo', q.segmento);
    if (q.soloComunidad) query = query.eq('verificado', true);
    const { data, count, error } = await query.limit(10);
    if (error) throw new BadRequestException(error.message);

    // total de clientes con teléfono pero SIN opt-in (no se les puede escribir)
    let sinOptIn = this.db
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('acepta_marketing', false)
      .not('telefono', 'is', null);
    if (q.segmento) sinOptIn = sinOptIn.eq('tipo', q.segmento);
    const { count: noContactables } = await sinOptIn;

    return {
      elegibles: count ?? 0,
      muestra: (data ?? []).map((c: any) => c.nombre ?? 'Cliente'),
      noContactables: noContactables ?? 0,
      configurado: this.configurado(),
    };
  }

  async redactar(contexto: string) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('Falta la ANTHROPIC_API_KEY');
    const claude = new Anthropic();
    const r = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Escribí un mensaje de difusión de WhatsApp para los clientes de O.D.B Premium Market (outlet de bebidas y almacén, Argentina, tono cercano rioplatense). Contexto: "${contexto || 'novedades y ofertas de la semana'}".
Reglas: breve (máx 4 líneas), 1 emoji como mucho, con un llamado a la acción claro. NO inventar precios. Terminá SIEMPRE con la línea de baja: "Respondé BAJA para no recibir más mensajes." Devolvé solo el texto del mensaje, sin comillas.`,
      }],
    });
    const t = r.content.find((b) => b.type === 'text');
    return { mensaje: t && 'text' in t ? t.text.trim() : '' };
  }

  async listar() {
    const { data, error } = await this.db
      .from('difusiones')
      .select('id, titulo, mensaje, segmento, solo_comunidad, audiencia, enviados, estado, creado_en')
      .order('creado_en', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async crear(dto: { titulo: string; mensaje: string; segmento?: string; soloComunidad?: boolean; usuarioId?: string }) {
    if (!dto.mensaje?.trim()) throw new BadRequestException('El mensaje no puede estar vacío');
    if (!/baja/i.test(dto.mensaje)) {
      throw new BadRequestException('El mensaje debe incluir la opción de baja (ej: "Respondé BAJA para no recibir más").');
    }
    const aud = await this.audiencia({ segmento: dto.segmento, soloComunidad: dto.soloComunidad });
    if (aud.elegibles === 0) {
      throw new BadRequestException('No hay clientes con opt-in y teléfono para esa audiencia.');
    }

    // Envío real solo con la Cloud API configurada; si no, queda pendiente.
    const configurado = this.configurado();
    const { data, error } = await this.db
      .from('difusiones')
      .insert({
        titulo: dto.titulo || 'Difusión',
        mensaje: dto.mensaje.trim(),
        segmento: dto.segmento || null,
        solo_comunidad: dto.soloComunidad ?? false,
        audiencia: aud.elegibles,
        enviados: 0,
        estado: 'pendiente',
        usuario_id: dto.usuarioId ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    // TODO(whatsapp): cuando haya WHATSAPP_TOKEN/PHONE_ID, enviar por tandas
    // con plantilla aprobada y actualizar enviados/estado.
    return {
      id: data.id,
      audiencia: aud.elegibles,
      estado: 'pendiente',
      configurado,
      aviso: configurado
        ? 'Difusión encolada para envío por la API oficial de WhatsApp.'
        : 'Difusión guardada. Para enviarla hay que conectar WhatsApp Business (Cloud API): falta WHATSAPP_TOKEN y WHATSAPP_PHONE_ID. Así el envío es oficial y no penalizado.',
    };
  }
}

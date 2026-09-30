import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type Sentimiento = 'contento' | 'neutral' | 'molesto';

@Injectable()
export class TermometroService {
  private readonly logger = new Logger('Termometro');

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Regla de reputación limpia (sin atajos): se pregunta a TODOS por igual y a
  // TODOS se les agradece igual. La bifurcación de acá abajo no es "filtrar
  // quién va a Google" — es "quién necesita una disculpa YA, con el cliente
  // todavía sentado en la mesa". El link de Google se muestra siempre igual.
  async registrar(mesaToken: string, sentimiento: Sentimiento, comentario?: string) {
    const { data: mesa, error: errMesa } = await this.db
      .from('mesas')
      .select('id, numero')
      .eq('qr_token', mesaToken)
      .maybeSingle();
    if (errMesa) throw new BadRequestException(errMesa.message);
    if (!mesa) throw new BadRequestException('Mesa inválida');

    const { data: opinion, error } = await this.db
      .from('opiniones')
      .insert({ mesa_id: mesa.id, sentimiento, comentario: comentario ?? null })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    if (sentimiento === 'molesto' || sentimiento === 'neutral') {
      await this.crearAlerta(mesa.id, mesa.numero, opinion.id, sentimiento, comentario);
    }

    return {
      opinionId: opinion.id,
      // solo a los contentos se los invita a Google — no es filtrado deshonesto:
      // es que un cliente molesto ya recibió lo que necesita (la alerta al
      // encargado), no una redirección a dejar una mala reseña sin resolver antes.
      linkGoogle: sentimiento === 'contento' ? process.env.GOOGLE_REVIEW_LINK ?? null : null,
    };
  }

  private async crearAlerta(
    mesaId: string,
    numeroMesa: number,
    opinionId: string,
    sentimiento: Sentimiento,
    comentario?: string,
  ) {
    const { data: alerta, error } = await this.db
      .from('alertas_encargado')
      .insert({ mesa_id: mesaId, opinion_id: opinionId, sentimiento, atendida: false })
      .select()
      .single();
    if (error) {
      this.logger.error(`No se pudo registrar la alerta de mesa ${numeroMesa}: ${error.message}`);
      return;
    }
    await this.notificarEncargado(numeroMesa, sentimiento, comentario, alerta.id);
  }

  // Envío real a WhatsApp Business Cloud API — requiere alta en Meta (ver
  // .env.example). Hasta entonces, la alerta queda en la tabla y visible en el
  // panel (que es lo que realmente importa: que el encargado la vea al instante),
  // y acá solo se deja el log + el punto de enchufe ya armado.
  private async notificarEncargado(numeroMesa: number, sentimiento: Sentimiento, comentario: string | undefined, alertaId: string) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const destino = process.env.WHATSAPP_ENCARGADO_NUMERO;
    const texto = `⚠ Mesa ${numeroMesa} — cliente ${sentimiento}${comentario ? `: "${comentario}"` : ''}`;

    if (!token || !phoneId || !destino) {
      this.logger.warn(`[alerta #${alertaId}] ${texto} (WhatsApp no configurado todavía — ver .env.example)`);
      return;
    }
    try {
      await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destino,
          type: 'text',
          text: { body: texto },
        }),
      });
    } catch (e: any) {
      this.logger.error(`Falló el envío de WhatsApp para la alerta #${alertaId}: ${e.message}`);
    }
  }

  // --- administración ---

  async listarAlertas(soloPendientes = true) {
    let query = this.db
      .from('alertas_encargado')
      .select('*, mesa:mesas(numero, sector), opinion:opiniones(comentario, sentimiento, creado_en)')
      .order('creado_en', { ascending: false });
    if (soloPendientes) query = query.eq('atendida', false);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resolverAlerta(id: string) {
    const { error } = await this.db.from('alertas_encargado').update({ atendida: true }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async resumen(dias = 30) {
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    const { data, error } = await this.db
      .from('opiniones')
      .select('sentimiento')
      .gte('creado_en', desde);
    if (error) throw new BadRequestException(error.message);
    const total = data?.length ?? 0;
    const contar = (s: Sentimiento) => (data ?? []).filter((o: any) => o.sentimiento === s).length;
    return {
      total,
      contento: contar('contento'),
      neutral: contar('neutral'),
      molesto: contar('molesto'),
      tasaSatisfaccion: total ? Math.round((contar('contento') / total) * 100) : null,
    };
  }
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

const TIEMPO_CAFE_MIN = 3;

const MENSAJE_POST_VISITA: Record<'es' | 'pt' | 'en', (nombre: string | null, link: string | null) => string> = {
  es: (n, l) => `¡Hola${n ? ` ${n}` : ''}! Gracias por venir a Gran Caminito. Esperamos que la hayan pasado bien.${l ? ` Si tenés un minuto, tu opinión en Google nos ayuda mucho: ${l}` : ''}`,
  pt: (n, l) => `Olá${n ? ` ${n}` : ''}! Obrigado pela visita ao Gran Caminito. Esperamos que tenham gostado.${l ? ` Se tiver um minuto, sua avaliação no Google nos ajuda muito: ${l}` : ''}`,
  en: (n, l) => `Hi${n ? ` ${n}` : ''}! Thank you for visiting Gran Caminito. We hope you enjoyed it.${l ? ` If you have a minute, a Google review helps us a lot: ${l}` : ''}`,
};

@Injectable()
export class ClientesService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // "Dejá tu WhatsApp → café de cortesía". La base de clientes es el único
  // activo que queda de un turista que no vuelve; el café es el incentivo
  // verificable (a diferencia de "instalá la app", que no se puede chequear).
  // Un canje por mesa por visita (índice único sobre ciclo_id).
  async canjearCafe(token: string, telefono: string, nombre?: string, idioma?: string) {
    const tel = (telefono ?? '').replace(/\D/g, '');
    if (tel.length < 8) throw new BadRequestException('Dejanos un número de WhatsApp válido (con código de país)');

    const { data: mesa, error: errMesa } = await this.db.from('mesas').select('id, numero').eq('qr_token', token).maybeSingle();
    if (errMesa) throw new BadRequestException(errMesa.message);
    if (!mesa) throw new NotFoundException('Mesa no encontrada');

    const { data: ciclo, error: errCiclo } = await this.db
      .from('mesa_ciclos')
      .select('id')
      .eq('mesa_id', mesa.id)
      .neq('estado', 'libre')
      .maybeSingle();
    if (errCiclo) throw new BadRequestException(errCiclo.message);
    if (!ciclo) throw new NotFoundException('Tu mesa no figura activa — pedile al mozo que la registre y probá de nuevo');

    const { error: errContacto } = await this.db.from('contactos').insert({
      telefono: tel,
      nombre: nombre?.trim() || null,
      idioma: ['pt', 'en'].includes(idioma ?? '') ? idioma : 'es',
      mesa_id: mesa.id,
      ciclo_id: ciclo.id,
    });
    if (errContacto) {
      if (errContacto.code === '23505') throw new BadRequestException('Esta mesa ya canjeó su café en esta visita ☕');
      throw new BadRequestException(errContacto.message);
    }

    // El café entra a la cola de cocina como cualquier plato, a $0: el mozo
    // no tiene que acordarse de nada y queda auditado quién lo pidió.
    const { error: errCafe } = await this.db.from('comanda_items').insert({
      ciclo_id: ciclo.id,
      nombre: 'Café de cortesía ☕ (canje WhatsApp)',
      cantidad: 1,
      tiempo_coccion_min: TIEMPO_CAFE_MIN,
    });
    if (errCafe) throw new BadRequestException(errCafe.message);

    return { ok: true, mensaje: 'Listo: tu café ya está en marcha ☕' };
  }

  // El después de la visita: a quien dejó su WhatsApp, un mensaje al día
  // siguiente con el agradecimiento y el link a Google. A todos por igual y
  // sin premio (política de Google). No se manda solo: devuelve el link de
  // WhatsApp de cada uno, y se anota cuando se abrió.
  async postVisita() {
    const desde = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const hasta = new Date(Date.now() - 10 * 3_600_000).toISOString(); // que haya pasado una noche
    const { data, error } = await this.db
      .from('contactos')
      .select('*, mesa:mesas(numero)')
      .gte('creado_en', desde)
      .lte('creado_en', hasta)
      .order('creado_en', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const link = process.env.GOOGLE_REVIEW_LINK && process.env.GOOGLE_REVIEW_LINK !== '...' ? process.env.GOOGLE_REVIEW_LINK : null;
    const filas = (data ?? []).map((c: any) => {
      const idioma: 'es' | 'pt' | 'en' = ['pt', 'en'].includes(c.idioma) ? c.idioma : 'es';
      const mensaje = MENSAJE_POST_VISITA[idioma](c.nombre, link);
      return {
        id: c.id, nombre: c.nombre, telefono: c.telefono, idioma, mesaNumero: c.mesa?.numero ?? null,
        visitaEn: c.creado_en, enviadoEn: c.post_visita_enviado_en ?? null,
        mensaje, waLink: `https://wa.me/${c.telefono}?text=${encodeURIComponent(mensaje)}`,
      };
    });
    return { hayLinkGoogle: !!link, pendientes: filas.filter((f) => !f.enviadoEn), enviados: filas.filter((f) => f.enviadoEn) };
  }

  async marcarPostVisita(id: string, enviado = true) {
    const { data, error } = await this.db
      .from('contactos')
      .update({ post_visita_enviado_en: enviado ? new Date().toISOString() : null })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese contacto');
    return { ok: true };
  }

  async listar() {
    const { data, error } = await this.db
      .from('contactos')
      .select('*, mesa:mesas(numero, sector)')
      .order('creado_en', { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resumen() {
    const { count, error } = await this.db.from('contactos').select('*', { count: 'exact', head: true });
    if (error) throw new BadRequestException(error.message);
    const desde = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { count: mes, error: err2 } = await this.db
      .from('contactos')
      .select('*', { count: 'exact', head: true })
      .gte('creado_en', desde);
    if (err2) throw new BadRequestException(err2.message);
    return { total: count ?? 0, ultimos30Dias: mes ?? 0 };
  }
}

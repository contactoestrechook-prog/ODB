import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

const TIEMPO_CAFE_MIN = 3;

@Injectable()
export class ClientesService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // "Dejá tu WhatsApp → café de cortesía". La base de clientes es el único
  // activo que queda de un turista que no vuelve; el café es el incentivo
  // verificable (a diferencia de "instalá la app", que no se puede chequear).
  // Un canje por mesa por visita (índice único sobre ciclo_id).
  async canjearCafe(token: string, telefono: string, nombre?: string) {
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

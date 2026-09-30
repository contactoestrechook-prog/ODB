import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class MesasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db.from('mesas').select('*').order('sector').order('numero');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // El token es lo único que viaja en el QR (nada de exponer el id interno de
  // la mesa en una URL pública). Un token por mesa, fijo: se imprime una vez.
  async crear(numero: number, sector?: string) {
    const token = randomUUID();
    const { data, error } = await this.db
      .from('mesas')
      .insert({ numero, sector: sector ?? null, qr_token: token, activa: true })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Validación pública: el cliente escaneó el QR, ¿es una mesa real y activa?
  async validarToken(token: string) {
    const { data, error } = await this.db
      .from('mesas')
      .select('id, numero, sector, activa')
      .eq('qr_token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || !data.activa) throw new NotFoundException('Mesa no encontrada o inactiva');
    return data;
  }

  async desactivar(id: string) {
    const { error } = await this.db.from('mesas').update({ activa: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}

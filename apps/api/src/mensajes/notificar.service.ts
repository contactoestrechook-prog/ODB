import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enviarPush } from '../facturacion/push';

// Servicio central: registra la notificación en la base y dispara el push.
// Lo usan las solicitudes, los envíos manuales y las automáticas.
@Injectable()
export class NotificarService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async aCliente(clienteId: string, titulo: string, cuerpo: string, tipo = 'general') {
    await this.db.from('notificaciones').insert({ cliente_id: clienteId, titulo, cuerpo, tipo });
    const { data } = await this.db
      .from('clientes')
      .select('expo_push_token')
      .eq('id', clienteId)
      .maybeSingle();
    if (data?.expo_push_token) await enviarPush(data.expo_push_token, titulo, cuerpo);
  }

  async aClientes(ids: string[], titulo: string, cuerpo: string, tipo = 'general') {
    const limpios = [...new Set(ids.filter(Boolean))];
    if (!limpios.length) return 0;
    // la noti en la app les llega a todos; el push, solo a quienes tienen token
    await this.db.from('notificaciones').insert(
      limpios.map((cliente_id) => ({ cliente_id, titulo, cuerpo, tipo })),
    );
    const { data } = await this.db
      .from('clientes')
      .select('expo_push_token')
      .in('id', limpios);
    const tokens = (data ?? []).map((r: any) => r.expo_push_token).filter(Boolean);
    await Promise.allSettled(tokens.map((t: string) => enviarPush(t, titulo, cuerpo)));
    return limpios.length;
  }
}

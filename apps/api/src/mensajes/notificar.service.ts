import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enviarPush } from '../facturacion/push';

// Servicio central: registra la notificación en la base y dispara el push.
// Lo usan las solicitudes, los envíos manuales y las automáticas.
@Injectable()
export class NotificarService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Devuelve si salió el push al celular: sin token, el aviso queda solo en la
  // cuenta del cliente en la app y nadie se entera (21/10/2026: Eventos decía
  // "le llegó" sin que le llegara nada).
  async aCliente(clienteId: string, titulo: string, cuerpo: string, tipo = 'general'): Promise<{ push: boolean }> {
    await this.db.from('notificaciones').insert({ cliente_id: clienteId, titulo, cuerpo, tipo });
    const { data } = await this.db
      .from('clientes')
      .select('expo_push_token')
      .eq('id', clienteId)
      .maybeSingle();
    // enviarPush descarta en silencio un token que no es de Expo
    if (!String(data?.expo_push_token ?? '').startsWith('ExponentPushToken')) return { push: false };
    await enviarPush(data!.expo_push_token, titulo, cuerpo);
    return { push: true };
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

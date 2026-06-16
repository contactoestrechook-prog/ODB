import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';

// Cada 15 minutos: avisa a los clientes cuyos productos en espera ya tienen stock.
// Decoupla el aviso de cómo volvió el stock (compra, transferencia, ajuste).
@Injectable()
export class ReposicionTask {
  private readonly log = new Logger('Reposicion');

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  @Cron('0 */15 * * * *')
  async revisar() {
    const { data: pendientes } = await this.db
      .from('avisos_reposicion')
      .select('id, cliente_id, producto_id, producto:productos(nombre)')
      .is('notificado_en', null)
      .limit(500);
    if (!pendientes?.length) return;

    const ids = [...new Set(pendientes.map((p: any) => p.producto_id))];
    const { data: stock } = await this.db.from('stock').select('producto_id, cantidad').in('producto_id', ids);
    const disponible = new Map<string, number>();
    for (const s of (stock ?? []) as any[]) {
      disponible.set(s.producto_id, (disponible.get(s.producto_id) ?? 0) + Number(s.cantidad));
    }

    const aNotificar = (pendientes as any[]).filter((p) => (disponible.get(p.producto_id) ?? 0) > 0);
    if (!aNotificar.length) return;

    for (const a of aNotificar) {
      try {
        await this.notificar.aCliente(
          a.cliente_id,
          '¡Volvió lo que esperabas! 🎉',
          `${a.producto?.nombre ?? 'El producto'} ya está disponible de nuevo en O.D.B`,
          'reposicion',
        );
        await this.db.from('avisos_reposicion').update({ notificado_en: new Date().toISOString() }).eq('id', a.id);
      } catch (e: any) {
        this.log.warn(`No pude avisar reposición ${a.id}: ${e?.message ?? e}`);
      }
    }
    this.log.log(`Avisos de reposición enviados: ${aNotificar.length}`);
  }
}

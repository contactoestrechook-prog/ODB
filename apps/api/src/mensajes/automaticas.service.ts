import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from './notificar.service';

const TZ = 'America/Argentina/Buenos_Aires';

// Notificaciones automáticas: cumpleaños y reactivación. Corren todos los días
// a las 9:00 ART; también se pueden disparar a mano desde el panel.
@Injectable()
export class AutomaticasService {
  private readonly log = new Logger('Automaticas');
  readonly diasInactivo = 45;

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  @Cron('0 9 * * *', { timeZone: TZ })
  async correrTodas() {
    const cumple = await this.cumpleanos();
    const reactivacion = await this.reactivacion();
    const eventos = await this.invitacionesEvento();
    this.log.log(`Automáticas: ${cumple} cumpleaños, ${reactivacion} reactivaciones, ${eventos} invitaciones a evento`);
    return { cumple, reactivacion, eventos };
  }

  // 60 días antes del cumpleaños: invitamos a armar la propuesta del festejo.
  async invitacionesEvento() {
    const { data } = await this.db.rpc('cumpleanos_proximos', { p_dias: 60 });
    const ids = (data ?? []).filter((r: any) => Number(r.dias) === 60).map((r: any) => r.cliente_id);
    if (!ids.length) return 0;
    return this.notificar.aClientes(
      ids,
      'Se acerca tu cumple 🎉',
      'Faltan ~2 meses para tu cumpleaños. ¿Querés que te armemos la propuesta de bebidas para tu festejo? Escribinos y lo organizamos 🍷',
      'evento',
    );
  }

  async cumpleanos() {
    const { data } = await this.db.rpc('cumpleaneros_hoy');
    const ids = (data ?? []).map((r: any) => r.id);
    if (!ids.length) return 0;
    return this.notificar.aClientes(
      ids,
      '¡Feliz cumpleaños! 🎂',
      'De parte de todo el equipo de O.D.B, que la pases genial. Pasá por el local que tenemos un regalo para vos 🍷',
      'cumple',
    );
  }

  async reactivacion() {
    const { data } = await this.db.rpc('clientes_inactivos', { p_dias: this.diasInactivo });
    const ids = (data ?? []).map((r: any) => r.id);
    if (!ids.length) return 0;
    return this.notificar.aClientes(
      ids,
      'Te extrañamos en O.D.B 🍷',
      'Hace rato no te vemos. Mirá las ofertas de la semana: hay vinos y más con descuento esperándote.',
      'reactivacion',
    );
  }

  // Para el panel: cuántos recibirían cada automática hoy (sin enviar).
  async preview() {
    const [{ data: c }, { data: r }] = await Promise.all([
      this.db.rpc('cumpleaneros_hoy'),
      this.db.rpc('clientes_inactivos', { p_dias: this.diasInactivo }),
    ]);
    return {
      cumpleanosHoy: (c ?? []).length,
      inactivos: (r ?? []).length,
      dias: this.diasInactivo,
    };
  }
}

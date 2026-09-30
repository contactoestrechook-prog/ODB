import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// El reloj de la mesa: 7 tránsitos, del t0 (se sientan) al t7 (mesa libre de
// nuevo). Cada estado tiene su columna de timestamp en mesa_ciclos — de ahí
// salen después todos los promedios (RevPASH, tiempo muerto, etc.).
export const ORDEN_ESTADOS = [
  'sentada',
  'vio_carta',
  'comanda_tomada',
  'plato_servido',
  'terminando',
  'pidio_cuenta',
  'pago',
  'libre',
] as const;
export type EstadoMesa = (typeof ORDEN_ESTADOS)[number];

const COLUMNA_POR_ESTADO: Record<EstadoMesa, string> = {
  sentada: 'sentada_en',
  vio_carta: 'vio_carta_en',
  comanda_tomada: 'comanda_tomada_en',
  plato_servido: 'plato_servido_en',
  terminando: 'terminando_en',
  pidio_cuenta: 'pidio_cuenta_en',
  pago: 'pago_en',
  libre: 'libre_en',
};

// Umbrales en minutos para el color de salud de cada estado (ver docs/NUCLEO-GASTRO-propuesta-damian.md).
// "terminando" (ventana de postre) arranca en amarillo apenas entra: es una
// oportunidad de upsell, no un problema — se pone rojo solo si se estanca.
const UMBRALES: Partial<Record<EstadoMesa, { amarillo: number; rojo: number }>> = {
  sentada: { amarillo: 3, rojo: 6 },
  vio_carta: { amarillo: 5, rojo: 8 },
  comanda_tomada: { amarillo: 15, rojo: 25 },
  plato_servido: { amarillo: 40, rojo: 60 },
  terminando: { amarillo: 0, rojo: 15 },
  pidio_cuenta: { amarillo: 4, rojo: 8 },
  pago: { amarillo: 3, rojo: 6 }, // tiempo muerto: pagó y la mesa no se liberó
};

function colorDeSalud(estado: EstadoMesa, minutos: number): 'verde' | 'amarillo' | 'rojo' {
  const umbral = UMBRALES[estado];
  if (!umbral) return 'verde';
  if (minutos >= umbral.rojo) return 'rojo';
  if (minutos >= umbral.amarillo) return 'amarillo';
  return 'verde';
}

@Injectable()
export class PisoService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async pisoVivo() {
    const [mesasRes, ciclosRes] = await Promise.all([
      this.db.from('mesas').select('id, numero, sector').eq('activa', true).order('sector').order('numero'),
      this.db.from('mesa_ciclos').select('*, mozo:mozos(id, nombre)').neq('estado', 'libre'),
    ]);
    if (mesasRes.error) throw new BadRequestException(mesasRes.error.message);
    if (ciclosRes.error) throw new BadRequestException(ciclosRes.error.message);

    const ciclosPorMesa = new Map((ciclosRes.data ?? []).map((c: any) => [c.mesa_id, c]));
    const ahora = Date.now();

    return (mesasRes.data ?? []).map((m: any) => {
      const ciclo = ciclosPorMesa.get(m.id);
      if (!ciclo) {
        return {
          mesaId: m.id, numero: m.numero, sector: m.sector, estado: 'libre', color: null,
          minutosEnEstado: null, minutosTotal: null, cubiertos: null,
          mozoId: null, mozoNombre: null, llamadoHaceMin: null,
        };
      }
      const minutosEnEstado = Math.round((ahora - new Date(ciclo.estado_desde).getTime()) / 60_000);
      const minutosTotal = Math.round((ahora - new Date(ciclo.sentada_en).getTime()) / 60_000);
      return {
        mesaId: m.id,
        numero: m.numero,
        sector: m.sector,
        cicloId: ciclo.id,
        estado: ciclo.estado as EstadoMesa,
        cubiertos: ciclo.cubiertos,
        mozoId: ciclo.mozo_id,
        mozoNombre: ciclo.mozo?.nombre ?? null,
        minutosEnEstado,
        minutosTotal,
        llamadoHaceMin: ciclo.llamado_mozo_en ? Math.round((ahora - new Date(ciclo.llamado_mozo_en).getTime()) / 60_000) : null,
        color: colorDeSalud(ciclo.estado, minutosEnEstado),
      };
    });
  }

  // El encargado del salón sienta la mesa y asigna quién la atiende (t0). No
  // puede haber dos ciclos activos sobre la misma mesa (índice único parcial
  // en la base).
  async abrir(mesaId: string, cubiertos?: number, mozoId?: string) {
    const { data: existente } = await this.db
      .from('mesa_ciclos')
      .select('id')
      .eq('mesa_id', mesaId)
      .neq('estado', 'libre')
      .maybeSingle();
    if (existente) throw new BadRequestException('Esta mesa ya tiene un ciclo activo');

    const { data, error } = await this.db
      .from('mesa_ciclos')
      .insert({ mesa_id: mesaId, estado: 'sentada', cubiertos: cubiertos ?? null, mozo_id: mozoId ?? null })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // El cliente toca "Llamar al mozo" desde la carta (identifica la mesa por
  // su QR, sin login). Salta al tope de la cola del mozo asignado.
  async llamarMozo(token: string) {
    const { data: mesa, error: errMesa } = await this.db.from('mesas').select('id').eq('qr_token', token).maybeSingle();
    if (errMesa) throw new BadRequestException(errMesa.message);
    if (!mesa) throw new NotFoundException('Mesa no encontrada');

    const { data: ciclo, error: errCiclo } = await this.db
      .from('mesa_ciclos')
      .select('id')
      .eq('mesa_id', mesa.id)
      .neq('estado', 'libre')
      .maybeSingle();
    if (errCiclo) throw new BadRequestException(errCiclo.message);
    if (!ciclo) throw new NotFoundException('No pudimos identificar tu mesa como activa — pedile a alguien del salón que te asigne');

    const { error } = await this.db.from('mesa_ciclos').update({ llamado_mozo_en: new Date().toISOString() }).eq('id', ciclo.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async llamadoAtendido(mesaId: string) {
    const { data, error } = await this.db
      .from('mesa_ciclos')
      .update({ llamado_mozo_en: null })
      .eq('mesa_id', mesaId)
      .neq('estado', 'libre')
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Esta mesa no tiene un ciclo activo');
    return data;
  }

  // El toque del mozo: avanza al siguiente estado del ciclo (3-4 toques en
  // total, nada de escribir — salvo el monto al pagar, que es opcional pero
  // es el único dato de "plata" que no sale solo del reloj de estados).
  async avanzar(mesaId: string, monto?: number) {
    const { data: ciclo, error } = await this.db
      .from('mesa_ciclos')
      .select('*')
      .eq('mesa_id', mesaId)
      .neq('estado', 'libre')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!ciclo) throw new NotFoundException('Esta mesa no tiene un ciclo activo — abrila primero');

    const idxActual = ORDEN_ESTADOS.indexOf(ciclo.estado);
    const siguiente = ORDEN_ESTADOS[idxActual + 1];
    const ahora = new Date().toISOString();
    const patch: Record<string, any> = { estado: siguiente, estado_desde: ahora, [COLUMNA_POR_ESTADO[siguiente]]: ahora };
    if (siguiente === 'pago' && monto != null) patch.monto = monto;

    const { data, error: errUpd } = await this.db.from('mesa_ciclos').update(patch).eq('id', ciclo.id).select().single();
    if (errUpd) throw new BadRequestException(errUpd.message);
    return data;
  }
}

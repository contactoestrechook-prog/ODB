import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import type { LecturaGps } from './lectura';

@Injectable()
export class GpsService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // La posición del equipo entra por las mismas dos puertas que la del celular
  // del repartidor (RepartidorView): el mapa de flota (repartidor_posicion) y
  // el seguimiento de los envíos en camino que lleva él o que salieron en ese
  // vehículo. Así la camioneta se ve aunque nadie haya tocado «Compartir mi
  // ubicación».
  async registrar(l: LecturaGps) {
    const { data: v } = await this.db
      .from('vehiculos')
      .select('id, repartidor_id, gps_en')
      .eq('gps_id', l.equipo)
      .eq('activo', true)
      .maybeSingle();
    if (!v) throw new NotFoundException(`El equipo ${l.equipo} no está cargado en ningún vehículo`);

    // Al recuperar señal el equipo descarga lo que guardó sin conexión, y puede
    // llegar desordenado: una lectura más vieja que la última no mueve nada.
    if ((v as any).gps_en && l.en.getTime() <= new Date((v as any).gps_en).getTime()) {
      return { ok: true, ignorada: 'lectura vieja' };
    }

    const en = l.en.toISOString();
    await this.db.from('vehiculos')
      .update({ gps_lat: l.lat, gps_lng: l.lng, gps_velocidad: l.velocidadKmh, gps_en: en })
      .eq('id', (v as any).id);

    const repartidor = (v as any).repartidor_id as string;
    // sin reparto_id: no se pisa la hoja de ruta que haya anotado el celular
    await this.db.from('repartidor_posicion')
      .upsert({ repartidor_id: repartidor, lat: l.lat, lng: l.lng, actualizado_en: en }, { onConflict: 'repartidor_id' });

    await this.db.from('pedidos')
      .update({ repartidor_lat: l.lat, repartidor_lng: l.lng, repartidor_en: en })
      .eq('canal', 'domicilio')
      .eq('estado', 'en_camino')
      .or(`repartidor_id.eq.${repartidor},vehiculo_id.eq.${(v as any).id}`);

    return { ok: true };
  }
}

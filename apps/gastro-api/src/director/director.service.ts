import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Umbrales del 2x1 dinámico: por debajo del piso, el salón está flojo y el 2x1
// atrae valle; por encima del techo, se llena solo y el 2x1 solo regala margen.
// Entre medio es zona neutra — no se sugiere nada para no marear al encargado.
const OCUPACION_PISO = 0.5;
const OCUPACION_TECHO = 0.75;

@Injectable()
export class DirectorService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async sugerencias() {
    const [{ data: mesas, error: errMesas }, { data: ciclosActivos, error: errCiclos }, { data: cfg, error: errCfg }] = await Promise.all([
      this.db.from('mesas').select('id').eq('activa', true),
      this.db.from('mesa_ciclos').select('mesa_id').neq('estado', 'libre'),
      this.db.from('configuracion').select('dos_por_uno_activo').eq('id', true).single(),
    ]);
    if (errMesas) throw new BadRequestException(errMesas.message);
    if (errCiclos) throw new BadRequestException(errCiclos.message);
    if (errCfg) throw new BadRequestException(errCfg.message);

    const total = mesas?.length ?? 0;
    const ocupadas = ciclosActivos?.length ?? 0;
    const ocupacion = total ? ocupadas / total : 0;
    const activo = cfg?.dos_por_uno_activo ?? false;
    const pct = Math.round(ocupacion * 100);

    const sugerencias: { tipo: string; mensaje: string }[] = [];
    if (!activo && ocupacion < OCUPACION_PISO) {
      sugerencias.push({
        tipo: 'dos_por_uno_activar',
        mensaje: `Ocupación actual ${pct}% → activá el 2x1: vas a llenar mesas que hoy están vacías.`,
      });
    } else if (activo && ocupacion > OCUPACION_TECHO) {
      sugerencias.push({
        tipo: 'dos_por_uno_apagar',
        mensaje: `Ocupación actual ${pct}% → apagá el 2x1: el salón se llena solo, estás regalando margen.`,
      });
    }

    return { ocupacion: pct, dosPorUnoActivo: activo, sugerencias };
  }
}

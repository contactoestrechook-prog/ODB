import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// COTIZACIONES de horas extra (Leandro, 9/11/2026: «cuando se pasa las 6 horas,
// se cotiza aparte y lo tienen que aprobar ellos. Por sistema también»). Las
// firma el dueño desde Aprobaciones o desde Mantenimiento: las dos llaman acá.

export type Cotizacion = {
  id: string; mes: string; titulo: string; detalle: string | null; horas: number; precio_hora: number | null; moneda: string;
  automatica: boolean; estado: 'pendiente' | 'aprobada' | 'rechazada'; creada_en: string; decidida_en: string | null; motivo: string | null;
};

/** «ARS 30.000» o null si todavía no hay valor hora. */
export function montoCotizacion(c: Pick<Cotizacion, 'horas' | 'precio_hora' | 'moneda'>): string | null {
  if (c.precio_hora == null) return null;
  return `${c.moneda} ${(Number(c.horas) * Number(c.precio_hora)).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

export async function resolverCotizacion(db: SupabaseClient, id: string, aprueba: boolean, usuarioId: string, motivo?: string | null) {
  // solo una pendiente se firma: si dos dueños tocan a la vez, el segundo rebota
  const { data, error } = await db
    .from('mantenimiento_cotizaciones')
    .update({ estado: aprueba ? 'aprobada' : 'rechazada', decidida_por: usuarioId, decidida_en: new Date().toISOString(), motivo: motivo ?? null })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id, titulo, horas, estado')
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new BadRequestException('Esa cotización ya se resolvió o no existe');
  return { cotizacion: data };
}

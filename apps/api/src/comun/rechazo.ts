// Cómo se cuenta un rechazo en la trazabilidad y en los papeles: con nombre,
// fecha y motivo. Antes el rechazo se guardaba en las columnas de la
// aprobación, y una orden rechazada se leía "Autorizada por" quien la había
// frenado.

const ZONA = 'America/Argentina/Buenos_Aires';

/**
 * "03/10/2026" en la hora de Buenos Aires (el servidor corre en UTC). Una
 * fecha sola ("2026-09-30", las columnas `date`) se toma al mediodía: si no,
 * es la medianoche de Londres y se corre al día anterior.
 */
export function fechaCorta(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00-03:00` : s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONA });
}

/** "Rechazada por Juan Pablo el 03/10/2026 · Motivo: el precio no es el pactado". */
export function leyendaRechazo(
  quien: string | null | undefined,
  cuando: string | Date | null | undefined,
  motivo?: string | null,
): string {
  const dia = fechaCorta(cuando);
  const por = quien?.trim() ? ` por ${quien.trim()}` : '';
  const m = motivo?.trim();
  return `Rechazada${por}${dia ? ` el ${dia}` : ''}${m ? ` · Motivo: ${m}` : ''}`;
}

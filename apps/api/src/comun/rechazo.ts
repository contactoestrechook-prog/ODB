// Cómo se cuenta un rechazo en la trazabilidad y en los papeles: con nombre,
// fecha y motivo. Antes el rechazo se guardaba en las columnas de la
// aprobación, y una orden rechazada se leía "Autorizada por" quien la había
// frenado.

const ZONA = 'America/Argentina/Buenos_Aires';

/** "03/10/2026" en la hora de Buenos Aires (el servidor corre en UTC). */
export function fechaCorta(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
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

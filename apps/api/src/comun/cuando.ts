/** "2026-10-04" + "mañana" → "el domingo 4/10 por la mañana" (null sin fecha). */
export function cuandoLegible(fecha: string | null | undefined, franja: string | null | undefined): string | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return franja ? `por la ${franja}` : null;
  const d = new Date(`${fecha}T12:00:00-03:00`);
  const zona = { timeZone: 'America/Argentina/Buenos_Aires' } as const;
  const dia = `${d.toLocaleDateString('es-AR', { weekday: 'long', ...zona })} ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', ...zona })}`;
  return `el ${dia}${franja ? ` por la ${franja}` : ''}`;
}

// ============================================================
// EL DÍA DE LA SEMANA LO CALCULA EL SISTEMA (18/9/2026)
//
// La información vigente de la casa la escribe una persona en las notas de la
// línea, y ahí se coló "jueves 30/10/2026" cuando el 30/10/2026 cae VIERNES:
// el bot se lo dijo así a un cliente. Un día de la semana no se copia, se
// calcula. Acá se sacan las fechas del texto y se arma el control que viaja
// con la información: si lo escrito no coincide, manda la cuenta.
// ============================================================

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Día de la semana de una fecha dd/mm/aaaa, en horario de Buenos Aires. */
export function diaDeLaSemana(dia: number, mes: number, anio: number): string | null {
  if (!(dia >= 1 && dia <= 31) || !(mes >= 1 && mes <= 12) || !(anio >= 2020 && anio <= 2100)) return null;
  const f = new Date(Date.UTC(anio, mes - 1, dia, 12));
  if (f.getUTCDate() !== dia || f.getUTCMonth() !== mes - 1) return null; // 31/02 y compañía
  return DIAS[f.getUTCDay()];
}

/**
 * Control de fechas para la información vigente: por cada fecha dd/mm/aaaa del
 * texto dice qué día de la semana es de verdad. Devuelve '' si no hay fechas.
 */
export function controlDeFechas(texto: string): string {
  const vistas = new Map<string, string>();
  for (const m of String(texto ?? '').matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const [d, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dia = diaDeLaSemana(d, mes, anio);
    if (dia) vistas.set(m[0], `${m[0]} es ${dia} ${d} de ${MESES[mes - 1]} de ${anio}`);
  }
  if (!vistas.size) return '';
  return `CONTROL DE FECHAS (lo calcula el sistema y MANDA sobre cualquier día de la semana escrito arriba): ${[...vistas.values()].join(' · ')}. Si arriba dice otro día, está mal tipeado: usá este.`;
}

// Argentina = UTC-3 todo el año. Sin librería de zonas horarias: alcanza para
// "hoy", "ayer" y "este mes" en hora del restaurante.
export const ART_H = 3;
const HORA = 3_600_000;

// 'AAAA-MM-DD' en hora de Argentina
export function fechaArt(momento: Date | string | number = Date.now()): string {
  return new Date(new Date(momento).getTime() - ART_H * HORA).toISOString().slice(0, 10);
}

// Principio y fin (en UTC real) de un día de Argentina dado como 'AAAA-MM-DD'
export function limitesDeFecha(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number);
  return {
    desde: new Date(Date.UTC(a, m - 1, d, ART_H, 0, 0)),
    hasta: new Date(Date.UTC(a, m - 1, d + 1, ART_H, 0, 0) - 1),
    fecha,
  };
}

// diasAtras = 0 → hoy · 1 → ayer · -1 → mañana
export function limitesDia(diasAtras = 0) {
  return limitesDeFecha(sumarDias(fechaArt(), -diasAtras));
}

export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function mesActual(): string {
  return fechaArt().slice(0, 7);
}

// Principio y fin (UTC real) de un mes 'AAAA-MM' de Argentina
export function limitesDeMes(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  return {
    desde: new Date(Date.UTC(a, m - 1, 1, ART_H, 0, 0)),
    hasta: new Date(Date.UTC(a, m, 1, ART_H, 0, 0) - 1),
  };
}

// 0 = domingo … 6 = sábado, de una fecha 'AAAA-MM-DD'
export function diaDeSemana(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay();
}

export const minutosEntre = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

export function promedio(nums: number[], decimales = 1): number | null {
  if (!nums.length) return null;
  const p = 10 ** decimales;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * p) / p;
}

export function linkWhatsapp(telefono: string | null | undefined, mensaje: string) {
  const numero = (telefono ?? '').replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

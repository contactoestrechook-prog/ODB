export type Moneda = "ARS" | "BRL" | "USD";
export type Metodo = "pix" | "qr" | "tarjeta" | "efectivo";

export const MONEDAS: Moneda[] = ["ARS", "BRL", "USD"];
export const METODOS: Metodo[] = ["pix", "qr", "tarjeta", "efectivo"];
export const NOMBRE_MONEDA: Record<Moneda, string> = { ARS: "Pesos", BRL: "Reales", USD: "Dólares" };
export const NOMBRE_METODO: Record<Metodo, string> = { pix: "Pix", qr: "QR argentino", tarjeta: "Tarjeta", efectivo: "Efectivo" };

// Cada monto con su moneda y entero cuando son pesos: nunca «k» ni «M».
export function pesos(n: number | null | undefined) {
  return n == null ? "—" : `$ ${Math.round(n).toLocaleString("es-AR")}`;
}
export function plata(n: number | null | undefined, moneda: Moneda) {
  if (n == null) return "—";
  if (moneda === "ARS") return pesos(n);
  const txt = n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda === "BRL" ? "R$" : "US$"} ${txt}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// 'AAAA-MM-DD' → «jueves 12 de noviembre»
export function fechaLarga(fecha: string) {
  const [a, m, d] = fecha.split("-").map(Number);
  const ds = new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay();
  return `${DIAS[ds]} ${d} de ${MESES[m - 1]}`;
}
export function fechaCorta(fecha: string) {
  const [, m, d] = fecha.split("-").map(Number);
  return `${d}/${m}`;
}
export function diaCorto(fecha: string) {
  const [a, m, d] = fecha.split("-").map(Number);
  return DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()].slice(0, 3);
}
// 'AAAA-MM' → «noviembre de 2026»
export function nombreDeMes(mes: string) {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
}
export function mesAnterior(mes: string, pasos = 1) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 - pasos, 1)).toISOString().slice(0, 7);
}
// hora de Argentina de un instante
export function hora(iso: string) {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(11, 16);
}
export function hoyArt() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}
export function haceCuanto(iso: string | null | undefined) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
export const BANDERA: Record<string, string> = { es: "ES", pt: "PT", en: "EN" };
export const NOMBRE_IDIOMA: Record<string, string> = { es: "Español", pt: "Portugués", en: "Inglés" };

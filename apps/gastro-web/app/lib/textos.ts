"use client";

import { useEffect, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export type Idioma = "es" | "pt" | "en";
export type Moneda = "ARS" | "BRL" | "USD";
export type Cambio = { BRL: number | null; USD: number | null; actualizadoEn?: string | null };

export const IDIOMAS: { valor: Idioma; texto: string }[] = [
  { valor: "es", texto: "Español" },
  { valor: "pt", texto: "Português" },
  { valor: "en", texto: "English" },
];
export const MONEDAS: { valor: Moneda; texto: string }[] = [
  { valor: "ARS", texto: "$ ARS" },
  { valor: "BRL", texto: "R$" },
  { valor: "USD", texto: "US$" },
];

// Todo lo que lee el cliente, en los tres idiomas.
const T = {
  volver: { es: "Volver", pt: "Voltar", en: "Back" },
  inicio: { es: "Inicio", pt: "Início", en: "Home" },
  bienvenido: { es: "¡Bienvenidos a Gran Caminito!", pt: "Bem-vindos ao Gran Caminito!", en: "Welcome to Gran Caminito!" },
  mesa: { es: "Mesa", pt: "Mesa", en: "Table" },
  lugar: { es: "Parrilla · Puerto Iguazú", pt: "Churrascaria · Puerto Iguazú", en: "Steakhouse · Puerto Iguazú" },
  verCarta: { es: "Ver la carta", pt: "Ver o cardápio", en: "See the menu" },
  carta: { es: "La carta", pt: "Cardápio", en: "Menu" },
  miCuenta: { es: "Ver mi cuenta y pagar", pt: "Ver a conta e pagar", en: "See my bill and pay" },
  cuenta: { es: "La cuenta", pt: "A conta", en: "The bill" },
  reservar: { es: "Reservar una mesa", pt: "Reservar uma mesa", en: "Book a table" },
  anfitrion: { es: "¿No sabés qué pedir? Preguntale al anfitrión", pt: "Não sabe o que pedir? Pergunte ao anfitrião", en: "Not sure what to order? Ask the host" },
  opinar: { es: "Contanos cómo estuvo todo", pt: "Conte como foi tudo", en: "Tell us how it was" },
  codigoInvalido: { es: "Este código no es válido.", pt: "Este código não é válido.", en: "This code is not valid." },
  pediQr: { es: "Pedile al mozo el QR de la mesa.", pt: "Peça ao garçom o QR da mesa.", en: "Ask your waiter for the table QR." },
  escaneaQr: { es: "Escaneá el QR de tu mesa para ver tu cuenta o llamar al mozo.", pt: "Escaneie o QR da sua mesa para ver a conta ou chamar o garçom.", en: "Scan your table QR to see your bill or call the waiter." },
  todos: { es: "Todo", pt: "Tudo", en: "All" },
  sin_tacc: { es: "Sin TACC", pt: "Sem glúten", en: "Gluten-free" },
  vegetariano: { es: "Vegetariano", pt: "Vegetariano", en: "Vegetarian" },
  vegano: { es: "Vegano", pt: "Vegano", en: "Vegan" },
  picante: { es: "Picante", pt: "Picante", en: "Spicy" },
  sinLactosa: { es: "Sin lácteos", pt: "Sem lactose", en: "Dairy-free" },
  agotado: { es: "Agotado por hoy", pt: "Esgotado hoje", en: "Sold out today" },
  contiene: { es: "Contiene", pt: "Contém", en: "Contains" },
  cartaVacia: { es: "La carta todavía no está cargada.", pt: "O cardápio ainda não está disponível.", en: "The menu is not available yet." },
  nadaConFiltro: { es: "No hay platos con ese filtro.", pt: "Não há pratos com esse filtro.", en: "No dishes match that filter." },
  preciosEn: { es: "Precios en", pt: "Preços em", en: "Prices in" },
  cambioNota: { es: "Los precios en reales y dólares son al cambio de la casa de hoy.", pt: "Os preços em reais e dólares usam o câmbio da casa de hoje.", en: "Prices in reais and dollars use today's house exchange rate." },
  aceptamosPix: { es: "Aceptamos Pix", pt: "Aceitamos Pix", en: "We accept Pix" },
  sinMesaAbierta: { es: "Tu mesa todavía no tiene pedidos cargados.", pt: "Sua mesa ainda não tem pedidos.", en: "Your table has no orders yet." },
  total: { es: "Total", pt: "Total", en: "Total" },
  yaPagado: { es: "Ya pagado", pt: "Já pago", en: "Already paid" },
  falta: { es: "Falta pagar", pt: "Falta pagar", en: "Left to pay" },
  dividir: { es: "¿Dividen la cuenta?", pt: "Vão dividir a conta?", en: "Splitting the bill?" },
  cadaUno: { es: "Cada uno paga", pt: "Cada um paga", en: "Each pays" },
  personas: { es: "personas", pt: "pessoas", en: "people" },
  comoPagar: { es: "¿Cómo querés pagar?", pt: "Como você quer pagar?", en: "How would you like to pay?" },
  pix: { es: "Pix", pt: "Pix", en: "Pix" },
  qr: { es: "QR (Mercado Pago y otras)", pt: "QR argentino", en: "Argentine QR" },
  tarjeta: { es: "Tarjeta", pt: "Cartão", en: "Card" },
  efectivo: { es: "Efectivo", pt: "Dinheiro", en: "Cash" },
  pedirCuenta: { es: "Pedir la cuenta", pt: "Pedir a conta", en: "Ask for the bill" },
  pidiendo: { es: "Avisando…", pt: "Avisando…", en: "Sending…" },
  cuentaPedida: { es: "Listo. Ya le avisamos al mozo: viene a tu mesa a cobrarte.", pt: "Pronto. Já avisamos o garçom: ele vai até a sua mesa.", en: "Done. Your waiter has been told and is on the way." },
  conPix: { es: "Trae la terminal para que pagues con Pix desde tu banco.", pt: "Ele leva a maquininha para você pagar com Pix pelo seu banco.", en: "They will bring the terminal so you can pay with Pix." },
  pagada: { es: "Cuenta pagada. ¡Gracias por venir!", pt: "Conta paga. Obrigado pela visita!", en: "Bill paid. Thank you for coming!" },
  noSePudo: { es: "No se pudo. Probá de nuevo.", pt: "Não foi possível. Tente de novo.", en: "Something went wrong. Please try again." },
  recomendadoPor: { es: "Te recomendó", pt: "Indicado por", en: "Recommended by" },
  tuNombre: { es: "Tu nombre", pt: "Seu nome", en: "Your name" },
  tuWhatsapp: { es: "Tu WhatsApp (con código de país)", pt: "Seu WhatsApp (com código do país)", en: "Your WhatsApp (with country code)" },
  cuantos: { es: "¿Cuántos son?", pt: "Quantas pessoas?", en: "How many people?" },
  dia: { es: "Día", pt: "Dia", en: "Date" },
  hora: { es: "Hora", pt: "Horário", en: "Time" },
  notas: { es: "¿Algo que tengamos que saber? (opcional)", pt: "Algo que devemos saber? (opcional)", en: "Anything we should know? (optional)" },
  enviarReserva: { es: "Pedir la reserva", pt: "Pedir a reserva", en: "Request booking" },
  enviando: { es: "Enviando…", pt: "Enviando…", en: "Sending…" },
  reservaLista: { es: "¡Recibimos tu pedido de reserva!", pt: "Recebemos seu pedido de reserva!", en: "We got your booking request!" },
  reservaConfirmamos: { es: "Te confirmamos por WhatsApp en un rato.", pt: "Confirmamos pelo WhatsApp em instantes.", en: "We'll confirm on WhatsApp shortly." },
  para: { es: "para", pt: "para", en: "for" },
  otraReserva: { es: "Hacer otra reserva", pt: "Fazer outra reserva", en: "Make another booking" },
} as const;

export type Clave = keyof typeof T;
export const t = (clave: Clave, idioma: Idioma) => T[clave][idioma];

const ALERGENOS: Record<string, Record<Idioma, string>> = {
  gluten: { es: "gluten", pt: "glúten", en: "gluten" },
  lacteos: { es: "lácteos", pt: "leite", en: "dairy" },
  huevo: { es: "huevo", pt: "ovo", en: "egg" },
  pescado: { es: "pescado", pt: "peixe", en: "fish" },
  crustaceos: { es: "crustáceos", pt: "crustáceos", en: "shellfish" },
  moluscos: { es: "moluscos", pt: "moluscos", en: "molluscs" },
  frutos_secos: { es: "frutos secos", pt: "castanhas", en: "tree nuts" },
  mani: { es: "maní", pt: "amendoim", en: "peanuts" },
  soja: { es: "soja", pt: "soja", en: "soy" },
  sesamo: { es: "sésamo", pt: "gergelim", en: "sesame" },
  mostaza: { es: "mostaza", pt: "mostarda", en: "mustard" },
  apio: { es: "apio", pt: "aipo", en: "celery" },
  sulfitos: { es: "sulfitos", pt: "sulfitos", en: "sulphites" },
  altramuces: { es: "altramuces", pt: "tremoço", en: "lupin" },
};
export const alergeno = (clave: string, idioma: Idioma) => ALERGENOS[clave]?.[idioma] ?? clave;

export function plata(n: number | null | undefined, moneda: Moneda) {
  if (n == null) return "—";
  if (moneda === "ARS") return `$ ${Math.round(n).toLocaleString("es-AR")}`;
  return `${moneda === "BRL" ? "R$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Un precio en pesos, en la moneda elegida (si falta el cambio, queda en pesos).
export function precioEn(ars: number, moneda: Moneda, cambio: Cambio | null) {
  if (moneda === "ARS" || !cambio?.[moneda]) return plata(ars, "ARS");
  return plata(Math.round((ars / cambio[moneda]!) * 100) / 100, moneda);
}

// Idioma y moneda elegidos: se recuerdan en el teléfono. La primera vez salen
// del idioma del teléfono (portugués → reales, inglés → dólares).
export function usePreferencias() {
  const [idioma, setIdiomaE] = useState<Idioma>("es");
  const [moneda, setMonedaE] = useState<Moneda>("ARS");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let i = window.localStorage.getItem("gc_idioma") as Idioma | null;
    let m = window.localStorage.getItem("gc_moneda") as Moneda | null;
    if (!i) {
      const nav = navigator.language.toLowerCase();
      i = nav.startsWith("pt") ? "pt" : nav.startsWith("es") ? "es" : "en";
    }
    if (!m) m = i === "pt" ? "BRL" : i === "en" ? "USD" : "ARS";
    setIdiomaE(i);
    setMonedaE(m);
    setListo(true);
    const alCambiar = () => {
      setIdiomaE((window.localStorage.getItem("gc_idioma") as Idioma) ?? i!);
      setMonedaE((window.localStorage.getItem("gc_moneda") as Moneda) ?? m!);
    };
    window.addEventListener("gc-preferencias", alCambiar);
    return () => window.removeEventListener("gc-preferencias", alCambiar);
  }, []);

  function setIdioma(i: Idioma) {
    window.localStorage.setItem("gc_idioma", i);
    if (!window.localStorage.getItem("gc_moneda_elegida")) window.localStorage.setItem("gc_moneda", i === "pt" ? "BRL" : i === "en" ? "USD" : "ARS");
    window.dispatchEvent(new Event("gc-preferencias"));
  }
  function setMoneda(m: Moneda) {
    window.localStorage.setItem("gc_moneda", m);
    window.localStorage.setItem("gc_moneda_elegida", "1");
    window.dispatchEvent(new Event("gc-preferencias"));
  }
  return { idioma, moneda, setIdioma, setMoneda, listo };
}

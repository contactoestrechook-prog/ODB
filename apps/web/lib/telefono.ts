// WhatsApp argentino: el cliente lo escribe como le sale ("+54 9 11 2345-6789",
// "011 15 2345 6789", "1123456789") y la API lo quiere en 10 dígitos con la
// característica y sin 0, 15 ni +54 (contrato de POST /app/pedidos, 6/10/2026).
// Sirve igual en el navegador (Finalizar compra) que en el servidor
// (/api/checkout vuelve a normalizar: nunca se confía en lo que manda el navegador).

// Características de 3 dígitos (las demás del interior son de 4; AMBA es 11).
// Hace falta saber dónde termina la característica para sacar el "15" que va
// entre ella y el número ("221 15 456-7890" → 2214567890).
const CARACTERISTICAS_DE_3 = new Set([
  "220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264", "266",
  "280", "291", "294", "297", "298", "299", "336", "341", "342", "343", "345", "348",
  "351", "353", "358", "362", "364", "370", "376", "379", "380", "381", "383", "385",
  "387", "388",
]);

const largoCaracteristica = (d: string) => (d.startsWith("11") ? 2 : CARACTERISTICAS_DE_3.has(d.slice(0, 3)) ? 3 : 4);

export type ResultadoWhatsapp = { ok: true; numero: string } | { ok: false; motivo: "vacio" | "sin-caracteristica" | "largo" };

export function revisarWhatsapp(entrada: string): ResultadoWhatsapp {
  let d = String(entrada ?? "").replace(/\D/g, "");
  if (!d) return { ok: false, motivo: "vacio" };
  if (d.startsWith("00")) d = d.slice(2); // 0054…
  if (d.startsWith("54") && d.length >= 12) d = d.slice(2); // +54…
  if (d.startsWith("9") && d.length >= 11) d = d.slice(1); // el 9 de los celulares en formato internacional
  if (d.startsWith("0")) d = d.slice(1); // 011…, 0221…
  if (d.length === 12) {
    const c = largoCaracteristica(d);
    if (d.slice(c, c + 2) === "15") d = d.slice(0, c) + d.slice(c + 2);
  }
  // "15 2345 6789": el 15 sin la característica adelante. No hay característica 15.
  if (d.startsWith("15") && d.length <= 10) return { ok: false, motivo: "sin-caracteristica" };
  // Las características argentinas empiezan con 11, 2 o 3.
  if (d.length !== 10 || !/^(11|[23])/.test(d)) return { ok: false, motivo: "largo" };
  return { ok: true, numero: d };
}

/** Los 10 dígitos, o null si no es un WhatsApp argentino válido. */
export const normalizarWhatsapp = (entrada: string): string | null => {
  const r = revisarWhatsapp(entrada);
  return r.ok ? r.numero : null;
};

// el ejemplo con espacios duros: en celular no se parte "11 2345 / 6789"
const EJEMPLO = "11 2345 6789";

/** Qué decirle al cliente cuando el número no sirve. */
export function errorDeWhatsapp(r: ResultadoWhatsapp): string | null {
  if (r.ok) return null;
  if (r.motivo === "vacio") return "Escribí tu WhatsApp para avisarte cuando el pedido esté listo.";
  if (r.motivo === "sin-caracteristica") return `Falta la característica: escribilo como ${EJEMPLO}.`;
  return `Revisá el número: son 10 dígitos con la característica, por ejemplo ${EJEMPLO}.`;
}

/** Para leerlo: "11 2345-6789", "221 456-7890", "2954 12-3456". */
export function whatsappLegible(numero: string): string {
  const d = String(numero ?? "").replace(/\D/g, "");
  if (d.length !== 10) return numero;
  const c = largoCaracteristica(d);
  const resto = d.slice(c);
  return `${d.slice(0, c)} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

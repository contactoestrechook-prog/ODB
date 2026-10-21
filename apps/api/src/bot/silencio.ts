// ============================================================
// CUÁNDO CALLA EL BOT (21/10/2026, «el bot no está respondiendo»)
//
// Del 15 al 21/10 la fracción de turnos sin respuesta pasó del 5 % al 60 %. La
// regla del prompt del 16/10 («si le habla por su nombre a alguien de la casa…
// no escribas nada») hacía que el modelo devolviera la respuesta VACÍA para
// callar, y el código tomaba todo vacío como «no sabe»: abría una consulta a
// administración con el texto crudo (65 consultas falsas en una semana; nadie
// las contestó) y al cliente no le llegaba nada. Una clienta que le pasaba el
// pedido «a Jackie» quedó sin respuesta, y un «¿me repite su consulta?» le llegó
// a quien había dicho «gracias».
//
// Desde ahora el silencio lo decide el código con reglas, no una respuesta vacía:
//  · el modelo que decide no contestar llama la herramienta no_contestar, y el
//    código la acepta o la rechaza (un pedido o una compra se contestan siempre);
//  · si el modelo igual vuelve vacío, estas reglas dicen si es para la casa, un
//    cierre o algo que el cliente espera (recién ahí, la consulta silenciosa).
// Funciones puras, con las frases reales de esa semana en silencio.spec.ts.
// ============================================================
import { cantidadesPedidas } from './formatos';

const sinTildes = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Los de la casa, como los nombran los clientes: Jaqueline (Jackie, Jacky, Jaky, Jaqui,
 * Jacqui, Shaki, Shaky), Juan Pablo y Leandro; Anabella y Romina, de administración.
 */
const RE_DE_LA_CASA = /\b(?:ja(?:c?qu|c?k)el[iy]n[ea]?|ja(?:c?k|c?qu)(?:i|ie|y|ii)|[sc]ha(?:c?k|qu)(?:i|ie|y)|juan ?pablo|leandro|anabella|romina)\b/;

/** El mensaje le habla por su nombre a alguien de la casa. */
export function nombraAAlguienDeLaCasa(texto: string | null | undefined): boolean {
  return RE_DE_LA_CASA.test(sinTildes(texto ?? ''));
}

// lo que un cliente le pide a la casa y el bot resuelve: un pedido, un encargo,
// un precio, si hay algo, un envío o un retiro. Con esto, un «no contestar» se
// rechaza: aunque le hable a Jackie, es un cliente comprando.
const RE_PIDE_COMPRA = new RegExp([
  String.raw`\b(?:te|les?) (?:paso|mando|dejo|hago) (?:el|un|mi|los|unos|este|estos) pedidos?\b`,
  String.raw`\bpedidos? (?:de|del|para)\b`,
  String.raw`\b(?:quiero|quisiera|queria|necesito|necesitaria) (?:pedir|encargar|comprar|hacer un pedido|reservar)\b`,
  String.raw`\b(?:te|les?) (?:puedo|podria) (?:pedir|encargar|hacer un pedido)\b`,
  String.raw`\bpuedo (?:pedir|encargar|reservar)\b`,
  String.raw`\b(?:me|nos) (?:mandas|mandan|envias|envian|traes|traen|reservas|reservan|separas|separan|preparas|preparan|(?:podes|pueden|puede|podrias|podrian) (?:mandar|enviar|traer|reservar|separar|preparar))\b`,
  String.raw`\b(?:puede|podes|pueden|podrias|podrian) (?:enviarme|mandarme|traerme|reservarme|separarme|prepararme|enviarnos|mandarnos)\b`,
  String.raw`\bcuanto (?:sale|salen|cuesta|cuestan|esta|estan|seria|serian|vale|valen)\b`,
  String.raw`\bprecios? (?:de|del|de la|de los)\b`,
  String.raw`\b(?:tenes|tienen|tendras|tendran|tendrias|hay|queda|quedan)\b[^?.!\n]{0,50}\?`,
  String.raw`\b(?:a domicilio|para retirar|lo retiro|paso a buscar(?:lo)?)\b`,
  String.raw`\blote \d+`,
].join('|'));
// «un abrazo», «una consulta»: el número es de la cortesía, no una cantidad pedida
const NO_ES_PRODUCTO = /^(?:abrazo|beso|saludo|consulta|pregunta|favor|duda|cosa|momento|rato|ratito|minuto|segundo|vez|dia|tarde|noche)\b/;

/** El mensaje pide algo que la casa vende o resuelve (pedido, encargo, precio, si hay, envío, retiro). */
export function pideCompra(texto: string | null | undefined): boolean {
  const t = sinTildes(texto ?? '');
  if (RE_PIDE_COMPRA.test(t)) return true;
  return cantidadesPedidas(String(texto ?? '')).some((c) => !NO_ES_PRODUCTO.test(sinTildes(c.que)));
}

// ---- cierres ----
// palabras con las que alguien cierra una charla (sin letras repetidas: «graciasss» es «gracias»).
// PROPIO: cierran por sí solas; AFIRMACION: «sí», «ok», «dale» (solas pueden ser un sí a una
// pregunta o un pedido: «Sí, dale» a «el envío es sin cargo» es «mandámelo»); FUNCION: relleno.
const PROPIO = new Set([
  'gracias', 'grax', 'gracia', 'saludos', 'saludo', 'vemos', 'abrazo', 'abrazos', 'beso', 'besos', 'chau', 'chao', 'ciao', 'luego',
  'igualmente', 'hablamos', 'despues', 'amable', 'amables', 'genio', 'genia', 'crack', 'sol', 'excelente', 'genial', 'joya', 'barbaro',
  'buenisimo', 'buenisima', 'buena', 'espectacular', 'divino', 'divina', 'hermoso', 'hermosa', 'lindo', 'linda', 'super', 'tranqui',
  'tranquilo', 'tranquila', 'impecable', 'fenomenal', 'genialisimo', 'ah', 'aa', 'oh', 'eh',
]);
const AFIRMACION = new Set([
  'si', 'sisi', 'ok', 'oki', 'okis', 'okey', 'okay', 'oka', 'dale', 'listo', 'lista', 'bueno', 'va', 'vale', 'claro', 'obvio',
  'perfecto', 'perfecta', 'entendido', 'entendida', 'recibido', 'recibida', 'visto', 'bien',
]);
const FUNCION = new Set(['de', 'a', 'un', 'una', 'muy', 'mil', 'muchas', 'muchos', 'sos', 'nos', 'mas', 'todo', 're', 'hasta', 'ya', 'esta', 'nada', 'vos']);
// la despedida (con esto el cliente se va: no espera nada, aunque el bot le haya preguntado algo)
const DESPEDIDA = new Set(['gracias', 'grax', 'gracia', 'saludos', 'saludo', 'vemos', 'abrazo', 'abrazos', 'beso', 'besos', 'chau', 'chao', 'ciao', 'luego', 'igualmente', 'hablamos', 'amable', 'amables']);
// el saludo solo acompaña («Hola!!! Ok», «Buenos días, gracias»): solo, no es un cierre
const SALUDO = new Set(['hola', 'holis', 'buen', 'buenos', 'buenas', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches', 'que', 'tal']);
const RISA = /^(?:j+[aeiou]+)+j*$|^(?:[aeiou]?j+)+$|^(?:ha)+h?$|^(?:jsj)+$|^xd+$|^lol$/;

const sinRepetidas = (w: string) => w.replace(/(.)\1+/g, '$1');
function distancia1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
/** «graciasN», «amablees», «buenisimoo»: la misma palabra con una letra de más o de menos (6 letras o más). */
function palabraDe(conjunto: Set<string>, w: string): boolean {
  const s = sinRepetidas(w);
  if (conjunto.has(w) || conjunto.has(s)) return true;
  return s.length >= 6 && [...conjunto].some((p) => p.length >= 6 && distancia1(s, p));
}
const palabras = (t: string) => sinTildes(t)
  .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f\u263a]/gu, ' ')
  .replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * El mensaje entero es un cierre: «Ok, graciasN», «Ahh ok.», «Muy buena!!! Jajaja»,
 * «Excelente buenísimo!! Nos vemos☺️», «Buenos días, gracias», 👍. Sin pregunta y sin
 * ninguna otra palabra; un saludo solo no es cierre. Estricto (antes de llamar al modelo):
 * hace falta una palabra que cierre por sí sola, así «Sí, dale» o «Hola!!! Ok» siguen al
 * modelo. Con afirmación (cuando el modelo ya no escribió nada): alcanza un «ok» o un «sí».
 */
export function esCierreDeCharla(texto: string | null | undefined, o: { conAfirmacion?: boolean } = {}): boolean {
  const t = String(texto ?? '').trim();
  if (!t || /[?¿]/.test(t)) return false;
  const ws = palabras(t);
  if (!ws.length) return /\p{Extended_Pictographic}/u.test(t);
  let cierra = /\p{Extended_Pictographic}/u.test(t);
  for (const w of ws) {
    if (RISA.test(w) || palabraDe(PROPIO, w)) { cierra = true; continue; }
    if (palabraDe(AFIRMACION, w)) { if (o.conAfirmacion) cierra = true; continue; }
    if (FUNCION.has(w) || SALUDO.has(w)) continue;
    return false;
  }
  return cierra;
}

/** Lo último que dijo es una despedida y no preguntó ni pidió nada: «Ah no, quería el coreano de verdad. Bueno, gracias!!». */
export function terminaEnCierre(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').trim();
  if (!t || /[?¿]/.test(t)) return false;
  const partes = t.split(/[.!\n…]+/).map((p) => p.trim()).filter((p) => palabras(p).length);
  const ultima = partes.at(-1);
  // «Te paso el pedido: 2 fernet. Gracias!» no es un cierre: trae un pedido
  return !!ultima && esCierreDeCharla(ultima, { conAfirmacion: true }) && palabras(ultima).some((w) => palabraDe(DESPEDIDA, w)) && !pideCompra(t);
}

/** Se despide: un cierre con «gracias», «nos vemos», «saludos»… (o que termina así). */
export function esDespedida(texto: string | null | undefined): boolean {
  return (esCierreDeCharla(texto, { conAfirmacion: true }) && palabras(String(texto ?? '')).some((w) => palabraDe(DESPEDIDA, w))) || terminaEnCierre(texto);
}

/**
 * ¿El cliente espera una respuesta? La red de respaldo lo mira cuando el modelo no escribió
 * nada ni con la vuelta de cierre: solo entonces se consulta en silencio con administración.
 * Una despedida no espera nada; un «ok», un «sí» o un emoji, solo si contestan una pregunta
 * del bot. Lo demás sí (lo que es para la casa o un cierre ya lo sacaron las reglas de abajo).
 */
export function esperaRespuesta(texto: string | null | undefined, o: { botDejoPregunta: boolean; conArchivo?: boolean }): boolean {
  if (o.conArchivo) return true;
  if (esDespedida(texto)) return false;
  if (esCierreDeCharla(texto, { conAfirmacion: true })) return o.botDejoPregunta;
  return true;
}

// ---- lo que escribió una persona desde el teléfono ----
// los rótulos con que mensajePropio guarda lo que se mandó desde el teléfono
const RE_ROTULO_TELEFONO = /^(?:📷 Foto enviada|🎙️ Audio enviado|🎬 Video enviado|📄 Archivo enviado)/u;
export type MensajeDelHilo = { role: string; content: any; de?: string };

/** El mensaje de la casa lo escribió una persona (desde el teléfono o el panel), no el bot. */
export function escritoPorUnaPersona(m: MensajeDelHilo | null | undefined): boolean {
  if (!m || m.role !== 'assistant') return false;
  return m.de === 'telefono' || m.de === 'persona' || RE_ROTULO_TELEFONO.test(String(m.content ?? '').trim());
}

/** Lo último que dijo la casa en el hilo lo escribió una persona: lo que el cliente conteste ahora, probablemente es para ella. */
export function loUltimoDeLaCasaEsDeUnaPersona(historial: MensajeDelHilo[]): MensajeDelHilo[] {
  const salida: MensajeDelHilo[] = [];
  for (let i = historial.length - 1; i >= 0; i--) {
    const m = historial[i];
    if (m.role !== 'assistant') { if (salida.length) break; continue; }
    if (!escritoPorUnaPersona(m)) break;
    salida.unshift(m);
  }
  return salida;
}

/** Lo que va al modelo: solo rol y texto (la marca «de» no es un campo de la API). */
export function paraElModelo<T extends MensajeDelHilo>(historial: T[]): { role: T['role']; content: T['content'] }[] {
  return historial.map((m) => ({ role: m.role, content: m.content }));
}

// ---- la decisión ----
export type MotivoDeSilencio = 'para_la_casa' | 'cierre' | 'automatico';
export type SenalesDeLaCasa = {
  /** el contacto está registrado como proveedor (o se registró en este turno) */
  esProveedor?: boolean;
  /** lo último de la casa lo escribió una persona, o el bot volvió solo hace poco de una pausa del teléfono */
  siguePersona?: boolean;
  /** el modelo ya dejó nota_interna o registrar_proveedor en el turno */
  anotoEnElTurno?: boolean;
  /** vino una foto, un PDF o un audio */
  conArchivo?: boolean;
  /** lo último que escribió el bot fue una pregunta */
  botDejoPregunta?: boolean;
};

/**
 * no_contestar (la herramienta): ¿se acepta? Un proveedor, sí. Si el mensaje pide algo
 * que la casa vende o resuelve, no: aunque nombre a Jackie, es un cliente (la clienta del
 * lote 112, 21/10/2026). Un cierre no puede traer una pregunta.
 */
export function aceptaNoContestar(motivo: string, texto: string, s: SenalesDeLaCasa = {}): { ok: true } | { ok: false; porque: string } {
  const m = String(motivo ?? '');
  if (!['para_la_casa', 'cierre', 'automatico'].includes(m)) return { ok: false, porque: 'motivo desconocido' };
  if (s.esProveedor && m === 'para_la_casa') return { ok: true };
  if (pideCompra(texto)) return { ok: false, porque: 'el mensaje pide algo que la casa vende o resuelve' };
  if (m === 'cierre' && /[?¿]/.test(String(texto ?? ''))) return { ok: false, porque: 'el mensaje trae una pregunta' };
  // un «sí» o un «ok» a lo que le preguntaste es una respuesta, no un cierre (una despedida sí)
  if (m === 'cierre' && s.botDejoPregunta && !esDespedida(texto)) return { ok: false, porque: 'contesta la pregunta que le hiciste' };
  return { ok: true };
}

/**
 * El modelo no escribió nada (o solo explicó por qué no contesta) y no llamó no_contestar:
 * ¿el código puede decidir el silencio? Cierre: un «gracias» o un «nos vemos» (o un «ok» sin
 * pregunta del bot). Para la casa: un proveedor; o, si no pide nada que la casa venda, una
 * charla que venía llevando una persona, una nota ya dejada en el turno o un mensaje que
 * nombra a alguien de la casa sin pregunta ni archivo (con pregunta, solo si el modelo
 * explicó que no era para él). Si no, null: se le vuelve a pedir la respuesta al modelo.
 */
export function silencioPorReglas(texto: string, s: SenalesDeLaCasa & { decidioNoContestar?: boolean }): MotivoDeSilencio | null {
  if (!s.conArchivo && (esDespedida(texto) || (esCierreDeCharla(texto, { conAfirmacion: true }) && !s.botDejoPregunta))) return 'cierre';
  if (s.esProveedor) return 'para_la_casa';
  if (pideCompra(texto)) return null;
  if (s.siguePersona || s.anotoEnElTurno) return 'para_la_casa';
  if (nombraAAlguienDeLaCasa(texto) && (s.decidioNoContestar || (!/[?¿]/.test(texto) && !s.conArchivo))) return 'para_la_casa';
  return null;
}

// ---- la insistencia ----
const RE_INSISTE = /\b(?:pued[ea]n?|podr[ií]a[ns]?|pod[eé]s)\s+(?:por favor\s+)?(?:responder|contestar)(?:me|nos)?\b|\b(?:no\s+)?(?:me|nos)\s+(?:responden|contestan|respond[eé]s|contest[aá]s)\b|\b(?:sigo|estoy|seguimos|estamos)\s+esperando\b|\bhay alguien\b|\bnadie\s+(?:me\s+)?(?:responde|contesta)\b|\b(?:alguna\s+)?novedad(?:es)?\b|\bsaben algo\b|^\s*[?¿]+\s*$|^\s*(?:hola+|buenas+)\s*[?¿]+\s*$/i;

/** «¿Puede por favor responderme?», «sigo esperando», «??», «¿novedades?»: el cliente insiste en que le contesten. */
export function insiste(texto: string | null | undefined): boolean {
  return RE_INSISTE.test(String(texto ?? '').trim());
}

/** Minutos que una consulta silenciosa puede quedar sin respuesta antes de que la insistencia del cliente pase a una persona. */
export const MINUTOS_CONSULTA_SIN_RESPUESTA = 30;

// ---- teléfonos que la casa misma da ----
const RE_TELEFONO = /\b(?:11|15)\s?\d{4}[\s-]?\d{4}\b/g;

/** Los teléfonos que figuran en las reglas de la casa (el de Fruit, 12/10/2026) o en la información vigente: esos el bot los puede dar. */
export function telefonosDeLaCasa(...textos: (string | null | undefined)[]): Set<string> {
  const s = new Set<string>();
  for (const t of textos) for (const m of String(t ?? '').matchAll(RE_TELEFONO)) s.add(m[0].replace(/\D/g, ''));
  return s;
}

/** La oración trae un teléfono que la casa no dio (el candado de «otro teléfono»). */
export function traeOtroTelefono(oracion: string, permitidos: Set<string>): boolean {
  for (const m of String(oracion ?? '').matchAll(RE_TELEFONO)) if (!permitidos.has(m[0].replace(/\D/g, ''))) return true;
  return false;
}

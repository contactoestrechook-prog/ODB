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

const RE_DE_LA_CASA_G = new RegExp(RE_DE_LA_CASA.source, 'g');

/** El mensaje le habla por su nombre a alguien de la casa. */
export function nombraAAlguienDeLaCasa(texto: string | null | undefined): boolean {
  return RE_DE_LA_CASA.test(sinTildes(texto ?? ''));
}

// el nombre de la persona de la casa y el saludo van adelante del pedido: «Hola Jackie! 3 picadas
// XL», «Jaqui necesito 2 picadas». Sin sacarlos, el renglón no empieza por la cantidad y el
// pedido no se veía (revisión del 21/10/2026: seis pedidos a Jackie daban «no pide nada»)
const RE_SALUDO_ADELANTE = /^[\s,.;:!¡¿?-]*(?:(?:hola+s?|holis|buenas+|buen dia|buenos dias|buenas (?:tardes|noches)|que tal)\b[\s,.;:!¡-]*)*/;
function sinNombreNiSaludo(t: string): string {
  return sinTildes(t).replace(RE_DE_LA_CASA_G, ' ').split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(RE_SALUDO_ADELANTE, '').trim()).join('\n');
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
  // revisión del 21/10/2026: lo que más le piden a Jackie. «necesito / quiero / quisiera» (no
  // «te quiero»), «me guardás», «separame», «reservámela», «paso a retirar», «lo que te encargué»
  String.raw`(?<!\b(?:te|los|las|la|lo) )\b(?:necesito|necesitaria|necesitamos|quiero|queremos|quisiera|quisieramos)\b`,
  String.raw`\b(?:me|nos) (?:guardas|guardan|anotas|anotan|agregas|agregan|sumas|suman|armas|arman|haces|hacen|pasas|pasan|das|dan|decis|dicen)\b`,
  String.raw`\b(?:mand|separ|guard|reserv|tra|prepar|envi|anot|agreg|sum|arm|pas)(?:a|e)?(?:me|nos)(?:l[oa]s?)?\b|\b(?:dame|danos|decime|decinos)\b`,
  String.raw`\b(?:paso|pasamos|pasa|pasan|pasar|voy|vamos|va|van|ir|iria|irian|vengo|venir) a (?:buscar|retirar)\w*`,
  String.raw`\b(?:te|les?) encargu?e\b|\bencargue\b`,
  // un pago o un comprobante: lo resuelve la casa (derivar_pago, «Recibido.»), nunca se calla
  String.raw`\b(?:transferi\w*|transferencia\w*|comprobante\w*|pague|pagado|pagamos|pagar|abone|abonar|alias|cbu|sena|factura\w*)\b`,
].join('|'));
// «¿Y materas?», «¿Y el de litro?»: una pregunta corta por algo (no «¿y vos?», «¿y cómo estás?»)
const RE_Y_ALGO = /^\s*¿?\s*y\s+(?!(?:vos|ustedes|usted|tu|como|que tal)\b)[^?\n]{2,40}\?/m;
// «un abrazo», «una consulta»: el número es de la cortesía, no una cantidad pedida
const NO_ES_PRODUCTO = /^(?:abrazo|beso|saludo|consulta|pregunta|favor|duda|cosa|momento|rato|ratito|minuto|segundo|vez|dia|tarde|noche)\b/;

/** El mensaje pide algo que la casa vende o resuelve (pedido, encargo, precio, si hay, envío, retiro, un pago). */
export function pideCompra(texto: string | null | undefined): boolean {
  const t = sinTildes(texto ?? '');
  if (RE_PIDE_COMPRA.test(t)) return true;
  const sinNombre = sinNombreNiSaludo(String(texto ?? ''));
  if (RE_Y_ALGO.test(sinNombre)) return true;
  return cantidadesPedidas(sinNombre).some((c) => !NO_ES_PRODUCTO.test(sinTildes(c.que)));
}

// lo que pide o pregunta algo aunque no lleve «?» («quisiera saber hasta qué hora…», «Me podrías
// decir el horario», «Necesito destapar piletas»): con esto, un «Gracias» al final no es un cierre
const RE_PIDE_ALGO = /\b(?:saber|decir(?:me|nos|le)?|deci(?:me|nos)|necesit\w*|quisiera\w*|quiero|consult\w*|pregunt\w*|podes|podr[ií]a[ns]?|pueden|horarios?|hasta que hora|a que hora|abiert[oa]s?|abren|cierran|cuanto|cuando|donde|precios?|tenes|tienen|no se|que es|averigu\w*|ayud\w*)\b/;
/** El mensaje pide o pregunta algo (con o sin «?», o un pedido). */
export function pideAlgo(texto: string | null | undefined): boolean {
  const t = String(texto ?? '');
  return /[?¿]/.test(t) || RE_PIDE_ALGO.test(sinTildes(t)) || pideCompra(t);
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

// los emojis con que se cierra o se agradece (solos, son un cierre: 👍, 🙏); 👋 acompaña un saludo o una
// despedida pero solo no cierra (un número nuevo que escribe «👋» saluda). Cualquier otro (❓ 🤔 😡 😢)
// es alguien esperando algo: nunca es un cierre (revisión del 21/10/2026: «❓❓» se callaba)
const EMOJI_DE_CIERRE = new Set(Array.from('👍🙏🫶👌❤🙂😊😂🤣✨🔥☺🥰🤗😘💪👏🙌😉😁😀😃😄💯✅🤝💕💖💗💛💙💚🧡💜🤍😍🥂🍷✌'));
const EMOJI_QUE_ACOMPANA = new Set(Array.from('👋'));
const emojisDe = (t: string): string[] => t.match(/\p{Extended_Pictographic}/gu) ?? [];

/**
 * El mensaje entero es un cierre: «Ok, graciasN», «Ahh ok.», «Muy buena!!! Jajaja»,
 * «Excelente buenísimo!! Nos vemos☺️», «Buenos días, gracias», 👍. Sin pregunta y sin
 * ninguna otra palabra; un saludo solo no es cierre, tampoco con un emoji («Hola 👋»). Estricto
 * (antes de llamar al modelo): hace falta una palabra que cierre por sí sola, así «Sí, dale» o
 * «Hola!!! Ok» siguen al modelo. Con afirmación (cuando el modelo ya no escribió nada): alcanza un
 * «ok» o un «sí». Solo emojis: si todos son de cierre (👍🙏😊), no «❓» ni «🤔».
 */
export function esCierreDeCharla(texto: string | null | undefined, o: { conAfirmacion?: boolean } = {}): boolean {
  const t = String(texto ?? '').trim();
  if (!t || /[?¿]/.test(t)) return false;
  const emojis = emojisDe(t);
  if (emojis.some((e) => !EMOJI_DE_CIERRE.has(e) && !EMOJI_QUE_ACOMPANA.has(e))) return false;
  const ws = palabras(t);
  if (!ws.length) return emojis.length > 0 && emojis.every((e) => EMOJI_DE_CIERRE.has(e));
  // con palabras, cierra una palabra: el emoji solo acompaña
  let cierra = false;
  for (const w of ws) {
    if (RISA.test(w) || palabraDe(PROPIO, w)) { cierra = true; continue; }
    if (palabraDe(AFIRMACION, w)) { if (o.conAfirmacion) cierra = true; continue; }
    if (FUNCION.has(w) || SALUDO.has(w)) continue;
    return false;
  }
  return cierra;
}

/**
 * Lo último que dijo es una despedida y antes no pidió ni preguntó nada: «Ah no, quería el coreano de
 * verdad. Bueno, gracias!!». No: «Hola quisiera saber hasta qué hora está abierto… Gracias», «Me
 * podrías decir el horario / Gracias», «Necesito destapar piletas / Gracias» (revisión del 21/10/2026).
 */
export function terminaEnCierre(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').trim();
  if (!t || /[?¿]/.test(t)) return false;
  const partes = t.split(/[.!\n…]+/).map((p) => p.trim()).filter((p) => palabras(p).length);
  const ultima = partes.at(-1);
  if (!ultima || !esCierreDeCharla(ultima, { conAfirmacion: true }) || !palabras(ultima).some((w) => palabraDe(DESPEDIDA, w))) return false;
  // «Te paso el pedido: 2 fernet. Gracias!» tampoco: trae un pedido
  return !pideAlgo(t);
}

/** Se despide: un cierre con «gracias», «nos vemos», «saludos»… (o que termina así). */
export function esDespedida(texto: string | null | undefined): boolean {
  return (esCierreDeCharla(texto, { conAfirmacion: true }) && palabras(String(texto ?? '')).some((w) => palabraDe(DESPEDIDA, w))) || terminaEnCierre(texto);
}

// lo que acompaña a una despedida pura («Muchas gracias, buen día», «Nos vemos, saludos»)
const RELLENO_DE_DESPEDIDA = new Set(['muchas', 'muchos', 'mil', 'muy', 'un', 'una', 'de', 'nos', 'hasta', 're', 'sos', 'vos', 'te', 'les', 'y', 'que', 'tengas', 'tengan', 'buen', 'buena', 'buenas', 'buenos', 'finde', 'semana']);

/**
 * Una despedida PURA: solo «gracias», «nos vemos», «saludos», «chau» (con su relleno), sin un «sí»,
 * un «ok», un «nada más» ni un elogio. Con una pregunta del bot pendiente, es lo único que no la
 * contesta: «Sí, gracias!», «Ok gracias», «No, nada más. Gracias!» son respuestas (revisión 21/10/2026).
 */
export function esDespedidaPura(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').trim();
  if (!t || /[?¿]/.test(t) || emojisDe(t).some((e) => !EMOJI_DE_CIERRE.has(e) && !EMOJI_QUE_ACOMPANA.has(e))) return false;
  const ws = palabras(t);
  let hay = false;
  for (const w of ws) {
    if (palabraDe(DESPEDIDA, w)) { hay = true; continue; }
    if (RISA.test(w) || RELLENO_DE_DESPEDIDA.has(w) || SALUDO.has(w)) continue;
    return false;
  }
  return hay;
}

/**
 * Con una pregunta, la lista o un ofrecimiento del bot pendiente, ¿el mensaje cierra la charla? Una
 * despedida pura, o un «no» con la despedida («No, gracias», «Ah nono, quería el coreano. Bueno,
 * gracias!!»). No: «Sí, gracias!», «Ok gracias», «Genial, gracias» (dicen que sí) ni «No, nada más.
 * Gracias!» (da por completa la lista: hay que cotizar). Revisión del 21/10/2026.
 */
const RE_NEGATIVA = /(?<![a-záéíóúñ])(?:nono+|no+|nop|nah)(?![a-záéíóúñ])/i;
export function cierraConPreguntaPendiente(texto: string | null | undefined): boolean {
  if (esDespedidaPura(texto)) return true;
  const t = String(texto ?? '');
  if (!RE_NEGATIVA.test(t) || confirmaLaLista(t)) return false;
  // sin el «no», lo que queda es una despedida: «No, gracias» → «gracias»
  return esDespedida(t.replace(new RegExp(RE_NEGATIVA.source, 'gi'), ' '));
}

// «nada más», «eso es todo», «ya está»: el cliente da por completa la lista (paso 1b del prompt: se cotiza)
const RE_CONFIRMA_LISTA = /\b(?:nada mas|eso es todo|es todo|ya esta|eso nomas|nomas eso|solo eso|eso solo|con eso (?:esta|alcanza|va))\b/;
/** El mensaje da por completa la lista del pedido («Listo, nada más, gracias», «Ya está, gracias»). */
export function confirmaLaLista(texto: string | null | undefined): boolean {
  return RE_CONFIRMA_LISTA.test(sinTildes(String(texto ?? '')));
}

// lo último del bot espera un sí aunque no lleve «?»: la lista del pedido («• 2 × Fernet…») o un ofrecimiento
// («Te lo puedo reservar.», «Si querés, te lo anoto.»). Ahí «Dale», «Divino, dale» o «Listo, nada más,
// gracias» contestan: no son un cierre (revisión del 21/10/2026)
const RE_OFRECE = /^\s*•|\bte (?:lo|la|los|las) (?:puedo |podemos )?(?:reserv|anot|agreg|sum|mand|guard|separ|envi|prepar|dej)\w*|\bsi quer[eé]s\b|\b(?:lo|la|los|las) (?:reservo|anoto|agrego|preparo|separo|guardo|mando|sumo)\b/im;
/** Lo último que escribió el bot es una lista o un ofrecimiento: un «dale» o un «nada más» le contesta. */
export function botOfrecioAlgo(ultimoDelBot: string | null | undefined): boolean {
  return RE_OFRECE.test(String(ultimoDelBot ?? ''));
}

/**
 * ¿El cliente espera una respuesta? La red de respaldo lo mira cuando el modelo no escribió
 * nada ni con la vuelta de cierre: solo entonces se consulta en silencio con administración.
 * Con una pregunta (o una lista u ofrecimiento) del bot pendiente, solo una despedida pura o un
 * «no, gracias» no esperan nada. Sin pregunta, un cierre del mensaje entero («gracias», «ok», 👍) no espera nada;
 * lo demás sí, también lo que termina en «Gracias» después de pedir algo (revisión del 21/10/2026).
 */
export function esperaRespuesta(texto: string | null | undefined, o: { botDejoPregunta: boolean; conArchivo?: boolean }): boolean {
  if (o.conArchivo) return true;
  if (o.botDejoPregunta) return !cierraConPreguntaPendiente(texto);
  return !esCierreDeCharla(texto, { conAfirmacion: true });
}

// lo que se le dice a una persona sin pedirle nada a la casa: un saludo, una felicitación, un abrazo
const SOCIAL = new Set([
  'feliz', 'felices', 'cumple', 'cumpleanos', 'dia', 'dias', 'aniversario', 'navidad', 'ano', 'anio', 'nuevo', 'felicidades',
  'felicitaciones', 'espero', 'que', 'pases', 'pasen', 'pase', 'precioso', 'preciosa', 'lindo', 'linda', 'hermoso', 'hermosa',
  'te', 'les', 'deseo', 'deseamos', 'bendiciones', 'muchas', 'muchos', 'mucho', 'mucha', 'como', 'estas', 'andas', 'anda', 'esta',
  'todo', 'bien', 'un', 'una', 'el', 'la', 'los', 'y', 'para', 'vos', 'ustedes', 'felicidad', 'exitos', 'buen', 'buena', 'semana',
  'finde', 'fin', 'de', 'mi', 'tu', 'con', 'amor', 'carino', 'querida', 'querido', 're', 'muy', 'mil', 'sos',
]);
/** El mensaje es solo un saludo, una felicitación o un abrazo para la persona: «Jacqui, feliz día!!», «Hola Shaki, feliz día. Espero que pases un día precioso». */
export function esSoloSocial(texto: string | null | undefined): boolean {
  const t = String(texto ?? '');
  if (/[?¿]/.test(t)) return false;
  const ws = palabras(sinTildes(t).replace(RE_DE_LA_CASA_G, ' '));
  return ws.length > 0 && ws.every((w) => SOCIAL.has(w) || SALUDO.has(w) || RISA.test(w) || palabraDe(PROPIO, w) || palabraDe(DESPEDIDA, w));
}

// ---- lo que escribió una persona desde el teléfono ----
// los rótulos con que mensajePropio guarda lo que se mandó desde el teléfono
const RE_ROTULO_TELEFONO = /^(?:📷 Foto enviada|🎙️ Audio enviado|🎬 Video enviado|📄 Archivo enviado)/u;
/** de: quién lo escribió (telefono, persona desde el panel); en: cuándo (desde el 21/10/2026) */
export type MensajeDelHilo = { role: string; content: any; de?: string; en?: string };

/** El mensaje de la casa lo escribió una persona (desde el teléfono o el panel), no el bot. */
export function escritoPorUnaPersona(m: MensajeDelHilo | null | undefined): boolean {
  if (!m || m.role !== 'assistant') return false;
  return m.de === 'telefono' || m.de === 'persona' || RE_ROTULO_TELEFONO.test(String(m.content ?? '').trim());
}

/**
 * Horas que lo escrito por una persona sigue contando como «la charla la lleva ella». La pausa del
 * teléfono dura 30 min y después el bot vuelve a atender (regla del 16/10/2026): lo de la persona
 * vale un rato más (el cliente le contesta a ella), no para siempre (revisión del 21/10/2026: el
 * «Dale, te lo guardo» del lunes callaba el «¿Ya puedo pasar a buscarlo?» del jueves).
 */
export const HORAS_SIGUE_PERSONA = 6;

/**
 * Lo último que dijo la casa en el hilo lo escribió una persona, hace menos de HORAS_SIGUE_PERSONA
 * y sin que después alguien le devolviera la charla al bot a mano (devolverAlBot o RESPONDE): lo que
 * el cliente conteste ahora, probablemente es para ella. Un mensaje sin hora (de antes del 21/10/2026)
 * no cuenta: para esos vale «el bot volvió solo hace poco».
 */
export function loUltimoDeLaCasaEsDeUnaPersona(historial: MensajeDelHilo[], o: { ahora?: number; devueltaAlBotEn?: number | null } = {}): MensajeDelHilo[] {
  const ahora = o.ahora ?? Date.now();
  const salida: MensajeDelHilo[] = [];
  for (let i = historial.length - 1; i >= 0; i--) {
    const m = historial[i];
    if (m.role !== 'assistant') { if (salida.length) break; continue; }
    if (!escritoPorUnaPersona(m)) break;
    salida.unshift(m);
  }
  return salida.filter((m) => {
    const en = Date.parse(String(m.en ?? ''));
    if (!Number.isFinite(en) || ahora - en > HORAS_SIGUE_PERSONA * 3600_000) return false;
    // se la devolvieron al bot a mano después de ese mensaje: la persona ya no la lleva
    return !(o.devueltaAlBotEn && o.devueltaAlBotEn >= en);
  });
}

/** Lo que va al modelo: solo rol y texto (las marcas «de» y «en» no son campos de la API). */
export function paraElModelo<T extends MensajeDelHilo>(historial: T[]): { role: T['role']; content: T['content'] }[] {
  return historial.map((m) => ({ role: m.role, content: m.content }));
}

// ---- la decisión ----
export type MotivoDeSilencio = 'para_la_casa' | 'cierre' | 'automatico';
export type SenalesDeLaCasa = {
  /** el contacto está registrado como proveedor (o se registró en este turno) */
  esProveedor?: boolean;
  /** lo último de la casa lo escribió una persona hace poco, o el bot volvió solo hace poco de una pausa del teléfono */
  siguePersona?: boolean;
  /** vino una foto o un PDF */
  conArchivo?: boolean;
  /** lo último que escribió el bot espera un sí: una pregunta, la lista del pedido o un ofrecimiento */
  botDejoPregunta?: boolean;
};

/**
 * no_contestar (la herramienta): ¿se acepta? Un proveedor, sí. Si el mensaje pide algo
 * que la casa vende o resuelve (también un pago), no: aunque nombre a Jackie, es un cliente
 * (la clienta del lote 112, 21/10/2026). Con una foto o un PDF, no: lo que pide está en el
 * archivo (salvo un proveedor). Un cierre no trae pregunta ni pide nada, y si el bot dejó una
 * pregunta, solo una despedida pura es un cierre («Sí, gracias» la contesta).
 */
export function aceptaNoContestar(motivo: string, texto: string, s: SenalesDeLaCasa = {}): { ok: true } | { ok: false; porque: string } {
  const m = String(motivo ?? '');
  if (!['para_la_casa', 'cierre', 'automatico'].includes(m)) return { ok: false, porque: 'motivo desconocido' };
  if (s.esProveedor && m === 'para_la_casa') return { ok: true };
  if (s.conArchivo) return { ok: false, porque: 'vino una foto o un PDF: leelo y contestá lo que pide (una lista, un comprobante, un producto)' };
  if (pideCompra(texto)) return { ok: false, porque: 'el mensaje pide algo que la casa vende o resuelve (un pedido, un precio, un retiro, un pago)' };
  if (m === 'cierre') {
    if (/[?¿]/.test(String(texto ?? ''))) return { ok: false, porque: 'el mensaje trae una pregunta' };
    if (pideAlgo(texto)) return { ok: false, porque: 'el mensaje pide o pregunta algo: no es un cierre' };
    // un «sí», un «ok» o un «nada más» a lo que le preguntaste (o a la lista) es una respuesta
    if (s.botDejoPregunta && !cierraConPreguntaPendiente(texto)) return { ok: false, porque: 'contesta la pregunta o la lista que le pasaste' };
  }
  return { ok: true };
}

/**
 * El modelo no escribió nada (o solo explicó por qué no contesta) y no llamó no_contestar:
 * ¿el código puede decidir el silencio? Con una foto o un PDF, nunca (salvo a un proveedor): se
 * le pide la respuesta al modelo, que lee el archivo. Cierre: un «gracias» o un «nos vemos» (o
 * un «ok» sin pregunta del bot); con una pregunta, una lista o un ofrecimiento pendiente, solo
 * una despedida pura o un «no, gracias». Para la casa: un proveedor; o, si no pide nada que la casa venda, una
 * charla que lleva una persona desde hace poco, o un mensaje que nombra a alguien de la casa y
 * es solo un saludo o una felicitación (o el modelo explicó que no era para él). Si no, null: se
 * le vuelve a pedir la respuesta al modelo, y si sigue vacía, la consulta silenciosa.
 * (revisión del 21/10/2026: nombrar a Jackie ya no alcanza para callar, como en producción)
 */
export function silencioPorReglas(texto: string, s: SenalesDeLaCasa & { decidioNoContestar?: boolean }): MotivoDeSilencio | null {
  if (s.conArchivo && !s.esProveedor) return null;
  if (!s.conArchivo && (s.botDejoPregunta ? cierraConPreguntaPendiente(texto) : (esDespedida(texto) || esCierreDeCharla(texto, { conAfirmacion: true })))) return 'cierre';
  if (s.esProveedor) return 'para_la_casa';
  if (pideCompra(texto)) return null;
  if (s.siguePersona) return 'para_la_casa';
  if (nombraAAlguienDeLaCasa(texto) && (s.decidioNoContestar || esSoloSocial(texto))) return 'para_la_casa';
  return null;
}

// ---- la insistencia ----
// (revisión del 21/10/2026) también «¿Alguien me responde?», «Me dicen algo?», «No me contestaron»,
// «Y?», «Hola? Alguien?», «¿Pudieron ver lo de la cera?»; «novedades» solo si es todo el mensaje
// («¿Hay novedades?»): «¿Qué novedades tienen en vinos?» es una pregunta de producto
const RE_INSISTE = new RegExp([
  String.raw`\b(?:pued[ea]n?|podr[ií]a[ns]?|pod[eé]s)\s+(?:por favor\s+)?(?:responder|contestar)(?:me|nos)?\b`,
  String.raw`\b(?:no\s+)?(?:me|nos)\s+(?:responden|contestan|respond[eé]s|contest[aá]s)\b`,
  String.raw`\bno\s+(?:me|nos)\s+(?:contestaron|respondieron|contest[oó]|respondi[oó]|contesta|responde|dijeron|dicen nada)(?![a-záéíóúñ])`,
  String.raw`\balguien\s+(?:me\s+|nos\s+)?(?:responde|contesta|atiende|lee)\b`, String.raw`\b(?:me|nos)\s+(?:dicen|dec[ií]s|dir[aá]n)\s+algo\b`,
  String.raw`\b(?:pudieron|pudiste|pudo|lograron)\s+(?:ver|averiguar|fijarse|chequear|revisar|consultar)\b`,
  String.raw`\b(?:sigo|estoy|seguimos|estamos)\s+esperando\b`, String.raw`\bhay alguien\b`, String.raw`\bnadie\s+(?:me\s+)?(?:responde|contesta)\b`,
  String.raw`\bsaben algo\b`, String.raw`^\s*[?¿]+\s*$`, String.raw`^\s*(?:hola+|buenas+)\s*[?¿]+\s*(?:alguien\s*[?¿]*)?\s*$`,
  String.raw`^\s*¿?\s*y\s*[?¿]+\s*$`, String.raw`^\s*¿?\s*alguien\s*[?¿]+\s*$`,
  String.raw`^\s*¿?\s*(?:hay\s+|alguna\s+|tienen\s+|ten[eé]s\s+)?novedad(?:es)?\s*[?¿!.]*\s*$`,
].join('|'), 'i');

/** «¿Puede por favor responderme?», «sigo esperando», «??», «¿novedades?», «¿Alguien me responde?»: el cliente insiste en que le contesten. */
export function insiste(texto: string | null | undefined): boolean {
  return RE_INSISTE.test(String(texto ?? '').trim());
}

/** Minutos que una consulta silenciosa puede quedar sin respuesta antes de que la insistencia del cliente pase a una persona. */
export const MINUTOS_CONSULTA_SIN_RESPUESTA = 30;
/** Hasta cuántas horas atrás se buscan las consultas sin respuesta cuando el cliente insiste (las abiertas del estado son de 6 h). */
export const HORAS_CONSULTA_INSISTENCIA = 48;

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

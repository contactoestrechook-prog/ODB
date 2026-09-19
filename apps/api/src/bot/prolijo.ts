// ---- PROLIJIDAD DEL LISTADO ----
// En WhatsApp un listado escrito de corrido es ilegible: "Ya cotizado: - 4 ×
// Agua 2L: 4 × $2.300 c/u = $9.200 - 1/2 kg Queso..." es un bloque de texto.
// Cada renglón tiene que ir en SU línea, con viñeta uniforme y el total en
// negrita. Esto no se le pide al modelo: se normaliza acá, siempre igual.
// Además, el cartel gráfico del pedido parsea estas líneas: si el total viene
// pegado al renglón, la tarjeta no sale.
// El bot JAMÁS le dice al cliente que no puede recibir, ver, escuchar o abrir
// lo que mandó. Regla del dueño, textual: "poné un candado, dos candados, tres
// candados, lo que haga falta, pero jamás pueda esa respuesta". Este es el
// detector; los candados que lo usan viven en charla: (1) regenerar con nota
// interna, (2) tirar la oración, (3) reemplazar el mensaje entero al final.
// Se escaparon en producción: "las imágenes que envió no las puedo visualizar
// de este lado", "no cuento con la función de interpretar mensajes de audio",
// "no dispongo de la posibilidad de reenviar archivos". Cubre la negación en
// cualquier orden, con clíticos, y la referencia genérica ("lo que me mandó").
const NEG_PERCIBO = String.raw`(?:no\s+(?:l[oa]s?\s+|me\s+|le\s+)?(?:puedo|pude|logro|consigo|cuento\s+con|dispongo|tengo\s+(?:la\s+)?(?:forma|manera|posibilidad|funci[oó]n|capacidad|opci[oó]n|acceso)(?:\s+(?:de|a|para))?|estoy\s+en\s+condiciones\s+de|me\s+es\s+posible)|me\s+resulta\s+imposible|soy\s+incapaz\s+de|no\s+es\s+posible|estoy\s+imposibilitad[oa]\s+de)`;
const VERBO_PERCIBO = String.raw`(?:escuchar|escucharl[oa]s?|o[ií]r|reproducir|abrir|abrirl[oa]s?|ver|verl[oa]s?|visualizar|procesar|acceder|interpretar|leer|leerl[oa]s?|mirar|revisar|analizar|chequear|transcribir|reenviar|recibir|recibirl[oa]s?|descargar)`;
const COSA_PERCIBIDA = String.raw`(?:audios?|notas?\s+de\s+voz|mensajes?\s+de\s+voz|voz|fotos?|im[aá]gen(?:es)?|videos?|archivos?|adjuntos?|flyers?|comprobantes?|documentos?|pdfs?|capturas?(?:\s+de\s+pantalla)?|stickers?|lo\s+que\s+(?:me\s+)?(?:mand[oó]|envi[oó]|adjunt[oó]|pas[oó]))`;
// ojo: el \b de JavaScript es ASCII y falla después de una tilde ("mandó\b" no
// matchea); el borde final se hace a mano con un lookahead que conoce tildes
const FIN = String.raw`(?![a-za-záéíóúñ])`;
const RE_NO_PERCIBO = new RegExp(String.raw`\b${NEG_PERCIBO}\b[^.!?\n]{0,45}\b${VERBO_PERCIBO}\b[^.!?\n]{0,45}\b${COSA_PERCIBIDA}${FIN}|\b${COSA_PERCIBIDA}${FIN}[^.!?\n]{0,70}\b${NEG_PERCIBO}\b[^.!?\n]{0,30}\b${VERBO_PERCIBO}\b`, 'i');
const RE_SOLO_TEXTO = /\b(solo|s[oó]lo|[uú]nicamente)\b[^.!?\n]{0,30}\b(puedo|manejo|proceso|leo|entiendo|recibo|trabajo)\b[^.!?\n]{0,30}\btexto|\bde\s+este\s+lado\b[^.!?\n]{0,40}\b(no|sin)\b|\b(?:este|el)\s+(?:medio|canal|chat|sistema)\s+no\s+(?:permite|admite|soporta|acepta)\b/i;

export function niegaPercepcion(t: string): boolean {
  return RE_NO_PERCIBO.test(t) || RE_SOLO_TEXTO.test(t);
}

// El registro del bot (decisión del dueño, 2026-09-01): trato de VOS, nunca de
// usted, pero sumamente respetuoso — la cercanía es del trato, no de la
// confianza. El prompt (TONO_BOT) lo ordena; esto es el candado determinístico:
// convierte los restos de usted que son inequívocos (no se puede invertir
// "tiene"→"tenés" porque se confunde con la tercera persona legítima), y
// mantiene la sobriedad: sin emojis, sin exclamaciones, sin muletillas de
// amigo ("che", "dale", "joya").
const DE_USTED: Array<[RegExp, string]> = ([
  ['dígame', 'decime'], ['cuénteme', 'contame'], ['mándeme', 'mandame'],
  ['páseme', 'pasame'], ['avíseme', 'avisame'], ['escríbame', 'escribime'],
  ['fíjese', 'fijate'], ['disculpe', 'disculpá'],
  ['usted', 'vos'], ['dale', 'de acuerdo'],
] as Array<[string, string]>).map(([de, a]) => [
  // bordes de palabra hechos a mano: el \b de JS no ve fin de palabra tras tilde
  new RegExp(String.raw`(?<![a-za-záéíóúñ])${de}(?![a-za-záéíóúñ])`, 'gi'),
  a,
]);
const CONFIANZUDO = /,?\s*\b(che|tranqui|querid[oa]|amigo|jefe|genio|capo)\b/gi;

export function respetuosoSinConfianza(t: string): string {
  let r = t;
  for (const [re, a] of DE_USTED) {
    r = r.replace(re, (m) => (m[0] === m[0].toUpperCase() ? a[0].toUpperCase() + a.slice(1) : a));
  }
  r = r.replace(CONFIANZUDO, '');
  // sin exclamaciones: se bajan a punto (o se quitan, si ya hay puntuación)
  r = r.replace(/¡/g, '').replace(/!+(?=\s*[.?!])/g, '').replace(/!+/g, '.');
  // sin emojis (la viñeta •, el × y el $ no son emojis y quedan)
  r = r.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '');
  return r.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
}

// El saludo acompaña el reloj de Buenos Aires: buen día hasta las 13, buenas
// tardes hasta las 20, buenas noches después. El modelo no tiene reloj, así
// que esto se decide acá y no por su buena voluntad.
export function saludoSegunHora(hora: number): string {
  return hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
}

// Primer mensaje de una charla: arranca SIEMPRE con el saludo correcto para la
// hora y la bienvenida a la casa, diga lo que diga el modelo. Si el modelo ya
// saludó con otra hora, se corrige; si no saludó, se antepone; la bienvenida
// no se duplica si ya la puso él.
export function saludarConBienvenida(respuesta: string, saludo: string): string {
  let r = respuesta.trim();
  // "Hola, buen día" → el hola sobra si ya viene el saludo horario
  r = r.replace(/^¡?hola[.,!]?\s+(?=¡?buen)/i, '');
  // se quita el saludo que haya puesto el modelo (con la hora que imaginó)
  r = r.replace(/^¡?(buen d[ií]a|buen[oa]s d[ií]as|buenas tardes|buenas noches|hola)[!.,]?\s*/i, '');
  const yaDaBienvenida = /bienvenid/i.test(r);
  if (r) r = r[0].toUpperCase() + r.slice(1);
  const arranque = yaDaBienvenida ? `${saludo}. ` : `${saludo}, te damos la bienvenida a O.D.B. `;
  return (arranque + (r || '¿En qué te puedo ayudar?')).trim();
}

// Un nombre de cliente es un nombre o no es nada: en producción llegó a
// guardarse un fragmento de llamada de herramienta ('</parameter>…"tipo">pickup')
// como nombre de un cliente real. Solo letras, espacios y puntuación de
// nombres; cualquier otra cosa se descarta y el pedido sigue sin nombre.
export function nombreLimpio(s: string | null | undefined): string | null {
  const n = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 60) return null;
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.\- ]*$/.test(n)) return null;
  return n;
}

export function emprolijarListado(t: string): string {
  let r = t;
  // 1. cada guion/viñeta de listado arranca renglón propio
  r = r.replace(/[ \t]+[-–—•]\s+(?=[A-ZÁÉÍÓÚÑ0-9¿])/g, '\n• ');
  r = r.replace(/^[ \t]*[-–—]\s+/gm, '• ');
  // 2. "Ya cotizado:" / "Le confirmo lo que quedó:" cortan antes del listado
  r = r.replace(/([:：])[ \t]*(?=•)/g, '$1\n');
  // 3. una línea en blanco antes del listado, ninguna adentro
  r = r.replace(/\n{3,}/g, '\n\n');
  r = r.replace(/(•[^\n]*)\n\n(?=•)/g, '$1\n');
  // 4. lo que sigue a un importe y arranca en mayúscula o pregunta NO es
  // parte del renglón: "$20.900 Subtotal…" y "$4.700 ¿Busca…" quedaban
  // pegados al último ítem del listado
  r = r.replace(/(\$[\d.]+)[ \t]+(?=[¿A-ZÁÉÍÓÚÑ])/g, '$1\n\n');
  // 4c. renglón completo (ya tiene precio) que cierra paréntesis y sigue con
  // una oración nueva: "…$9.900 (Sant Thomas) La bolsa de 5 kg…" — la oración
  // baja a su línea. Solo si el renglón ya tiene $: un paréntesis en medio del
  // nombre de un producto no se toca.
  r = r.replace(/^(•[^\n]*\$[\d.]+[^\n]*?\))[ \t]+(?=[A-ZÁÉÍÓÚÑ])/gm, '$1\n\n');
  // 4a. la pregunta pegada al final de un renglón baja a su propia línea:
  // "…(se compra en el mostrador) ¿Cuántas necesita?" — la regla del importe
  // no la ve porque el renglón termina en paréntesis, no en precio
  r = r.replace(/^(•[^\n¿]*?)[ \t]+(¿[^\n]*\?)[ \t]*$/gm, '$1\n\n$2');
  // 4b. si el modelo YA escribió el total en negrita y pegado al renglón
  // ("= $15.000 *Total: $15.000* Es el total…"), se le saca la negrita y se
  // corta a renglón propio; la regla 5 lo vuelve a armar siempre igual
  r = r.replace(/\*[ \t]*(total[^:\n*]{0,30}:?[ \t]*\$\s?[\d.]+)[ \t]*\*/gi, '$1');
  r = r.replace(/[ \t]+(?=total[^:\n]{0,30}:?[ \t]*\$)/gi, '\n');
  // 5. el TOTAL en negrita de WhatsApp y en su propia línea
  r = r.replace(/(?:^|\n)[ \t]*(?:•\s*)?(total[^:\n]{0,30}:?)[ \t]*(\$\s?[\d.]+)/gi,
    (_m, etiqueta: string, monto: string) => `\n\n*${etiqueta.trim().replace(/:$/, '')}: ${monto.replace(/\s/g, '')}*`);
  // 5b. lo que sigue al total en su misma línea baja a renglón propio
  r = r.replace(/(\*total[^\n]{0,40}\$[\d.]+\*)[ \t]+(?=[¿A-ZÁÉÍÓÚÑ*])/gi, '$1\n\n');
  // 6. separadores de miles uniformes ($9200 → $9.200) y sin espacio tras $
  r = r.replace(/\$\s+(\d)/g, '$$$1');
  r = r.replace(/\$(\d{4,})\b/g, (_m, n: string) => '$' + Number(n).toLocaleString('es-AR'));
  // 7. el signo × uniforme (x, X, * entre números)
  r = r.replace(/(\d)\s*[xX*]\s*(?=\$|\d)/g, '$1 × ');
  return r.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Cómo se nombra la sucursal central ante el cliente (Leandro, 16/9/2026:
// "Saint o ST, mejor decir sucursal Saint Thomas, Suc ST"). En la base se
// llama "Suc Sant Thomas" y la caja la usa así: se corrige solo lo que se le
// dice al cliente.
export const SUCURSAL_CENTRAL = 'sucursal Saint Thomas';
export function nombreSucursalCliente(nombre: string | null | undefined): string {
  const n = String(nombre ?? '').trim();
  if (!n || /\bsa(i)?n(t)?h?\s*th?omas\b/i.test(n)) return SUCURSAL_CENTRAL;
  return n.replace(/^Suc\.?\s+/i, '');
}
export function saintThomas(t: string): string {
  return t
    .replace(/\b(la\s+)?(suc(ursal)?\.?\s+)?(Sant|San|Sainth?)\s+Th?omas\b/gi, (m, la) => `${la ?? ''}${SUCURSAL_CENTRAL}`)
    .replace(/\b(sucursal\s+)+sucursal Saint Thomas/gi, SUCURSAL_CENTRAL)
    .replace(/\b(en|a|de)\s+sucursal Saint Thomas/g, (_, prep) => `${prep === 'de' ? 'de la' : `${prep} la`} sucursal Saint Thomas`)
    .replace(/(^|[.?!:]\s+|\n)sucursal Saint Thomas/g, (_, a) => `${a}Sucursal Saint Thomas`);
}

// Los mensajes automáticos de WhatsApp Business (bienvenida y fuera de
// horario) salen "desde el teléfono" pero no los escribió nadie: no pausan.
// 16/9/2026 pausaron charlas en medio de una consulta de whiskies.
export function esAutomaticoWhatsappBusiness(t: string | null | undefined): boolean {
  const s = String(t ?? '').trim();
  return /^Gracias por comunicarte con ODB\b/i.test(s) || /^Gracias por tu mensaje\. En este momento este celular se encuentra fuera del horario/i.test(s);
}

// EL ENVÍO EN ODB ES SIN CARGO (regla de Leandro, 18/9/2026, reforzada el
// 19/9: "nunca más que digas esa parte"). El bot cerraba pedidos con "es el
// total de la mercadería; el envío va aparte" y así se lo dijo a un cliente con
// un pedido de $176.000. Acá se revisa ORACIÓN POR ORACIÓN cualquier texto que
// la casa esté por mandar: la que habla del envío y de un costo se reemplaza
// entera por "El envío es sin cargo.". Se aplica en la respuesta del bot y, de
// nuevo, en la puerta de salida de WhatsApp (enviarPorWhatsapp), que es por
// donde pasan también los avisos, las difusiones y el panel.
const RE_ENVIO = /\b(env[ií]os?|flete|entrega|reparto|delivery)\b/i;
const RE_COSTO = /\b(aparte|no est[aá]n? incluid\w*|no incluye|sin incluir|adicional\w*|extra|recargo|costo|cuesta|se cobra|se paga aparte|tiene un (costo|precio|valor)|lo cotiza|lo define|seg[uú]n la zona|depende de la zona|a cargo del cliente)\b|\$\s?\d/i;
// una oración de PAGO ("se abona al recibir, en efectivo o con tarjeta") habla
// de plata y de entrega sin cobrar el envío: esa no se toca
const RE_FORMA_DE_PAGO = /\b(efectivo|tarjeta|posnet|transferencia|mercado pago|link de pago|d[eé]bito|cr[eé]dito)\b/i;
const RE_YA_ESTA_BIEN = /\bsin cargo|gratis|bonificad|no tiene costo|no se cobra\b/i;

export function envioSinCargo(t: string): string {
  const texto = String(t ?? '');
  if (!RE_ENVIO.test(texto)) return texto;
  // se corta en frases Y en cláusulas (el ";" separa "es el total de la
  // mercadería" de "el envío va aparte"), conservando el separador
  const trozos = texto.split(/(?<=[.;!?])\s+|(?<=\n)/);
  let cambio = false;
  const salida = trozos.map((trozo) => {
    const limpia = trozo.trim();
    if (!limpia) return trozo;
    if (!RE_ENVIO.test(limpia) || !RE_COSTO.test(limpia)) return trozo;
    if (RE_YA_ESTA_BIEN.test(limpia) || RE_FORMA_DE_PAGO.test(limpia)) return trozo;
    cambio = true;
    const cola = trozo.endsWith('\n') ? '\n' : trozo.endsWith(' ') ? ' ' : '';
    return `El envío es sin cargo.${cola}`;
  });
  if (!cambio) return texto;
  return salida.join('')
    // lo que quedaba colgado de la frase partida: "Es el total de la
    // mercadería; El envío es sin cargo." → "El envío es sin cargo."
    .replace(/(?:^|(?<=[.\n]\s))(?:este\s+)?es\s+el\s+total\s+de\s+la\s+mercader[ií]a\s*[;,:]?\s*(?=El envío es sin cargo)/gi, '')
    .replace(/([;,])\s*El envío es sin cargo\./g, '$1 el envío es sin cargo.')
    .replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n +/g, '\n')
    .trim();
}

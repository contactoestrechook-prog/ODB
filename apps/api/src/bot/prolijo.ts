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
// detector; el candado que lo usa vive en charla, al final de todo (10/10/2026:
// eran tres): saca esa oración sin tocar la lista, y si no queda nada, el texto
// fijo; si vino un archivo, se consulta en silencio. El prompt también lo prohíbe.
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

// (10/10/2026: se sacó respetuosoSinConfianza, que pasaba el usted a vos y sacaba
// «dale», emojis y exclamaciones en código: cambiaba nombres de productos («Vino
// Capo») y pegaba renglones. El registro lo pide el prompt (TONO_BOT).)

// El saludo acompaña el reloj de Buenos Aires: buen día hasta las 13, buenas
// tardes hasta las 20, buenas noches después. El modelo no tiene reloj, así
// que esto se decide acá y no por su buena voluntad.
export function saludoSegunHora(hora: number): string {
  return hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
}

// Primer mensaje de una charla: arranca SIEMPRE con el saludo correcto para la
// hora, diga lo que diga el modelo. Si el modelo ya saludó con otra hora, se
// corrige; si no saludó, se antepone.
// 9/10/2026 (Leandro: «más seca la charla», «no tiene sentido hablar siempre lo
// mismo»): el saludo es corto, «Buenas tardes.», sin «te damos la bienvenida a
// O.D.B.» ni presentación. Si el modelo la escribió igual, se saca.
export function saludarConBienvenida(respuesta: string, saludo: string): string {
  let r = respuesta.trim();
  // "Hola, buen día" → el hola sobra si ya viene el saludo horario
  r = r.replace(/^¡?hola[.,!]?\s+(?=¡?buen)/i, '');
  // se quita el saludo que haya puesto el modelo (con la hora que imaginó)
  r = r.replace(/^¡?(buen d[ií]a|buen[oa]s d[ií]as|buenas tardes|buenas noches|hola)[!.,]?\s*/i, '');
  // la bienvenida y la presentación de arranque sobran
  r = r.replace(/^(?:te damos la bienvenida a o\.?d\.?b\.?|bienvenid[oa]s? a o\.?d\.?b\.?)[.,!]?\s*/i, '');
  r = r.replace(/^(?:soy emilia|te atiende emilia)[^.!?]*[.!]\s*/i, '');
  if (r) r = r[0].toUpperCase() + r.slice(1);
  // si el cliente solo saludó, una pregunta corta para que diga qué necesita
  return r ? `${saludo}. ${r}` : `${saludo}. ¿Qué necesitás?`;
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
  // 0. el nombre en un renglón y la cuenta en el siguiente ("• Fernet Branca
  // x750cc" / "• 2 × $20.500 c/u = $41.000") van en UNO solo: dos viñetas
  // parecían dos productos (banco de pruebas, 23/9/2026)
  r = r.replace(/^[ \t]*(?:[-–—•][ \t]*)?([^\n$•]*[A-Za-zÁÉÍÓÚÑáéíóúñ][^\n$]*?)[ \t]*\n[ \t]*(?:[-–—•][ \t]*)?(\d+(?:[.,]\d+)?[ \t]*(?:kg|g|gr|u|un)?[ \t]*[×xX*][ \t]*\$[^\n]*)$/gm,
    (m, nombre: string, cuenta: string) => /^(total|subtotal)\b|[:?]$/i.test(nombre.trim()) ? m : `• ${nombre.trim()} — ${cuenta.trim()}`);
  // 1. cada guion/viñeta de listado arranca renglón propio
  // (no el "— 2 × $20.500" que separa el nombre de la cuenta: eso partía cada
  // renglón en dos viñetas; banco de pruebas, 23/9/2026)
  r = r.replace(/[ \t]+[-–—•]\s+(?=[A-ZÁÉÍÓÚÑ0-9])(?!\d+(?:[.,]\d+)?\s*(?:kg|g|gr|u|un)?\s*[×xX*]\s*\$)/g, '\n• ');
  r = r.replace(/^[ \t]*[-–—]\s+/gm, '• ');
  // 1b. renglón de producto SIN viñeta ("2 Chuker con Stevia 200 cc: 2 × $4.800
  // c/u = $9.600"): arranca con una cantidad, tiene un precio y no es el total.
  // Sin la viñeta no se armaba el cartel gráfico de la lista (23/9/2026).
  r = r.replace(/^[ \t]*(?!total|subtotal)(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|u|un)?\s*[×x]?\s*[A-Za-zÁÉÍÓÚÑáéíóúñ][^\n]*\$\s?[\d.]+[^\n]*)$/gim, '• $1');
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
  // 4d. renglón con el precio en efectivo ("…, o $387.000 en efectivo o
  // transferencia Suntory está sin stock"): la oración que sigue baja a su
  // línea (30/9/2026)
  r = r.replace(/^(•[^\n]*\$[\d.]+[^\n]*?\ben efectivo o transferencia)[ \t]+(?=[A-ZÁÉÍÓÚÑ¿])/gm, '$1\n\n');
  // 4a. la pregunta pegada al final de un renglón baja a su propia línea:
  // "…(se compra en el mostrador) ¿Cuántas necesita?" — la regla del importe
  // no la ve porque el renglón termina en paréntesis, no en precio
  // (no si la pregunta está adentro de un paréntesis del renglón: lo partía al medio)
  r = r.replace(/^(•[^\n¿]*?)[ \t]+(¿[^\n]*\?)[ \t]*$/gm, (m, a: string, b: string) => ((a.match(/\(/g) ?? []).length > (a.match(/\)/g) ?? []).length ? m : `${a}\n\n${b}`));
  // 4b. si el modelo YA escribió el total en negrita y pegado al renglón
  // ("= $15.000 *Total: $15.000* Es el total…"), se le saca la negrita y se
  // corta a renglón propio; la regla 5 lo vuelve a armar siempre igual
  r = r.replace(/\*[ \t]*(total[^:\n*]{0,30}:?[ \t]*\$\s?[\d.]+)[ \t]*\*/gi, '$1');
  // solo la etiqueta "Total:" (con dos puntos) baja a su renglón; "el total queda en
  // $X" en mitad de una oración no se corta (1/10/2026)
  r = r.replace(/[ \t]+(?=total[^:\n$]{0,30}:[ \t]*\$)/gi, '\n');
  // 5. el TOTAL en negrita de WhatsApp y en su propia línea
  r = r.replace(/(?:^|\n)[ \t]*(?:•\s*)?(total[^:\n$(]{0,30}:?)[ \t]*(\$\s?[\d.]+)/gi,
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
// entera por "El envío es sin cargo.". Se aplica una vez, al final de la respuesta
// del bot, y en la respuesta del área al cliente (10/10/2026: ya no en la puerta de
// salida de WhatsApp, donde le cambiaba el texto a los avisos y al panel).
const RE_ENVIO = /\b(env[ií]os?|flete|reparto|delivery|entrega)\b/i;
// SOLO las que COBRAN el envío. Antes alcanzaba con que la oración nombrara el
// envío y tuviera un "$": se comía la oración del total ("reemplacé las Coca por
// Coca Zero, el total queda $75.000 con envío") y el mensaje perdía el contenido.
// El cliente terminó recibiendo tres veces el mismo "El envío es sin cargo.
// ¿Lo confirmo?" (Catalina, 21/9/2026).
const RE_COSTO = /\b(aparte|no est[aá]n? incluid\w*|no incluye|sin incluir|adicional\w*|recargo|tiene un (costo|precio|valor)|se cobra|se paga aparte|a cargo del cliente|lo cotiza|lo define|seg[uú]n la zona|depende de la zona)\b|\b(costo|precio|valor)\s+(de|del)\s+(env[ií]o|flete|reparto)|\b(env[ií]o|flete|reparto)\s+(cuesta|sale\s+\$?\s?\d)/i;
// una oración de PAGO ("se abona al recibir, en efectivo o con tarjeta") habla
// de plata y de entrega sin cobrar el envío: esa no se toca
const RE_FORMA_DE_PAGO = /\b(efectivo|tarjeta|posnet|transferencia|mercado pago|link de pago|d[eé]bito|cr[eé]dito)\b/i;
const RE_YA_ESTA_BIEN = /\bsin cargo|gratis|bonificad|no tiene costo|no se cobra\b/i;

/** Frases y cláusulas con su separador y su espacio: el punto de "$3.500" o "1.75" no corta. */
function trozosDeTexto(texto: string): string[] {
  const out: string[] = [];
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const corta = c === '\n' || (/[.;!?]/.test(c) && (i + 1 >= texto.length || /\s/.test(texto[i + 1])));
    if (!corta) continue;
    let j = i + 1;
    while (j < texto.length && /[ \t]/.test(texto[j])) j++;
    out.push(texto.slice(desde, j));
    desde = j;
    i = j - 1;
  }
  if (desde < texto.length) out.push(texto.slice(desde));
  return out;
}

export function envioSinCargo(t: string, minimo = 70000): string {
  const texto = String(t ?? '');
  if (!RE_ENVIO.test(texto)) return texto;
  const monto = '$' + minimo.toLocaleString('es-AR');
  // se corta en frases y cláusulas CONSERVANDO el separador (antes el join se
  // comía los espacios y salía "El envío es sin cargo.Recibe Catalina.")
  const trozos = trozosDeTexto(texto);
  let cambio = false;
  let yaLoDijo = /\benv[ií]o es sin cargo\b/i.test(texto);
  const salida = trozos.map((trozo) => {
    const limpia = trozo.trim();
    if (!limpia) return trozo;
    if (!RE_ENVIO.test(limpia) || !RE_COSTO.test(limpia)) return trozo;
    if (RE_YA_ESTA_BIEN.test(limpia) || RE_FORMA_DE_PAGO.test(limpia)) return trozo;
    cambio = true;
    const espacio = /\s$/.test(trozo) ? (trozo.endsWith('\n') ? '\n' : ' ') : '';
    // si el mensaje ya dice que es sin cargo, la oración que cobraba se borra
    // (no se repite la frase dos veces en el mismo mensaje)
    if (yaLoDijo) return espacio;
    yaLoDijo = true;
    return `El envío es sin cargo.${espacio}`;
  });
  if (!cambio) return conElMinimo(texto, monto);
  return conElMinimo(salida.join('')
    .replace(/(?:^|(?<=[.\n]\s))(?:este\s+)?es\s+el\s+total\s+de\s+la\s+mercader[ií]a\s*[;,:]?\s*(?=El envío es sin cargo)/gi, '')
    .replace(/([;,])\s*El envío es sin cargo\./g, '$1 el envío es sin cargo.')
    .replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n +/g, '\n')
    .trim(), monto);
}

// SIN CARGO, DESDE EL MÍNIMO (Leandro, 9/10/2026: «la compra mínima para el envío sin
// cargo son 70.000 pesos»; el bot contestó «Sí, el envío es siempre sin cargo»). Lo que
// diga que el envío es sin cargo lleva el mínimo, y nunca «siempre». No se toca el
// resumen ni la confirmación de un envío («Envío sin cargo a Mitre 1234»): ya lo pasa.
function conElMinimo(t: string, monto: string): string {
  if (!t || t.includes(monto) || /\bsin cargo a\s+\S/i.test(t)) return t;
  // un pedido que ya pasa el mínimo (su total está en el mensaje): no hace falta aclararlo
  const minimo = Number(monto.replace(/\D/g, ''));
  const montos = [...t.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g)].map((m) => Number(m[1].replace(/\./g, '')));
  if (montos.some((n) => n >= minimo)) return t;
  let hecho = false;
  return t.split('\n').map((linea) => linea.split(/(?<=[.!?])(\s+)/).map((o) => {
    if (hecho || !/\b(?:env[ií]os?|reparto|delivery)\b/i.test(o) || !/\b(?:sin cargo|gratis|sin costo|no tiene costo|no se cobra)\b/i.test(o)) return o;
    hecho = true;
    return o.replace(/\bsiempre\s+/i, '').replace(/\s+siempre\b/i, '')
      .replace(/\b(sin cargo|gratis|sin costo|no tiene costo|no se cobra)\b/i, `$1 en pedidos desde ${monto}`);
  }).join('')).join('\n');
}

// (10/10/2026: se sacó asegurarEnvioSinCargo, que ponía «El envío es sin cargo.» adelante
// de todo: se pegaba al primer renglón del resumen y la placa mostraba un total falso.)

// NUNCA EL MISMO MENSAJE DOS VECES (Leandro, 22/9/2026: "no quiero que repita
// nunca más un mensaje"). Dos textos son "el mismo" si, sacando tildes,
// mayúsculas y puntuación, comparten casi todas las palabras (casiIgual: lo usan
// la consulta silenciosa, las consultas repetidas y el comprobante repetido).
const palabrasDe = (t: string) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ$ ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2);

/**
 * ¿Dicen exactamente lo mismo, palabra por palabra (sin tildes, mayúsculas ni
 * puntuación)? Es la única repetición que frena charla() antes de mandar (10/10/2026):
 * una lista actualizada con un renglón distinto NO es lo mismo.
 */
export function mismasPalabras(a: string, b: string): boolean {
  const solo = (t: string) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ').trim();
  const A = solo(a);
  return !!A && A === solo(b);
}

export function casiIgual(a: string, b: string): boolean {
  const A = palabrasDe(a), B = palabrasDe(b);
  if (A.length < 5 || B.length < 5) return A.join(' ') === B.join(' ') && A.length > 0;
  const setB = new Set(B);
  const comunes = A.filter((w) => setB.has(w)).length;
  return comunes / Math.max(A.length, B.length) >= 0.85;
}

// Basura que el modelo a veces mete en los campos de una herramienta cuando
// el esquema lo obliga a llenar todo: etiquetas sueltas ("</antml…parameter>"),
// "null", "N/A", "vacío". Nada de eso es un dato del cliente (22/9/2026).
export function campoLimpio(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (/<\/?\s*(antml|parameter|invoke|function)/i.test(t) || /^(null|undefined|n\/a|na|vacio|vacío|ninguna|ninguno|-|—)$/i.test(t)) return '';
  return t;
}

// ============================================================
// CONSULTA SILENCIOSA (Leandro, 6/10/2026, regla fija)
//
// «No, que no diga te lo confirmo por acá, porque no lo confirma y no lo vuelve
// a escribir. Que dé una respuesta final.» Y al proponerle «Ese dato no lo
// tengo»: «No, ese dato no lo tengo tampoco. Si no sabe algo, lo consulta
// directamente con la administración, pero no se lo avisa al cliente que lo
// está consultando.»
//
// Lo que el bot no sabe va por adentro (consultar_interno: fila, campanita y
// WhatsApp al área) y al cliente NO se le dice nada de eso, en ninguna forma: ni
// que se consulta, ni que se le va a confirmar o avisar, ni que no se tiene el
// dato, ni que está pendiente. En el mismo mensaje va solo lo que sí se sabe; si
// el cliente preguntó solo lo que no se sabe, no se le manda nada en ese turno y
// la respuesta le llega cuando contesta el área (llevarRespuestaDeConsulta): esa
// es la respuesta final. Deja sin efecto el aviso «Lo de <tema> te lo confirmo
// por acá.» del 5/10 y, SOLO para ese caso, el «nunca dejar mudo al cliente» del
// 23/9: frente a un mensaje con OTRAS cosas, se contestan esas cosas.
//
// Lo de los días anteriores que sigue: la misma consulta no se repite (se le
// suma el dato), el tema (ahora de uso interno), la campanita y el recordatorio.
// ============================================================
// «TE LO CONFIRMO» PROMETE SOLO SI MIRA PARA ADELANTE (5/10/2026, revisión). En
// voseo «Sí, te lo confirmo: $317.100.» afirma un dato y «ya te confirmé el
// pedido» habla del pasado: tomarlas como promesa abría una consulta falsa
// (fila, WhatsApp a administración). Es promesa con una marca de después detrás
// («por acá», «cuando…», «apenas…», «después», «más tarde», «si entra…») o
// cerrando la oración, o con «ya» delante y en presente («ya te confirmo»).
// Nunca «¿Te lo confirmo?» (pregunta).
const DESPUES = String.raw`por\s+ac[aá](?![a-záéíóúñ])|por\s+este\s+medio|cuando\b|apenas\b|ni\s+bien\b|en\s+cuanto\b|despu[eé]s\b|m[aá]s\s+tarde\b|en\s+un\s+rat\w*|en\s+breve\b|a\s+la\s+brevedad\b|enseguida\b|en\s+un\s+momento\b|en\s+unos\s+minutos\b|si\s`;
// Cerrando la oración cuenta salvo después de un «sí»: «Sí, te lo confirmo.»
// contesta «¿me confirmás que abren el domingo?», no promete nada.
const CONFIRMO_PROMESA = String.raw`(?<!¿\s?)(?:\bya\s+(?:te|le|se)\s+(?:(?:lo|la|los|las)\s+)?confirmo\b(?!\s*[:,])|\b(?:te|le|se)\s+(?:(?:lo|la|los|las)\s+)?confirm(?:o|amos|an)\b(?=\s*(?:${DESPUES}))|(?<!\bs[ií],?\s{1,3})\b(?:te|le|se)\s+(?:(?:lo|la|los|las)\s+)?confirm(?:o|amos|an)\b(?=\s*(?:[.!…]|$)))`;
// "lo consulto" en primera persona: el bot que consulta. «Te consulto, ¿es para
// retirar?» le pregunta al cliente y «Podés consultar con tu banco» no promete
// nada: no cuentan (5/10/2026, revisión)
const CONSULTO = String.raw`(?:\b(?:lo|la|los|las)\s+)?(?<!\bte\s)\bconsulto\b|\b(?:estoy|estamos)\s+consultando\b|\b(?:voy|vamos)\s+a\s+consultar\w*|\b(?:tengo|tenemos|hay)\s+que\s+consultar\w*|\bd[eé]jame\s+consultar\w*|\bconsultamos\b|\blo\s+verifico\s+con\b`;
// lo que el bot diría que hace después (6/10/2026, revisión): «te digo», «te comento», «te contesto»…
const VERBOS_DESPUES = String.raw`(?:digo|decimos|confirmo|confirmamos|aviso|avisamos|paso|pasamos|escribo|escribimos|contesto|contestamos|comento|comentamos|respondo|respondemos|cuento|contamos)`;

// QUE NO LO SABE (6/10/2026; la parte de MENCIONES que dice que no tiene un dato,
// no las promesas). «Ese dato no lo tengo» es la propuesta que Leandro rechazó.
// Un hecho del catálogo no es esto: «De Raquis Monasterio no tengo ahora» se
// queda. En un turno de pago en manos de administración una promesa habla del
// pago (ya avisado), pero esto es OTRA cosa que el bot no sabía y se consulta
// aparte (revisión del 6/10/2026, diceQueNoSabe).
const NO_SABE = [
  String.raw`\bno\s+(?:lo\s+|la\s+)?tengo\s+(?:ese\s+|el\s+|este\s+|esa\s+|la\s+)?(?:dato|info(?:rmaci[oó]n)?)\b|\b(?:ese|el|este)\s+dato\s+no\s+(?:lo\s+)?tengo\b|\b(?:esa|la|esta)\s+info(?:rmaci[oó]n)?\s+no\s+(?:la\s+)?tengo\b|\bno\s+cuento\s+con\s+(?:ese|esa|el|la)\s+(?:dato|informaci[oó]n)\b|\bno\s+(?:lo\s+|la\s+)?tengo\s+cargad|\bno\s+lo\s+s[eé](?![a-záéíóúñ])`,
  // revisión 6/10/2026, lo que se escapaba: que no lo sabe («No sé si vienen en caja», «No sabría decirte», «No te puedo confirmar si…»).
  // «No sé si preferís retirar» le pregunta al cliente: no cuenta
  String.raw`\bno\s+(?:la|los|las)\s+s[eé](?![a-záéíóúñ])|\bno\s+s[eé]\s+si\b(?!\s+(?:prefer|quer|necesit|te\s|le\s))|\bno\s+sabr[ií]a\b|\bdesconozco\b|\bno\s+dispongo\s+de\s+(?:es[ae]|esta|este|la|el)\s+(?:dato|info\w*)`,
  // 10/10/2026: también sin pronombre y con «garantizar», «no estoy seguro de que» y «no tengo forma
  // de saber» («No puedo confirmar si llega a su zona», 22/8): eran de la guarda del envío dudoso, que se sacó
  String.raw`\bno\s+(?:(?:te|le)\s+)?(?:lo\s+|la\s+)?(?:puedo|podr[ií]a)\s+(?:confirmar|asegurar|garantizar|decir|precisar)\s+(?:si|cu[aá]ndo|cu[aá]nto|qu[eé]|c[oó]mo|d[oó]nde)\b|\bno\s+(?:puedo|podr[ií]a)\s+(?:confirmar|asegurar|decir|precisar)(?:te|le)\s+(?:si|cu[aá]ndo|cu[aá]nto|qu[eé]|c[oó]mo|d[oó]nde)\b|\bno\s+estoy\s+segur[oa]\s+(?:de\s+)?(?:si|que)\b|\bno\s+tengo\s+forma\s+de\s+saber\b`,
  String.raw`\bno\s+tengo\s+(?:datos|informaci[oó]n|info|novedad(?:es)?)\s+(?:de|del|sobre|acerca|respecto)\b|\beso\s+no\s+lo\s+(?:tengo|s[eé])(?![a-záéíóúñ])(?!\s+(?:en\s+stock|ahora|disponible))`,
  // que todavía no lo tiene («Todavía no lo tengo.», «Aún no tengo novedades»). «De
  // Raquis Monasterio no tengo ahora» (sin stock) es un hecho del catálogo y se queda
  String.raw`\b(?:todav[ií]a|a[uú]n)\s+no\s+(?:lo|la|los|las)\s+(?:tengo|s[eé])(?![a-záéíóúñ])(?=\s*(?:[.!…,;]|$))|\b(?:todav[ií]a|a[uú]n|por\s+ahora|de\s+momento)\s+no\s+(?:tengo|s[eé]|hay)\s+(?:novedad(?:es)?|respuesta|el\s+dato|ese\s+dato|esa\s+info\w*|nada\s+(?:de|sobre))\b|\bsin\s+novedades\b`,
].join('|');

// LO QUE AL CLIENTE NO SE LE DICE NUNCA (6/10/2026), una familia por renglón. Vale
// para cualquier respuesta del bot, haya consulta en el turno o no: la red de
// respaldo lo toma como señal de que el modelo no sabía algo (lo consulta en
// silencio) y la última limpieza (sinMencionDeConsulta) lo saca siempre.
// que lo pasa a un área («Lo paso a compras», «Te lo paso al equipo de reparto», «Lo derivo a
// administración»). Aparte porque con registrar_proveedor o nota_interna en el turno ese pase ya
// está hecho (ver mencionaConsultaSinElPase; 10/10/2026)
const PASA_A_UN_AREA = String.raw`\b(?:lo|la|tu\s+consulta|su\s+consulta|tu\s+pregunta)\s+(?:pas[oeé]|pasamos|deriv[oeé]|derivamos|elev[oeé]|elevamos|traslad[oeé]|trasladamos)\s+(?:a|al)\s+(?:administraci[oó]n|el\s+local|local|compras|reparto|equipo|el\s+equipo|[aá]rea|sector|una\s+persona)\b|\b(?:le|te)\s+paso\s+(?:tu|su|la)\s+(?:consulta|pregunta)\b`;

const MENCIONES = [
  // que consulta, que lo confirma después
  CONSULTO,
  CONFIRMO_PROMESA,
  // que vuelve, averigua, revisa o está viendo
  // («Estoy viendo que pediste 2 Fernet» no: solo «lo estoy viendo» o averiguando)
  String.raw`\bvuelvo\s+a\s+vos\b|\blo\s+averiguo\b|\b(?:lo|la|eso)\s+(?:estoy|estamos)\s+(?:viendo|averiguando|chequeando|revisando|verificando)\b|\b(?:estoy|estamos)\s+(?:averiguando|chequeando|verificando)\b|\blo\s+(?:reviso|chequeo|verifico|veo)\s+y\s+(?:te|le)\b`,
  // que lo va a tener
  String.raw`\b(?:apenas|ni\s+bien|en\s+cuanto)\s+(?:lo\s+|la\s+)?(?:tenga|sepa|tengamos|sepamos)\b|\b(?:apenas|ni\s+bien|en\s+cuanto)\s+me\s+(?:confirmen|digan|contesten|respondan|avisen)\b`,
  // que le pasa o le dice algo después («te paso el dato por acá», «te lo digo en un rato»).
  // «Te paso por acá los precios:» con la lista detrás no promete nada, y «te lo
  // mandamos después de las 14» es la entrega: «mandar» y «después» no cuentan
  String.raw`\b(?:te|le)\s+(?:lo\s+|la\s+|los\s+|las\s+)?(?:paso|pasamos|digo|decimos|cuento|contamos|escribo|escribimos|aviso|avisamos|confirmo|confirmamos)\b[^.?!\n:]{0,30}?(?:\bpor\s+ac[aá](?![a-záéíóúñ])|\bpor\s+este\s+(?:medio|chat)\b|\ben\s+un\s+rat\w*|\bm[aá]s\s+tarde\b|\ben\s+breve\b|\ba\s+la\s+brevedad\b)(?![^.?!\n]*:)`,
  String.raw`\b(?:te|le)\s+(?:aviso|avisamos)\s+(?:cuando|apenas|ni\s+bien|en\s+cuanto|si)\b`,
  // que avisa a un sector o que alguien lo va a ver
  String.raw`\b(?:doy|damos|di|dimos)\s+aviso\b|\b(?:aviso|avis[eé]|avisamos)\s+al?\s+(?:sector|local|equipo|[aá]rea|administraci[oó]n|compras|reparto)\b|\btomo\s+(?:tu|su|la)\s+consulta\b|\b(?:queda|qued[oó])\s+registrad[ao]\s+(?:la|tu|su)\s+consulta\b|\b(?:la|tu|su)\s+consulta\s+(?:queda|qued[oó])\s+registrad\w*`,
  String.raw`\b(?:lo|la|los|las)\s+revisan?\s+(?:alguien|una\s+persona|el\s+equipo|el\s+local|administraci[oó]n)\b|\balguien\s+de\s+la\s+casa\s+lo\s+(?:revisa|escucha|ve|mira)\b`,
  String.raw`\b(?:te|le)\s+(?:responde|responden|contesta|contestan|escribe|escriben|confirma|confirman)\b[^.?!\n]{0,30}?\bpor\s+(?:ac[aá](?![a-záéíóúñ])|este\s+(?:mismo\s+)?(?:chat|medio))|\b(?:te|le)\s+va(?:n)?\s+a\s+(?:responder|contestar|escribir|confirmar|avisar)\b`,
  // que no lo tiene o no lo sabe (NO_SABE, arriba)
  NO_SABE,
  // que está pendiente («Lo de la caja sigue pendiente», «Eso todavía no lo tengo»)
  String.raw`(?:\blo\s+del?\s+[^.?!\n,]{1,60}?|\beso|\bla\s+consulta|\bla\s+respuesta)\s+(?:todav[ií]a\s+)?(?:sigue|est[aá]|queda)\s+pendiente\b|(?:\blo\s+del?\s+[^.?!\n,]{1,60}?|\beso)\s+todav[ií]a\s+no\s+(?:lo\s+)?tengo\b|\btodav[ií]a\s+no\s+(?:tengo|me\s+(?:lleg[oó]|dieron|confirmaron|contestaron|respondieron|pasaron))\s+(?:la\s+|una\s+|el\s+)?(?:respuesta|novedad(?:es)?|confirmaci[oó]n|dato)\b`,
  // ---- 6/10/2026 (revisión): lo que se escapaba. Con charla() y sin consulta en
  // el turno salían tal cual, sin ningún WhatsApp a administración: «Te aviso.»,
  // «Mañana te digo.», «Te confirmo a la tarde.», «Te lo confirman en el local.»,
  // «No sé si vienen en caja.», «Aún no tengo novedades de la caja.», «Ya lo pasé
  // a administración.», «Lo están revisando.», «Desconozco ese dato.»…
  // que avisa, aunque no diga cuándo («Te aviso.», «Después te aviso.»); «Te aviso
  // que los domingos no hay reparto» es un dato y se queda
  String.raw`\b(?:te|le)\s+(?:lo\s+|la\s+)?(?:aviso|avisamos)\b(?=\s*(?:[.!…]|$))`,
  // que le dice, confirma o contesta más tarde («Mañana te digo.», «En breve te
  // respondo.», «Te confirmo a la tarde.»). Con dos puntos detrás es una lista
  // («Hoy te paso los precios:») y con «que» es un dato («Hoy te cuento que…»)
  String.raw`\b(?:ma[nñ]ana|despu[eé]s|luego|m[aá]s\s+tarde|a\s+la\s+tarde|hoy|en\s+un\s+rat\w*|en\s+breve|enseguida|en\s+el\s+d[ií]a)\s+(?:te|le)\s+(?:lo\s+|la\s+|los\s+|las\s+)?${VERBOS_DESPUES}\b(?!\s+que\b)(?![^.?!\n]*:)`,
  String.raw`\b(?:te|le)\s+(?:lo\s+|la\s+|los\s+|las\s+)?${VERBOS_DESPUES}\s+(?:ma[nñ]ana|m[aá]s\s+tarde|a\s+la\s+tarde|por\s+la\s+(?:tarde|ma[nñ]ana|noche)|en\s+el\s+d[ií]a|luego|despu[eé]s|hoy|en\s+un\s+rat\w*|en\s+breve|a\s+la\s+brevedad|enseguida|en\s+un\s+momento|cuando|apenas|ni\s+bien|en\s+cuanto)\b(?![^.?!\n]*:)`,
  // «Te confirmo lo de la caja.», «Te aviso lo del Catena.» (con dos puntos detrás
  // ya es la respuesta: «Te confirmo lo de la caja: sí, vienen en estuche.»)
  String.raw`\b(?:te|le)\s+(?:lo\s+|la\s+)?${VERBOS_DESPUES}\s+(?:lo\s+del?|sobre|respecto\s+(?:de|a))\b(?![^.?!\n]*:)`,
  String.raw`\b(?:vuelvo\s+a\s+escribir(?:te|le)?|(?:te|le)\s+vuelvo\s+a\s+escribir|(?:te|le)\s+(?:contacto|contactamos|contactan))\b`,
  String.raw`\bcuando\s+(?:lo\s+|la\s+)?(?:tenga|tengamos|sepa|sepamos)\b|\b(?:apenas|ni\s+bien|en\s+cuanto|cuando)\s+(?:me\s+|nos\s+|lo\s+|la\s+)?(?:confirmen|digan|contesten|respondan|avisen|pasen|verifiquen|revisen)\b`,
  // que se lo confirma otro («Eso te lo confirma administración», «Te lo van a confirmar en el local»)
  String.raw`\b(?:te|le|se)\s+(?:lo|la|los|las)\s+(?:van?\s+a\s+(?:confirmar|decir|avisar)|confirm(?:a|an))\b|\b(?:te|le)\s+(?:escriben|contestan|responden|avisan|confirman)\b`,
  // que lo pasó a alguien o que alguien lo está viendo («Ya lo pasé a
  // administración», «Lo están revisando», «en manos de administración»)
  String.raw`\b(?:lo|la|los|las|eso)\s+est[aá]n?\s+(?:viendo|revisando|chequeando|verificando|averiguando)\b|\ben\s+manos\s+de\s+(?:administraci[oó]n|el\s+local|compras|reparto|el\s+equipo|la\s+casa)\b|\badministraci[oó]n\s+ya\s+(?:lo|la|los|las)\s+tiene\b|\b(?:ya\s+)?(?:lo|la)\s+tiene\s+administraci[oó]n\b|\badministraci[oó]n\s+(?:ya\s+)?tiene\s+(?:tu|su|la)\s+(?:consulta|pregunta)\b`,
  // (también en presente, «Lo derivo a administración», «Te lo paso al equipo»: eran de la guarda de
  // promesas sin respaldo, que se sacó el 10/10/2026; «Lo paso a buscar» no cuenta)
  PASA_A_UN_AREA,
  // «Quedó anotada tu consulta», «quedó anotado para el equipo» (no «Por ahora quedan anotados:», la lista del pedido)
  String.raw`\b(?:qued[oó]|est[aá]|queda)\s+anotad[oa]\s+(?:tu|su|la)\s+consulta\b|\b(?:tu|su|la)\s+consulta\s+(?:qued[oó]|est[aá]|queda)\s+anotad\w*|\b(?:qued[oó]|queda|est[aá])\s+anotad[oa]\s+para\s+(?:el\s+equipo|administraci[oó]n|el\s+local|compras|reparto)\b`,
  // que pregunta o averigua («Le pregunto a administración y te digo», «Dejame averiguarlo»,
  // «Lo vemos con el local»). «Te pregunto: ¿es para retirar?» le habla al cliente
  String.raw`\b(?:le|les)\s+pregunto\s+(?:a|al)\s+|\b(?:lo\s+|la\s+)?pregunto\s+(?:a|al|en|con)\s+(?:administraci[oó]n|el\s+local|compras|reparto|el\s+equipo|la\s+casa)\b|\b(?:lo\s+|la\s+)?pregunto\s+y\s+(?:te|le)\b`,
  String.raw`\bd[eé]jame\s+(?:que\s+)?(?:lo\s+|la\s+)?(?:averigu|verific|cheque|confirm|consult|revis|pregunt|fij)\w*|\b(?:voy|vamos)\s+a\s+(?:averigu|pregunt|cheque)\w*|\b(?:voy|vamos)\s+a\s+(?:revis|verific)ar(?:lo|la|los|las)\b|\b(?:tengo|tenemos)\s+que\s+(?:averigu|verific|cheque|revis|pregunt|confirm)\w*|\b(?:lo|la)\s+(?:averiguamos|chequeamos|preguntamos)\b|\blo\s+(?:vemos|vamos\s+a\s+ver|veo|revisamos|chequeamos)\s+con\s+(?:el\s+local|administraci[oó]n|compras|reparto|el\s+equipo)\b`,
].join('|');
const RE_MENCION = new RegExp(MENCIONES, 'i');
// En un turno con consulta, además, los plazos y los avisos sueltos del modelo
// («en breve», «te aviso», «lo reviso»): ahí la consulta ya está hecha y nada de
// eso le sirve al cliente. «Te aviso que los domingos no hay reparto» es un dato
// y se queda también en ese turno (6/10/2026, revisión: se borraba y con él lo
// del domingo).
const RE_PROMESA = new RegExp(String.raw`${MENCIONES}|\ben\s+breve\b|\ben\s+un\s+momento\b|\blo\s+(?:veo|vemos)\s+con\b|\blo\s+(?:verifico|reviso|chequeo)\b|\bte\s+aviso\b(?!\s+que\b)`, 'i');
// lo que queda de una oración mixta tiene que sostenerse solo: "Sobre la caja,"
// o "Si entra el PerSe," sin la promesa no dicen nada ("y chips a $1.200" sí)
// ("y te digo" tampoco: es la cola de "Lo consultamos y te digo", 5/10/2026)
// («Por ser una cantidad grande,» tampoco: era el porqué de la consulta, 6/10/2026)
const RE_FRAGMENTO = /^(?:si|cuando|apenas|ni bien|en cuanto|mientras|sobre|respecto|con respecto|lo de|lo del|en lo de|por lo de|para lo de|por ser|ya que|porque|dado que|debido a|(?:y|e)\s+(?:ya\s+)?(?:te|le)\s+(?:digo|cuento|aviso|escribo|paso|mando|confirmo))\b/i;

/**
 * La oración sin la parte que promete o menciona la consulta. "Del PerSe no
 * tengo ahora, ya te confirmo por acá si entra." → "Del PerSe no tengo ahora.":
 * antes se borraba la oración entera y con ella el dato (5/10/2026).
 */
function sinFraseEnLaOracion(oracion: string, re: RegExp): string {
  if (!re.test(oracion)) return oracion;
  const o = oracion.trim();
  const fin = /([.!?…])\s*$/.exec(o)?.[1] ?? '';
  const cuerpo = o.replace(/[.!?…]+\s*$/, '');
  const trozos = cuerpo.split(/\s*[,;:]\s+|\s+[—–-]\s+|\s+(?=(?:y|e|pero)\s+(?:ya\s+)?(?:te|le|lo|la|los|las|vuelvo|en cuanto|apenas|ni bien)\b)/i)
    .map((t) => t.trim()).filter(Boolean);
  const quedan = trozos.filter((t) => !re.test(t) && !RE_FRAGMENTO.test(t));
  // la frase no se pudo separar (cruza los cortes): se saca la oración entera
  if (quedan.length === trozos.length) return '';
  const r = quedan.join(', ').trim();
  if (!r || r.split(/\s+/).length < 3) return '';
  return `${r}${r.includes('¿') ? '?' : fin === '?' || fin === '!' || !fin ? '.' : fin}`;
}

/** El texto sin esas frases, renglón por renglón (para no aplastar la lista del pedido en una sola línea). */
function sinFrases(texto: string | null | undefined, re: RegExp): string {
  return String(texto ?? '').split('\n').flatMap((linea) => {
    const queda = linea.split(/(?<=[.!?])\s+/).map((o) => sinFraseEnLaOracion(o, re)).filter((o) => o.trim()).join(' ').trimEnd();
    // el renglón que era solo la frase se va entero (no deja un hueco antes de «¿Lo confirmo?»)
    return linea.trim() && !queda ? [] : [queda];
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** La respuesta de un turno con consulta: sin promesas, plazos ni menciones de la consulta (lo útil queda). */
export function sinPromesas(respuesta: string | null | undefined): string {
  return sinFrases(respuesta, RE_PROMESA);
}

/**
 * La última limpieza de CUALQUIER respuesta del bot (6/10/2026): sin nada que
 * diga que consulta, que confirma después, que avisa, que no lo tiene o que está
 * pendiente. Reemplaza a sinLoConsulto (1/10/2026), que solo sacaba «lo consulto».
 */
export function sinMencionDeConsulta(respuesta: string | null | undefined): string {
  const t = String(respuesta ?? '');
  return RE_MENCION.test(t) ? sinFrases(t, RE_MENCION) : t;
}

/**
 * ¿El texto le dice al cliente algo de una consulta (que consulta, que confirma o
 * avisa después, que no lo sabe o que está pendiente)? Si lo escribió el modelo
 * sin llamar la herramienta, era algo que no sabía: la red de respaldo lo
 * consulta en silencio (6/10/2026; antes prometeConsultar, solo las promesas).
 */
export function mencionaConsulta(t: string | null | undefined): boolean {
  return RE_MENCION.test(String(t ?? ''));
}

/**
 * Lo mismo, sin contar el pase a un área («Lo paso a compras», «Te lo paso al equipo de
 * reparto»): con registrar_proveedor o nota_interna en el turno ese pase ya está hecho y no
 * es algo que el bot no sepa (lo eximía la guarda de promesas sin respaldo, 10/10/2026).
 * «No tengo ese dato.» o «Te confirmo por acá la hora.» siguen contando.
 */
export function mencionaConsultaSinElPase(t: string | null | undefined): boolean {
  return RE_MENCION.test(String(t ?? '').replace(new RegExp(PASA_A_UN_AREA, 'gi'), ' '));
}

const RE_NO_SABE = new RegExp(NO_SABE, 'i');
/**
 * ¿Dice que no sabe o no tiene un dato («No tengo ese dato.», «No sé si…»)? Es la
 * parte de mencionaConsulta que no es una promesa (6/10/2026, revisión). En un
 * turno con un pago en manos de administración, una promesa habla del pago (ya
 * avisado por adentro); esto es otra cosa que el bot no sabía: se consulta aparte.
 */
export function diceQueNoSabe(t: string | null | undefined): boolean {
  return RE_NO_SABE.test(String(t ?? ''));
}

// EL SALUDO SOLO NO CONTESTA NADA (6/10/2026, revisión). La versión anterior, en
// bot.service.ts, cambiaba «O.D.B.» por «ODB» comiéndose el punto que cierra el
// saludo y después se tragaba todo el renglón: «Buenas tardes, te damos la
// bienvenida a O.D.B. Te dejo los 3 Judas a tu nombre…» contaba como «solo
// saludo», se descartaba y al cliente no le llegaba nada. Ahora se saca el saludo
// (de la hora u «hola» con un nombre a lo sumo) y la bienvenida, y tiene que no
// quedar nada.
// sin la bandera i: el nombre («Hola Pablo») va con mayúscula y no se confunde con «Hola, te…»
const RE_SALUDO_DEL_ARRANQUE = /^\s*¡?(?:[Hh]ola|HOLA|[Bb]uen\s+d[ií]a|[Bb]uen[oa]s\s+d[ií]as|[Bb]uenas\s+tardes|[Bb]uenas\s+noches|[Bb]uenas)(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|,\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?=\s*[!.,]))?\s*[!.,]*\s*/;
const RE_BIENVENIDA = /^\s*(?:te\s+damos\s+la\s+)?bienvenid[oa]s?\s+a\s+O\.?\s?D\.?\s?B\.?\s*[!.,]*\s*/i;
export function esSoloSaludo(t: string | null | undefined): boolean {
  let r = String(t ?? '').trim();
  if (!r) return true;
  // «Hola, buen día.» son dos saludos seguidos
  r = r.replace(RE_SALUDO_DEL_ARRANQUE, '').replace(RE_SALUDO_DEL_ARRANQUE, '');
  r = r.replace(RE_BIENVENIDA, '');
  return !r.replace(/[\s.!,;:¡¿?]+/g, '');
}
/** ¿Arranca con un saludo («Hola Pablo!», «Buenas tardes,»)? Devuelve ese saludo y lo que sigue. */
export function saludoDelArranque(t: string | null | undefined): { saludo: string; resto: string } | null {
  const s = String(t ?? '').trim();
  const m = RE_SALUDO_DEL_ARRANQUE.exec(s);
  if (!m || !m[0].trim()) return null;
  return { saludo: m[0].trim(), resto: s.slice(m[0].length).trim() };
}

// El tema lo escribe el modelo y es de USO INTERNO desde el 6/10/2026: reconoce
// la misma consulta cuando vuelve con otras palabras y encabeza la respuesta del
// área («Sobre la caja para viajar: …»). Como eso sí le llega al cliente, lo
// interno no pasa (1/10/2026): si trae stock, unidades, la sucursal donde hay,
// el local, compras o la consulta misma, no sirve.
// 5/10/2026 (revisión): también los nombres de las sucursales ("las 2 botellas de
// Santa Inés"), lo disponible, cantidades de stock ("3 botellas") y la promesa
// metida en el tema ("la caja, te la confirmo").
const RE_TEMA_INTERNO = /\b(stock|unidad(?:es)?|sucursal(?:es)?|local|compras|sistema|dep[oó]sito|administraci[oó]n|reparto|consult\w*|cargad[oa]s?|figura\w*|quedan?|hay|disponib\w*|tenemos|tengo|confirm\w*|sa(?:i)?n(?:t)?h?\s*th?omas|santa\s+in[eé]s|castex)\b|\b\d+\s*(?:botellas?|unidades?|u\b|cajas?|packs?|latas?)/i;

/** El tema de una consulta, presentable ("la caja para viajar"), o '' si no sirve. */
export function temaDeConsulta(tema: string | null | undefined): string {
  // basura del esquema ("N/A", "ninguno", "</parameter>") o etiquetas
  const original = campoLimpio(tema);
  if (!original || /[<>]/.test(original)) return '';
  let t = sinCocinaInterna(original)
    .replace(/[«»"“”'‘’¿?¡!()[\]{}*_]/g, ' ')
    .replace(/[.,;:…]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // "lo de la caja" / "lo del PerSe" → "la caja" / "el PerSe"
  t = t.replace(/^lo\s+del\s+/i, 'el ').replace(/^lo\s+de\s+/i, '').replace(/^del\s+/i, 'el ');
  // sinCocinaInterna sube la primera letra: se respeta la del modelo
  if (t && /^[a-záéíóúñ]/.test(original)) t = t[0].toLowerCase() + t.slice(1);
  t = t.replace(/^(El|La|Los|Las|Un|Una|Unos|Unas)\b/, (a) => a.toLowerCase());
  const palabras = t.split(' ').filter(Boolean).length;
  if (!/[a-záéíóúñ0-9]/i.test(t) || palabras > 8 || t.length > 60 || RE_TEMA_INTERNO.test(t)) return '';
  return t;
}

/**
 * De qué se trata lo que prometió el modelo sin llamar la herramienta: «Lo de la
 * caja te lo confirmo por acá.» → "la caja"; «La caja te la confirmo por acá.»
 * → "la caja"; «Te confirmo por acá lo del Catena.» → "el Catena". Así la red
 * de respaldo reconoce una consulta ya abierta y, si es nueva, la registra con
 * su tema (5/10/2026, revisión). '' si no se puede saber.
 */
export function temaDeLaPromesa(respuesta: string | null | undefined): string {
  const oraciones = String(respuesta ?? '').split(/\n|(?<=[.!?])\s+/).filter((o) => mencionaConsulta(o));
  for (const o of oraciones) {
    const m = /\b(?:lo|eso)\s+de(l)?\s+([^,.;:!?¿]{2,60}?)\s+(?:te|le|se)\s+(?:(?:lo|la|los|las)\s+)?confirm/i.exec(o)
      ?? /\bconfirm\w*\s+(?:por\s+ac[aá]\s+)?(?:lo|eso)\s+de(l)?\s+([^,.;:!?¿]{2,60})/i.exec(o)
      ?? /\b(?:lo|eso)\s+de(l)?\s+([^,.;:!?¿]{2,60}?)\s+(?:todav[ií]a|sigue|est[aá]|queda)\b/i.exec(o);
    const n = m ? null : /^(?:y\s+)?((?:el|la|los|las)\s+[^,.;:!?¿]{2,50}?)\s+(?:te|le|se)\s+(?:lo|la|los|las)\s+confirm/i.exec(o.trim())
      ?? /\b(?:sobre|respecto\s+(?:de|a))\s+((?:el|la|los|las)\s+[^,.;:!?¿]{2,50}?)\s*,/i.exec(o);
    const crudo = m ? `${m[1] ? 'el ' : ''}${m[2]}` : n?.[1] ?? '';
    const tema = temaDeConsulta(crudo);
    if (tema) return tema;
  }
  return '';
}

// LA MISMA CONSULTA NO SE HACE DOS VECES (5/10/2026). Pablo preguntó por la caja
// a las 16:02 y, en un audio de las 16:17, de nuevo con otras palabras: salieron
// dos WhatsApp a administración. En 14 días, 38 de 97 consultas repetían una
// anterior todavía abierta del mismo teléfono. Son "la misma" si tienen el mismo
// tema, o si comparten las palabras que importan (sin las de todos los días:
// cliente, tenemos, para, pide…).
//
// SIN JUNTAR DE MÁS (5/10/2026, revisión). Pasada por las 152 consultas reales,
// la primera versión juntaba el «precio por caja del Piatelli» con el Fernet
// abierto, o «¿llegamos a El Carmen?» con «¿llegamos a Ruta 52?», y lo sumado no
// le llegaba a nadie. Ahora: dos temas distintos son dos cosas; un tema genérico
// («el envío») no alcanza para juntar; y la cuenta se hace sobre las palabras de
// la consulta NUEVA (lo que ya está en la abierta), así un producto, una
// dirección o un día nuevos cortan la coincidencia. Además se compara la raíz
// («viajar» y «viaja» son lo mismo). El área la mira bot.service.ts.
const PALABRAS_COMUNES = new Set(('cliente clienta clientes senor senora tenemos tienen tiene tenes tener para pide pidio pregunta preguntan quiere queria consulta consulto ' +
  'sucursal pedido pedidos stock precio precios retira retirar retiro manana saber puede pueden podemos puedo podes botella botellas unidad unidades cuantas cuantos cuanto ' +
  'entra entran llega llegan favor gracias ahora tambien esta estan este esto esos esas como cual cuales donde cuando tipo algo alguna alguno algun otro otra otros otras ' +
  'sobre desde hasta entre porque pero solo mismo misma igual dato datos local compras reparto administracion viene vienen trae traen hacer llevar lleva llevan darle dame ' +
  'necesita necesito busca buscar rato hola buenas quiero queremos seria serian habria hace hacen ' +
  // 5/10/2026: lo genérico de cada área y de los adjuntos ("¿llegamos…?", "el envío", "revisar la foto")
  'llegamos llegar envio envios enviar entrega entregar entregan mandar manda mandan pago pagar pagos horario horarios revisar revisa foto fotos mando adjunto archivo enviado envia video imagen ' +
  'consultar verificar confirmar confirma').split(/\s+/));

// la raíz alcanza para juntar "viajar" con "viaja" y "cajas" con "caja"
const raiz = (w: string) => w.replace(/s$/, '').slice(0, 5);

function palabrasQueImportan(texto: string, nombre?: string | null): Set<string> {
  const sinNombre = String(texto ?? '')
    // "Cliente Pablo pregunta…": el nombre del cliente está en todas sus consultas
    .replace(/\b(?:[Cc]liente|[Cc]lienta|[Ss]eñor|[Ss]eñora|[Ss]ra?\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/g, ' ');
  const delCliente = new Set(String(nombre ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean));
  return new Set(sinNombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 3 && !PALABRAS_COMUNES.has(w) && !delCliente.has(w)).map(raiz));
}
const sinArticulo = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(el|la|los|las|un|una|unos|unas)\s+/, '').trim();
const temaNormal = (t: string | null | undefined) => sinArticulo(temaDeConsulta(t));
const contiene = (a: string, b: string) => ` ${a} `.includes(` ${b} `);

// un tema solo cuenta si dice algo propio: "el envío" o "el pago" son de todos
const temaPropio = (t: string) => !!t && palabrasQueImportan(t).size > 0;

/**
 * ¿Los dos temas nombran lo mismo? Iguales, o uno dentro del otro ("la caja" /
 * "la caja para viajar"), y con algo propio. El modelo ve las abiertas en el
 * estado de la charla y, si el cliente suma un dato, la nombra igual.
 */
export function mismoTema(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = temaNormal(a), tb = temaNormal(b);
  return temaPropio(ta) && temaPropio(tb) && (ta === tb || contiene(ta, tb) || contiene(tb, ta));
}

/** ¿La consulta nueva es la misma que una abierta (del mismo teléfono y la misma área)? */
export function mismaConsulta(nueva: { consulta: string; tema?: string | null }, abierta: { consulta?: string | null; tema?: string | null }, nombre?: string | null): boolean {
  const ta = temaNormal(nueva.tema), tb = temaNormal(abierta.tema);
  // dos temas propios: si son el mismo, es la misma consulta; si no, dos cosas
  // («el Catena en magnum» no es «la caja para viajar»)
  if (temaPropio(ta) && temaPropio(tb)) return mismoTema(ta, tb);
  const N = palabrasQueImportan(`${nueva.tema ?? ''} ${nueva.consulta}`, nombre);
  const A = palabrasQueImportan(`${abierta.tema ?? ''} ${abierta.consulta ?? ''}`, nombre);
  if (!N.size || !A.size) return false;
  let comunes = 0;
  for (const w of N) if (A.has(w)) comunes++;
  // casi todo lo que pregunta la nueva ya está en la abierta (y al menos dos
  // palabras: "Raquis" solo no junta un "¿hay otro Raquis?" con otra pregunta)
  return comunes >= 2 && comunes / N.size >= 0.6;
}

/** Las palabras que trae la consulta nueva y la abierta no tenía: si hay, es un dato nuevo para el área. */
export function datoNuevo(nueva: string, abierta: string, nombre?: string | null): string[] {
  const A = palabrasQueImportan(abierta, nombre);
  return [...palabrasQueImportan(nueva, nombre)].filter((w) => !A.has(w));
}

/**
 * La red de respaldo (el modelo prometió, mencionó la consulta o puso un importe
 * sin llamar la herramienta): ¿es por algo que ya está consultado? (5/10/2026,
 * revisión: «¿Y lo de la caja?» abría otra consulta y otro WhatsApp). Sí si lo
 * prometido nombra una abierta, o si el cliente no trae nada que no esté ya en
 * una abierta. Un archivo nuevo siempre es nuevo.
 */
export function consultaAbiertaQueNombra<T extends { consulta?: string | null; tema?: string | null }>(
  p: { temaPrometido?: string | null; textoCliente?: string | null; conArchivo?: boolean; prometio?: boolean; nombre?: string | null },
  abiertas: T[],
): T | null {
  if (!abiertas.length) return null;
  const tema = temaNormal(p.temaPrometido);
  if (tema) {
    const T_ = palabrasQueImportan(tema, p.nombre);
    const porTema = abiertas.find((a) => {
      const tb = temaNormal(a.tema);
      if (tb && (tb === tema || contiene(tb, tema) || contiene(tema, tb))) return true;
      const A = palabrasQueImportan(`${a.tema ?? ''} ${a.consulta ?? ''}`, p.nombre);
      return T_.size > 0 && [...T_].every((w) => A.has(w));
    });
    if (porTema) return porTema;
  }
  if (p.conArchivo) return null;
  const C = palabrasQueImportan(String(p.textoCliente ?? ''), p.nombre);
  // el cliente no trajo nada propio («¿Y?», «dale») y el modelo prometió sin decir
  // qué: es la última abierta. Un importe sin fuente sin promesa no alcanza.
  if (!C.size) return !tema && p.prometio ? abiertas[0] : null;
  return abiertas.find((a) => {
    const A = palabrasQueImportan(`${a.tema ?? ''} ${a.consulta ?? ''}`, p.nombre);
    return [...C].every((w) => A.has(w));
  }) ?? null;
}

/**
 * Sumarle un dato a una consulta abierta sin pasarse del tope de la base. Si no
 * entra, se conserva el principio (la pregunta original) y las sumas MÁS NUEVAS:
 * antes se cortaba el final y lo último que dijo el cliente se perdía sin aviso
 * (5/10/2026, revisión).
 */
export function juntarConsulta(previa: string, nueva: string, tope = 2000): string {
  const todo = `${previa}\n+ ${nueva}`;
  if (todo.length <= tope) return todo;
  const [original, ...sumas] = todo.split('\n+ ');
  const cabeza = original.slice(0, Math.floor(tope * 0.4)).trimEnd();
  const ultima = `\n+ ${String(sumas.pop() ?? '').slice(0, tope - cabeza.length - 6)}`;
  const cola: string[] = [];
  let largo = cabeza.length + 4 + ultima.length;
  for (let i = sumas.length - 1; i >= 0; i--) {
    const s = `\n+ ${sumas[i]}`;
    if (largo + s.length > tope) break;
    cola.unshift(s);
    largo += s.length;
  }
  return `${cabeza}${cola.length < sumas.length ? '\n+ …' : ''}${cola.join('')}${ultima}`;
}

// palabras con que suele arrancar una respuesta del área y que, detrás de «Sobre X:», van en minúscula
const ARRANQUE_COMUN = /^(?:s[ií]|no|tenemos|tengo|hay|entra|entran|llega|llegan|llegamos|viene|vienen|sale|salen|es|son|est[aá]|est[aá]n|ya|todav[ií]a|reci[eé]n|ma[nñ]ana|hoy|solo|s[oó]lo|claro|queda|quedan|va|van|se|lo|la|los|las|el|por|para|con|en|de|a|podemos|puede|pueden|te|le|les|nos|tambi[eé]n)$/i;

/**
 * LA RESPUESTA DEL ÁREA ES LA RESPUESTA FINAL (6/10/2026). Al cliente no se le
 * avisó que se consultaba, así que lo que contesta administración tiene que
 * entenderse solo: si no nombra de qué se trata, va encabezado por el tema
 * («Sobre la caja para viajar: sí, vienen en estuche individual.»). Sin tema
 * (consultas de antes de la columna) o si ya lo nombra, va tal cual: lo escribió
 * una persona de la casa y no se le toca nada.
 */
export function respuestaDelAreaParaCliente(tema: string | null | undefined, respuesta: string | null | undefined): string {
  const t = String(respuesta ?? '').trim();
  const tm = temaDeConsulta(tema);
  if (!t || !tm) return t;
  // «Hola Pablo! Te confirmo que sí…»: el encabezado va DESPUÉS del saludo de la
  // persona del área, no delante (6/10/2026, revisión: salía «Sobre la caja para
  // viajar: Hola Pablo! …»)
  const s = saludoDelArranque(t);
  if (s && !s.resto) return t;
  const texto = s ? s.resto : t;
  const delTema = palabrasQueImportan(tm);
  const nombraElTema = delTema.size
    ? [...delTema].some((w) => palabrasQueImportan(texto).has(w))
    : contiene(sinArticulo(texto).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' '), sinArticulo(tm));
  if (nombraElTema) return t;
  const primera = /^[^\s,.:;]+/.exec(texto)?.[0] ?? '';
  const cuerpo = ARRANQUE_COMUN.test(primera) ? texto[0].toLowerCase() + texto.slice(1) : texto;
  const conTema = `Sobre ${tm}: ${cuerpo}`;
  return s ? `${s.saludo.replace(/,$/, '.')} ${conTema}` : conTema;
}

/**
 * Mete un texto (los datos de pago, por ejemplo) UNA vez y antes de las preguntas
 * con que termina el mensaje («¿Lo confirmo?», «¿A nombre de quién lo retiran?»),
 * que siguen siendo lo último; sin preguntas al final, abajo de todo. Ya no lleva
 * ningún aviso de consulta (6/10/2026): queda porque main la usa para los datos de
 * pago de la confirmación (pago-confirma.ts, confirmacionConDatosDePago) y, sin
 * ella, la unión con main no compilaba (revisión del 6/10/2026).
 */
export function conAviso(texto: string, aviso: string): string {
  const t = String(texto ?? '').trim();
  if (!aviso) return t;
  if (!t) return aviso;
  if (!/\?\s*$/.test(t)) return `${t}\n\n${aviso}`;
  const desde = inicioDeLasPreguntasFinales(t);
  const antes = t.slice(0, desde).trimEnd();
  const preguntas = t.slice(desde).trim();
  if (!antes) return `${aviso}\n\n${preguntas}`;
  return /\n\s*$/.test(t.slice(0, desde)) ? `${antes}\n\n${aviso}\n\n${preguntas}` : `${antes} ${aviso} ${preguntas}`;
}

/** Dónde arranca la tanda de preguntas seguidas con que termina el texto (oraciones o renglones que cierran en «?»). */
function inicioDeLasPreguntasFinales(t: string): number {
  const oraciones: { desde: number; texto: string }[] = [];
  let inicio = 0;
  for (let k = 0; k <= t.length; k++) {
    const c = t[k] ?? '';
    const finDeRenglon = k === t.length || c === '\n';
    // ". " o "? " cierra la oración; "$4.700" o "..." en el medio, no
    const finDeOracion = /[.!?…]/.test(c) && (k + 1 >= t.length || /\s/.test(t[k + 1]));
    if (!finDeRenglon && !finDeOracion) continue;
    const fin = finDeRenglon ? k : k + 1;
    const trozo = t.slice(inicio, fin);
    if (trozo.trim()) oraciones.push({ desde: inicio + (trozo.length - trozo.trimStart().length), texto: trozo.trim() });
    inicio = k + 1;
  }
  let i = oraciones.length;
  while (i > 0 && /\?\s*$/.test(oraciones[i - 1].texto)) i--;
  // "Tengo el Judas, ¿te lo reservo?" es una sola oración: la pregunta es toda
  return i < oraciones.length ? oraciones[i].desde : t.length;
}

// Frases que Whisper inventa ante un audio mudo o con ruido (créditos de
// subtítulos de videos). Si la transcripción es solo eso, no hay texto real.
const RE_ALUCINACION = /^\s*(subt[ií]tulos (realizados|hechos) por la comunidad de amara\.org|subt[ií]tulos por la comunidad de amara\.org|gracias por ver( el video)?|suscr[ií]bete( al canal)?|¡?gracias por su atenci[oó]n!?|m[uú]sica|\[m[uú]sica\]|\.+)\s*[.!]*\s*$/i;
export function esAlucinacionDeTranscripcion(t: string): boolean {
  return RE_ALUCINACION.test(String(t ?? ''));
}

// LO INTERNO QUEDA PUERTAS ADENTRO (Leandro, 1/10/2026): al cliente no se le
// dice cuántas unidades hay, en qué sucursal hay stock ni "lo que figura en el
// sistema". El bot lo escribía igual ("en la sucursal Saint Thomas hay:",
// "queda 1 botella", "quedan 2", "sin stock en Saint Thomas"): acá se borra.
// Lo que es de la entrega ("Retiro en la sucursal Saint Thomas") no se toca.
export function sinCocinaInterna(t: string): string {
  if (!t) return t;
  let r = t
    // "(quedan 2)", "(queda 1 botella)", "(hay 7)"
    .replace(/\s*\((?:quedan?|hay|tengo) \d+(?: (?:botellas?|unidades?|u\.?))?\)/gi, '')
    // ": queda 1 botella", ", quedan 2", ": quedan 7 unidades"
    .replace(/[:,]?\s*quedan? (?:solo |sólo )?\d+(?: (?:botellas?|unidades?))?(?=[\s.,;)]|$)/gi, '')
    // ", con 7 unidades en la sucursal Saint Thomas" / "con 7 unidades"
    .replace(/,?\s*con \d+ unidades?(?: disponibles?)?(?: en (?:la )?(?:sucursal|suc\.?) [A-ZÁÉÍÓÚ][\wáéíóúñ]*(?: [A-ZÁÉÍÓÚ][\wáéíóúñ]*)*)?/gi, '')
    // "en la sucursal Saint Thomas hay:" → "hay:" / "sin stock en Saint Thomas" → "sin stock"
    .replace(/,?\s*en (?:la )?(?:sucursal |suc\.? )?Saint Thomas(?=,? (?:hay|tengo|tenemos|queda)\b)/gi, '')
    .replace(/(sin stock|no (?:hay|tengo|tenemos) stock)(?: ahora)? en (?:la )?(?:sucursal |suc\.? )?(?:Saint Thomas|Santa In[eé]s)(?:, que es de donde salen los env[ií]os)?/gi, '$1')
    // "En el sistema lo tengo cargado: X" / "me figuran sin stock en sistema"
    .replace(/\ben (?:el )?sistema (?:lo |la |los |las )?(?:tengo|tenemos|est[aá]n?|figuran?) (?:cargad[oa]s?)?:?\s*/gi, '')
    .replace(/\bme figuran? /gi, 'están ')
    .replace(/ en (?:el )?sistema\b/gi, '');
  return r.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:])/g, '$1').replace(/^(\s*)([a-záéíóúñ])/gm, (m, a, b) => a + b.toUpperCase()).trim();
}

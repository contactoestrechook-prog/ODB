// ============================================================
// EL DATO QUE FALTABA CONFIRMA EL PEDIDO (9/10/2026). Leandro, con la charla
// en la mano: el bot mostró la lista con el total y preguntó «¿A nombre de
// quién lo preparo?»; contestó «A nombre de leandro» y el bot le mandó la lista
// otra vez con «¿Lo confirmo?». «Te dijo que sí, a nombre de Leandro: ¿para qué
// me vuelve a preguntar si lo confirmo?».
//
// Regla: si el cliente YA VIO la lista con precios y el total, y lo único que
// le faltaba era el nombre de quien retira o recibe (o la dirección), su
// respuesta con ese dato confirma el pedido en ese mismo turno.
//
// Antecedente: el 3/10 se probó «el nada más confirma» y quedó apagado porque
// creaba pedidos que el cliente no quiso («Si» + «y 2 hielos», «Cancelalo»
// tomado como nombre). Por eso acá es ESTRICTO, y todo lo que no cumple vuelve
// al camino de siempre (el resumen con «¿Lo confirmo?»):
//   - el último mensaje del bot pidió SOLO ese dato (una sola pregunta, sin
//     «¿Lo confirmo?» y sin «¿retirás o te lo enviamos?»);
//   - en sus últimos mensajes el cliente vio el MISMO total y cada renglón
//     (cantidad × precio = subtotal) de la cotización que se va a confirmar;
//   - el mensaje del cliente es solo el dato: sin pregunta, sin cambios, sin
//     negativas ni esperas, sin otro producto, corto;
//   - el dato es el que quedó en la cotización (el nombre o la dirección).
// Los frenos que necesitan la base (archivo en el turno, comprobante abierto,
// pedido confirmado hace poco) van en bot.service.ts, y la base vuelve a
// controlar todo en confirmar_cotizacion_bot (modo 'dato').
// ============================================================

import { nombreLimpio } from './prolijo';
import { confirmacionInequivoca, pesos } from './comercio';
import { cambiaElPedido } from './pago-confirma';

const norm = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Palabras que no son parte de un nombre: si aparece una, no se anota nada (7580219, 3/10/2026). */
const NO_ES_NOMBRE = new Set(('a al la el los las lo le con de del en por para mi mis tu su nombre mismo misma mismos yo vos ' +
  'pago pagar pagamos tarjeta efectivo transferencia debito credito mercadopago alias ' +
  'manana tarde noche mediodia hoy ahora luego ya despues antes temprano hora horas ' +
  'lunes martes miercoles jueves viernes sabado domingo semana dia ' +
  'castex sucursal local canning retiro retira retirar retiramos busca buscar paso envio enviar casa ' +
  // (palabras sueltas: juntas se leen como una frase y el barrido de consulta-silenciosa.spec las toma por un texto al cliente)
  ['todavia', 'no', 'se', 'si', 'ok', 'dale', 'gracias', 'listo', 'perfecto', 'bueno', 'que', 'cuando', 'como', 'donde', 'cual'].join(' ') + ' ' +
  'hijo hija esposa esposo marido mujer mama papa hermano hermana amigo amiga ' +
  // 9/10/2026: lo que NO es un nombre aunque sean letras sueltas
  'cancelalo cancela cancelar cancelo anulalo anula espera esperame mas tambien otro otra hielo hielos sumame agregame sacame cambialo ' +
  // revisión del 9/10/2026: lo que convertía «Juan te aviso» o «Juan y una coca» en un nombre
  'y e sin menos quiero queres dejalo deja dejame olvidate olvida nah nop ni ninguno nadie tampoco chau frena aguarda aviso digo veo ver hay tenes tienen cuanto una uno dos tres coca te').split(' ').map(norm));

/**
 * El nombre en la respuesta a «¿A nombre de quién lo preparo?»: «Juan Pérez»,
 * «a nombre de Ana», «lo retira Carlos», «soy Marta». null si no es claramente
 * un nombre y nada más.
 */
export function nombreDeQuienRetira(texto: string): string | null {
  let t = String(texto ?? '').trim().replace(/[.!¡]+$/g, '').replace(/^(hola|buenas|dale|ok|listo|si|sí)[\s,]+/i, '');
  t = t.replace(/^(a nombre de|lo (?:retira|retiro|retiramos|busca|paso a buscar)|la retira|lo va a retirar|va a retirar|retira|soy|me llamo|mi nombre es|es|para)\s+/i, '');
  if (!t || /[\d?@/:,;\n]/.test(t)) return null;
  const n = nombreLimpio(t);
  if (!n) return null;
  const palabras = n.split(/\s+/);
  if (palabras.length > 4) return null;
  if (palabras.some((w) => !/^\p{L}[\p{L}'’-]*$/u.test(w) || NO_ES_NOMBRE.has(norm(w)))) return null;
  return palabras.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// el bot pidió el dato: nombre de quien retira o recibe, o la dirección
const RE_PIDE_DATO = /¿[^?]*\b(?:a nombre de qui[eé]n|qui[eé]n (?:lo )?(?:retira|recibe|pasa a buscar)|tu nombre|direcci[oó]n|calle y n[uú]mero)\b[^?]*\?/i;
const RE_LO_CONFIRMO = /¿\s*lo confirmo\s*\?/i;
// «¿Lo retirás o te lo enviamos?»: una pregunta con las DOS opciones (pedir la dirección del envío no es esto)
const RE_RETIRO_O_ENVIO = /¿[^?]*\bretir\w*[^?]*\bo\b[^?]*\b(?:env[ií]\w*|mand\w*|llev\w*)[^?]*\?|¿[^?]*\b(?:env[ií]\w*|mand\w*|llev\w*)[^?]*\bo\b[^?]*\b(?:retir\w*|pas\w* a buscar)[^?]*\?/i;
// lo que delata que el mensaje NO es solo el dato
const RE_NO_ES_SOLO_EL_DATO = /\?|\b(no|pero|tambi[eé]n|sum[aá]\w*|agreg\w*|cambi\w*|sac[aá]\w*|quit\w*|mejor|otr[oa]s?|despu[eé]s|todav[ií]a|esper\w*|cancel\w*|anul\w*|m[aá]s|hielo\w*|y|sin|menos|quiero|quer[eé]s|dej\w*|olvid\w*|nah|nop|ni|tampoco|pienso|veo|si|ma[nñ]ana|te (?:aviso|confirmo|digo)|y\s+\d|\d+\s*(?:x|×|unidades?|botellas?|packs?|cajas?))\b/i;
// solo letras, números y la puntuación de un nombre o una dirección (nada de emojis ni símbolos)
const RE_SOLO_TEXTO = /^[\p{L}\p{N}\s.,'’°º#-]+$/u;
// las palabras que cuentan de un nombre de producto: sin medidas, números ni conectores
const MEDIDAS = new Set('x de del la el los las con sin y en cc ml l lt lts litro litros kg kgs g gr grs gramos un unid unidades u pack packs caja cajas botella botellas lata latas'.split(' '));
const palabrasDeProducto = (t: string) => new Set(norm(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !/\d/.test(w) && !MEDIDAS.has(w)));
const mismas = (a: Set<string>, b: Set<string>) => a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));

export type CotizacionPreparada = {
  total: number;
  renglones: { renglon?: string; nombre?: string }[];
  tipo?: string; // 'pickup' | 'domicilio'
  nombre?: string | null;
  direccion?: string | null;
  avisoFecha?: unknown;
  hayFaltantes?: boolean;
};

/** ¿El dato del cliente cierra el pedido? `motivo` dice por qué no (va al log). */
export function cierraConElDato(p: {
  textoCliente: string;
  ultimoBot: string;
  ultimosBot: string[];
  cotizacion: CotizacionPreparada;
}): { ok: boolean; motivo: string } {
  const no = (motivo: string) => ({ ok: false, motivo });
  const texto = String(p.textoCliente ?? '').trim();
  const ultimo = String(p.ultimoBot ?? '');
  const q = p.cotizacion;
  if (!q || !(Number(q.total) > 0) || !(q.renglones ?? []).length) return no('sin cotización');
  if (q.avisoFecha) return no('la fecha pedida no se pudo tomar');
  if (q.hayFaltantes) return no('hay renglones sin stock');

  // 1) el bot pidió SOLO el dato
  if (!RE_PIDE_DATO.test(ultimo)) return no('el último mensaje del bot no pidió el nombre ni la dirección');
  if ((ultimo.match(/\?/g) ?? []).length !== 1) return no('el último mensaje del bot hizo más de una pregunta');
  if (RE_LO_CONFIRMO.test(ultimo)) return no('el último mensaje ya pedía «¿Lo confirmo?»: va el camino del sí');
  if (RE_RETIRO_O_ENVIO.test(ultimo)) return no('el bot también preguntó retiro o envío');

  // 2) el cliente vio la MISMA lista con el MISMO total
  const totalTxt = `$${pesos(Number(q.total))}`;
  const renglones = q.renglones.map((r) => String(r.renglon ?? '').trim()).filter(Boolean);
  if (renglones.length !== q.renglones.length) return no('renglones sin formato');
  // la ÚLTIMA lista con «Total» que le mostró el bot (no una vieja de antes de un cambio)
  const vista = String([p.ultimoBot, ...(p.ultimosBot ?? [])].find((m) => /\btotal\b[^\n$]{0,25}\$\s?\d/i.test(String(m ?? ''))) ?? '');
  if (!vista) return no('el cliente no vio una lista con total');
  if (!new RegExp(`\\btotal\\b[^\\n$]{0,25}${totalTxt.replace(/[$.]/g, (c) => `\\${c}`)}(?!\\d)`, 'i').test(vista)) return no('el total no es el que vio el cliente');
  const lineasVistas = vista.split('\n').map((l) => l.trim()).filter((l) => /^[•·*-]\s/.test(l));
  if (lineasVistas.length !== q.renglones.length) return no('la lista que vio tiene otra cantidad de renglones');
  for (const r of q.renglones) {
    // cada renglón: la misma cuenta Y el mismo producto (una Coca común no es la Zero aunque cueste lo mismo)
    const linea = lineasVistas.find((l) => l.includes(String(r.renglon)) && mismas(palabrasDeProducto(l.replace(/^[•·*-]\s*/, '').split(/\s+[—–-]\s+/)[0]), palabrasDeProducto(String(r.nombre ?? ''))));
    if (!linea) return no(`el renglón «${r.nombre}» no es el que vio el cliente`);
  }

  // 3) y 4) el mensaje es SOLO el dato, y es el que quedó en la cotización
  return soloElDato(texto, q);
}

/** ¿El texto trae este monto («$128.200», sin más dígitos pegados)? */
export function contieneMonto(texto: string, total: number): boolean {
  if (!(Number(total) > 0)) return false;
  const m = pesos(Number(total)).replace(/\./g, '\\.');
  return new RegExp(`\\$\\s?${m}(?![\\d.,]\\d)`).test(String(texto ?? ''));
}

/**
 * ¿El mensaje es SOLO el nombre de quien retira (o la dirección del envío) que
 * ya tiene la cotización, y nada más? Sirve para el dato que faltaba y para
 * contestar «A nombre de Leandro» a un «¿Lo confirmo?» (9/10/2026).
 */
/** La forma de un dato suelto: corto, una línea, sin emojis, sin dudas, esperas ni cambios. */
export function pareceSoloElDato(textoCliente: string): { ok: boolean; motivo: string } {
  const no = (motivo: string) => ({ ok: false, motivo });
  const texto = String(textoCliente ?? '').trim();
  if (!texto) return no('el mensaje está vacío');
  if (texto.length > 80 || texto.includes('\n')) return no('el mensaje es largo o tiene varias líneas');
  if (!RE_SOLO_TEXTO.test(texto)) return no('el mensaje trae emojis o símbolos');
  if (RE_NO_ES_SOLO_EL_DATO.test(sinElSiDe(texto))) return no('el mensaje trae algo más que el dato');
  return { ok: true, motivo: '' };
}
// un «Sí,» / «Dale,» adelante es parte de la respuesta («Sí, a nombre de Leandro»); un «si» en el medio no
const sinElSiDe = (texto: string) => norm(texto).replace(/^(?:hola|buenas|dale|ok|listo|si)[\s,.!]+/, '');

export function soloElDato(textoCliente: string, q: { tipo?: string; nombre?: string | null; direccion?: string | null }): { ok: boolean; motivo: string } {
  const no = (motivo: string) => ({ ok: false, motivo });
  const texto = String(textoCliente ?? '').trim();
  const forma = pareceSoloElDato(texto);
  if (!forma.ok) return forma;
  const sinElSi = sinElSiDe(texto);

  // el dato es el que quedó en la cotización
  const palabras = (t: string) => norm(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (q.tipo === 'domicilio') {
    // la dirección entera (todos sus números) y NADA más que la dirección y quien recibe
    const dir = palabras(String(q.direccion ?? ''));
    if (!dir.some((w) => /\d/.test(w))) return no('la cotización no tiene una dirección con número');
    const enTexto = palabras(sinElSi);
    if (!dir.filter((w) => /\d/.test(w)).every((w) => enTexto.includes(w))) return no('la dirección del mensaje no es la de la cotización');
    const permitidas = new Set([...dir, ...palabras(String(q.nombre ?? '')), 'recibe', 'a', 'al', 'en', 'calle', 'av', 'avenida', 'nro', 'n', 'numero', 'piso', 'depto', 'dto', 'lote', 'barrio', 'casa']);
    const sobra = enTexto.filter((w) => !permitidas.has(w));
    if (sobra.length) return no(`el mensaje trae algo más que la dirección (${sobra.slice(0, 3).join(' ')})`);
    return { ok: true, motivo: 'dio la dirección' };
  }
  const nombre = nombreDeQuienRetira(texto);
  if (!nombre) return no('el mensaje no es un nombre');
  // el nombre ENTERO es el de la cotización («Juan Te Aviso» no es «Juan»)
  const delPedido = new Set(palabras(String(q.nombre ?? '')));
  if (!delPedido.size || !palabras(nombre).every((w) => delPedido.has(w))) return no('el nombre no es el de la cotización');
  return { ok: true, motivo: `dio el nombre (${nombre})` };
}
// ============================================================
// EL CLIENTE ACEPTÓ EL RESUMEN QUE VIO (9/10/2026, noche). Una sola regla para el
// atajo sin modelo, la herramienta crear_pedido y crearPedido. Leandro: «te ha
// dicho que sí, a nombre de Leandro… ¿para qué me vuelve a preguntar?». La
// revisión del 9/10 mostró los «sí» que el bot no entendía («Sii», «👍»,
// «Hola, sí», «Perfecto», «Sí, para retirar») y los que no son un sí («Hola,
// soy Leandro», «Sí, sumale una coca»).
// ============================================================

// «para retirar» repite lo que el resumen ya dice: «Sí, para retirar en la sucursal»
const RE_COLA_RETIRO = /[\s,]+(?:es\s+)?para\s+(?:retirar|retiro|pasar\s+a\s+buscar)(?:\s+(?:en\s+)?(?:la\s+)?(?:sucursal|el\s+local)(?:\s+saint\s+thomas)?)?[\s.!]*$/;

/**
 * El «sí» llevado a su forma de siempre: «¡Sí!» → «si!», «Hola, sí» → «si»,
 * «Sii»/«Sisi»/«Sip» → «si», «Okey» → «ok», «Confirmado» → «confirmo», y un
 * pulgar o «joya/genial/bárbaro/de una/buenísimo/bueno/perfecto» solos → «dale».
 * Lo demás queda como estaba (sin tildes y en minúsculas).
 */
export function normalizarSi(texto: string, tipo?: string): string {
  let t = norm(String(texto ?? '')).trim();
  if (/^[\s👍👌🏻🏼🏽🏾🏿]+$/u.test(t) && /[👍👌]/u.test(t)) return 'dale';
  t = t.replace(/^[¡!\s]+/, '');
  t = t.replace(/^(?:hola+|buenas|eh+|ah+|mm+)[\s,.!]+(?=\S)/, '');
  if (/^(?:joya|genial|barbaro|de una|buenisimo|bueno|perfecto)(?:[\s,.!]+(?:gracias+|muchas gracias|mil gracias))?[\s!.]*$/.test(t)) return 'dale';
  t = t.replace(/^bueno[\s,.!]+(?=\S)/, '');
  t = t.replace(/^s+i+(?:\s?s+i+)*p?(?=$|[\s,.!])/, 'si');
  t = t.replace(/^(?:okey|oka|okis|ok+)(?=$|[\s,.!])/, 'ok');
  t = t.replace(/^confirmado(?=$|[\s,.!])/, 'confirmo');
  if (tipo !== 'domicilio') t = t.replace(RE_COLA_RETIRO, '');
  return t.trim();
}

/** ¿El «sí» trae algo más? («Sí, sumale una coca», «Si y 2 hielos», «Si, también un fernet») */
export function siConAgregado(texto: string): boolean {
  const t = norm(String(texto ?? ''));
  return cambiaElPedido(t) || /\b(?:sum\w*|agreg\w*|tambien|ademas)\b/.test(t) || /\by\s+(?:un[oa]?s?|dos|tres|cuatro|cinco|seis|\d{1,3})\b/.test(t);
}

// al «¿Lo confirmo?», saludar o presentarse no es aceptar («Hola, soy Leandro», «Es Leandro»)
const RE_SE_PRESENTA = /^(?:(?:dale|ok|listo|si)[\s,.!]+)?(?:hola+|buenas+|buen dia|soy|es|me llamo|mi nombre es|habla|te habla)\b/;

/**
 * ¿El mensaje acepta el resumen con «¿Lo confirmo?»? 'si' (con `canon`, la forma
 * que se le pasa a la base) o 'dato' (el MISMO nombre o dirección que ya tiene
 * la cotización: «A nombre de Leandro»). null si no es una aceptación limpia.
 */
export function aceptaElResumen(textoCliente: string, q?: { tipo?: string; nombre?: string | null; direccion?: string | null } | null): { modo: 'si' | 'dato' | null; canon: string; motivo: string } {
  const texto = String(textoCliente ?? '').trim();
  const canon = normalizarSi(texto, q?.tipo);
  if (canon && confirmacionInequivoca(canon)) {
    if (siConAgregado(texto)) return { modo: null, canon, motivo: 'el sí trae algo más (otro producto o un cambio)' };
    return { modo: 'si', canon, motivo: 'sí al resumen' };
  }
  if (!q) return { modo: null, canon, motivo: 'no es un sí' };
  if (RE_SE_PRESENTA.test(norm(texto))) return { modo: null, canon, motivo: 'saluda o se presenta: no es aceptar el resumen' };
  const dato = soloElDato(texto, q);
  return dato.ok ? { modo: 'dato', canon: texto, motivo: dato.motivo } : { modo: null, canon, motivo: dato.motivo };
}

/** La forma de una aceptación, sin la cotización a mano (el atajo y la herramienta; crearPedido decide). */
export function pareceAceptacion(textoCliente: string): boolean {
  const t = String(textoCliente ?? '').trim();
  return aceptaElResumen(t).modo === 'si' || (pareceSoloElDato(t).ok && !RE_SE_PRESENTA.test(norm(t)));
}

/**
 * El «¿Lo confirmo?» que el «sí» contesta. El último mensaje del bot, o uno de
 * los anteriores si en el medio solo hubo cosas que no cambian el pedido: una
 * respuesta del bot sin pregunta ni importes («Hasta las 21 h.»), lo que escribió
 * el local desde el teléfono («ok») o el saludo de una charla nueva, y preguntas
 * del cliente que no cambian nada. Si en el medio hubo otro total, otra pregunta
 * del bot, un archivo o un cambio del cliente, no hay «¿Lo confirmo?» vigente.
 */
export function loConfirmoVigente(historial: { role: string; content: unknown }[], textoCliente = '', max = 6): string {
  const ms = (historial ?? []).slice(-max);
  for (let i = ms.length - 1; i >= 0; i--) {
    const t = String(ms[i]?.content ?? '');
    if (ms[i]?.role === 'assistant') {
      if (RE_LO_CONFIRMO.test(t)) return t;
      // pasado el saludo de una charla nueva, solo un «confirmalo» explícito vuelve al resumen de antes
      const saludoNuevo = /^(?:Buen día|Buenas tardes|Buenas noches)\. ¿Qué necesitás\?$/.test(t.trim());
      if (saludoNuevo && !/\bconfirm\w*/i.test(norm(textoCliente))) return '';
      if (!saludoNuevo && (/[?¿]/.test(t) || /\$\s?\d|\btotal\b/i.test(t))) return '';
    } else if (/^[📷🎙️📎]|\[adjunto/u.test(t) || cambiaElPedido(t) || siConAgregado(t)) {
      return '';
    }
  }
  return '';
}

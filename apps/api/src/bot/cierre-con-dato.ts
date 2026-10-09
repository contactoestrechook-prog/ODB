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
import { pesos } from './comercio';

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
  'cancelalo cancela cancelar cancelo anulalo anula espera esperame mas tambien otro otra hielo hielos sumame agregame sacame cambialo').split(' ').map(norm));

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
const RE_NO_ES_SOLO_EL_DATO = /\?|\b(no|pero|tambi[eé]n|sum[aá]\w*|agreg\w*|cambi\w*|sac[aá]\w*|quit\w*|mejor|otr[oa]s?|despu[eé]s|todav[ií]a|esper\w*|cancel\w*|anul\w*|m[aá]s|hielo\w*|y\s+\d|\d+\s*(?:x|×|unidades?|botellas?|packs?|cajas?))\b/i;

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
  const vio = (p.ultimosBot ?? []).some((m) => {
    const t = String(m ?? '');
    return new RegExp(`\\btotal\\b[^\\n$]{0,25}${totalTxt.replace(/[$.]/g, (c) => `\\${c}`)}(?!\\d)`, 'i').test(t) && renglones.every((r) => t.includes(r));
  });
  if (!vio) return no('el cliente no vio esta misma lista con este total');

  // 3) el mensaje es solo el dato
  if (texto.length > 80 || texto.includes('\n')) return no('el mensaje es largo o tiene varias líneas');
  if (RE_NO_ES_SOLO_EL_DATO.test(norm(texto))) return no('el mensaje trae algo más que el dato');

  // 4) el dato es el que quedó en la cotización
  if (q.tipo === 'domicilio') {
    const dir = norm(String(q.direccion ?? '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const t = norm(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!dir || !/\d/.test(dir) || !t.includes(dir.split(' ').slice(0, 2).join(' '))) return no('la dirección del mensaje no es la de la cotización');
    return { ok: true, motivo: 'dio la dirección' };
  }
  const nombre = nombreDeQuienRetira(texto);
  if (!nombre) return no('el mensaje no es un nombre');
  if (!q.nombre || norm(String(q.nombre)).split(/\s+/)[0] !== norm(nombre).split(/\s+/)[0]) return no('el nombre no es el de la cotización');
  return { ok: true, motivo: `dio el nombre (${nombre})` };
}

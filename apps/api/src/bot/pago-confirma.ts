// EL PAGO Y EL CIERRE (Leandro, 5/10/2026). La charla de Pablo, que llevaba
// vinos a España: pidió el total y el alias juntos y le llegó solo el alias;
// el bot le pidió que escribiera «confirmo»; mandó el PDF de la transferencia
// y en vez de «Recibido.» le volvió el resumen con «¿Lo confirmo?»; avisó
// «ahí te pasé el comprobante» y el pago quedó registrado dos veces; y aunque
// pagó justo el total con descuento, NUNCA se creó el pedido.
//
// Decisión de Leandro: si el cliente manda el comprobante (el archivo) de un
// resumen que ya vio con «¿Lo confirmo?» y el monto coincide justo con el total
// de lista o con el total con descuento por efectivo o transferencia, el pedido
// se crea solo. Si no coincide, no se crea nada y va «Recibido.».
//
// Acá viven las piezas (funciones puras y las consultas); bot.service.ts solo
// las engancha en derivar_pago, preparar_pedido y crearPedido.

import { pesos } from './comercio';
import { casiIgual, conAviso, quitarOraciones, SUCURSAL_CENTRAL } from './prolijo';

export type ArchivoDelTurno = { base64: string; mime: string };
export type MensajeDeCharla = { role: string; content: unknown };

export const RE_LO_CONFIRMO = /¿\s*lo confirmo\?/i;

const sinTildes = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** El total pagando en efectivo o transferencia de una cotización guardada (los renglones sin descuento van a precio de lista). */
export function totalEfectivoDe(items: unknown): number {
  const renglones = Array.isArray(items) ? items : [];
  return Math.round(renglones.reduce((s: number, r: any) => s + Number(r?.subtotalEfectivo ?? r?.subtotal ?? 0), 0));
}

/**
 * ¿El monto es el total de lista o el total con descuento? Diferencia de menos
 * de $1. El envío es sin cargo: el monto esperado nunca suma envío.
 */
export function montoDelPedido(monto: number, total: number, efectivo: number): 'lista' | 'efectivo' | null {
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (Number(total) > 0 && Math.abs(m - Number(total)) < 1) return 'lista';
  if (Number(efectivo) > 0 && Math.abs(m - Number(efectivo)) < 1) return 'efectivo';
  return null;
}

/** «$317.100» o «$317.100 / $285.390» cuando hay descuento */
const totalesDe = (total: number, efectivo: number) =>
  efectivo > 0 && Math.round(efectivo) < Math.round(total) ? `$${pesos(total)} / $${pesos(efectivo)}` : `$${pesos(total)}`;

/**
 * ¿Lo que escribió el cliente cambia el pedido? (cantidades nuevas, sacá,
 * cambiá, agregá, cancelá…). Ante la duda, sí: el comprobante no confirma un
 * pedido que el cliente estaba tocando. «En 10 minutos hago la transferencia»
 * no cambia nada.
 */
export function cambiaElPedido(texto: string): boolean {
  const t = sinTildes(texto);
  if (!t.trim()) return false;
  // «en vez del Malbec», «en lugar del…» y «que sea X» también (5/10/2026, revisión:
  // el \b de «en vez de» no tomaba «del»)
  if (/\b(sac\w*|quit\w*|cambi\w*|agreg\w*|suma(?:le|me|lo|la|les|r|ria)|pone(?:le|me|lo|la)|cancel\w*|anul\w*|reemplaz\w*|olvidate|me arrepenti\w*|(?:en vez|en lugar) del?|que sean?|ya no (?:lo |la |los |las )?(?:quiero|necesito|va)|no (?:lo |la |los |las )?quiero|todavia no|esper\w*|dejalo|dejala|dejamelo|sin (?:el|la|los|las))\b/.test(t)) return true;
  // otro producto o más unidades: «otro judas», «uno más», «y un judas más»
  if (/\botr[oa]s?\b/.test(t)) return true;
  if (/\b(?:un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|docena)\s+(?:\w+\s+)?mas\b/.test(t)) return true;
  if (/\b(?:un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:botellas?|unidades?|cajas?|packs?|latas?|kilos?)\b/.test(t)) return true;
  if (/\b(?:tambien|ademas)\b[^.?!\n]*\b(?:un[oa]?|dos|tres|\d{1,3})\b/.test(t)) return true;
  // «sumá un fernet», «poné dos hielos», «quiero una más», «y un fernet»
  if (/\b(?:suma|pone|agrega|manda|trae|anota|quiero|quisiera|necesito)\s+(?:un[oa]?s?|dos|tres|cuatro|cinco|seis|\d{1,3})\b/.test(t)) return true;
  if (/(?:^|[,.;!?]\s*)y\s+(?:un[oa]?|dos|tres|cuatro|cinco|seis)\s+[a-zñ]{3,}/.test(t)) return true;
  // números con producto («2 judas», «x3 fernet», «6 botellas»), sacando antes
  // las horas, los plazos y los importes, que no son cantidades
  const sinTiempos = t
    .replace(/\$\s?[\d.,]+/g, ' ')
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\b\d{1,3}\s*(?:minutos?|mins?|horas?|hs?|segundos?|dias?|semanas?|meses|cuotas?|de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))\b/g, ' ');
  return /(?:^|[^\d.,])(?:x\s?)?\d{1,3}\s*(?:x\s*)?(?:[a-zñ]{3,}|mas\b)/.test(sinTiempos);
}

/**
 * ¿Lo que escribió el cliente cambia la ENTREGA? (5/10/2026, revisión). Como el
 * envío es sin cargo, retiro y envío tienen el mismo total: «¿Me lo podés
 * mandar a casa?» o «Lo retiro el sábado» después del resumen no cambian el
 * monto, pero el pedido ya no es el que vio. Envío, dirección, calle con
 * número o un día: el comprobante no confirma. «Retiro en un rato» o «hoy» no
 * cambian nada.
 */
export function cambiaLaEntrega(texto: string): boolean {
  const t = sinTildes(texto);
  if (!t.trim()) return false;
  // pedir que se lo manden («envialo», «mandámelo a…», «con envío», «a casa»).
  // «Te envío el comprobante», «transferencia enviada» o «te lo mando» hablan
  // del pago, no de la entrega: con un «envi\w*» suelto, el epígrafe más común
  // de un comprobante dejaba sin efecto la decisión de Leandro (5/10/2026)
  if (/\b(?:envi[ae](?:lo|la|los|las|melo|mela|melos|melas|me|n(?:lo|la|los|las)?)\b|(?:con|por|el|un|de|hac\w*)\s+(?:el\s+)?envio\b|mand[ae](?:lo|la|los|las|melo|mela|melos|melas)\b|mand(?:a|ame|en)\s+(?:a|al|para)\b|me\s+(?:lo|la|los|las)\s+(?:mand|envi|tra[ei])\w*|tra(?:e|i)(?:melo|mela|melos|melas|lo|la|los|las)\b|a\s+(?:mi\s+|la\s+)?casa\b|domicilio|direccion|delivery|reparto|recibe\b|lo\s+recibo)/.test(t)) return true;
  if (/\b(?:av(?:enida)?\.?|calle|ruta|barrio|lote|km)\s+[a-z0-9]/.test(t)) return true;
  // una calle con número: «Hipólito Yrigoyen 8250», «Mitre 1200». Sin los
  // importes ni los números del comprobante («operación 12345», «total 2000»)
  const sinNumerosDelPago = t
    .replace(/\$\s?[\d.,]+/g, ' ')
    .replace(/\b\d{1,3}(?:\.\d{3})+\b/g, ' ')
    .replace(/\b(?:operacion|comprobante|transferencia|nro|numero|n|op|cuit|cuil|cbu|cvu|dni|codigo|ref|referencia|id|total|monto|importe|pago|pesos)\s*[:#°º]?\s*\d+/g, ' ');
  if (/\b[a-zñ]{3,}\s+\d{3,5}\b/.test(sinNumerosDelPago)) return true;
  return /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|pasado manana|la semana que viene|otro dia)\b/.test(t);
}

/** ¿El bot le pidió un dato después del resumen (la dirección, a nombre de quién)? Entonces el pedido no está cerrado. */
const RE_PIDE_DATO = /(?:¿[^?]*\b(?:direcci[oó]n|calle|a nombre de qui[eé]n|qui[eé]n (?:lo )?(?:recibe|retira)|tu nombre)\b[^?]*\?|\bpas(?:a|á)me (?:la direcci[oó]n|tu nombre|el nombre)|\bdecime (?:la direcci[oó]n|tu nombre|el nombre|a nombre de))/i;

/**
 * EL ALIAS Y EL TOTAL JUNTOS (5/10/2026, mensaje 16 de Pablo): el cliente pidió
 * «el total y a dónde transferir», el resumen y el alias salieron en el mismo
 * turno y ganó el último: le llegó el alias sin el total. Los datos de pago van
 * DENTRO del resumen, antes de «¿Lo confirmo?», que sigue siendo la última
 * línea con el mismo total (así el «sí» sigue entrando por el atajo).
 */
export function conDatosDePago(resumen: string, datosPago?: string | null): string {
  const r = String(resumen ?? '').trimEnd();
  const datos = String(datosPago ?? '').trim();
  if (!datos || !r) return resumen;
  const m = /¿\s*lo confirmo\?\s*$/i.exec(r);
  if (!m) return resumen;
  if (r.includes(datos)) return resumen;
  return `${r.slice(0, m.index).trimEnd()}\n${datos}\n${r.slice(m.index)}`;
}

/**
 * Los datos de pago pedidos en el mismo turno en que el pedido quedó confirmado
 * (el «nada más» o el comprobante) van abajo de la confirmación, pero ANTES de
 * la pregunta del final («¿A nombre de quién lo retiran?»), que sigue siendo la
 * última línea (5/10/2026, revisión: quedaba en el medio del mensaje). Sin
 * pregunta al final, abajo de todo, como antes.
 */
export function confirmacionConDatosDePago(confirmacion: string, datosPago?: string | null): string {
  const c = String(confirmacion ?? '').trim();
  const datos = String(datosPago ?? '').trim();
  if (!datos || c.includes(datos)) return c;
  return conAviso(c, datos);
}

/** Los datos de pago para meter en el resumen: alias/CBU/titular y el pedido del comprobante, en dos renglones. */
export function datosDePagoParaResumen(out: { datosDePago?: unknown; respuestaFija?: unknown }): string {
  const datos = String(out?.datosDePago ?? '').trim();
  if (datos) return `${datos.replace(/\.\s*$/, '')}.\nCuando transfieras, mandame el comprobante por acá.`;
  return String(out?.respuestaFija ?? '').trim();
}

// «Decime «confirmo» y dejo el pedido preparado…» (mensaje 20 de Pablo): el
// comprobante confirma el pedido, al cliente nunca se le pide la palabra
const RE_PIDE_CONFIRMO = /dec[ií]me\s*[«"“'‘]?\s*confirmo/i;

/** El total del último resumen con «¿Lo confirmo?» que vio el cliente, o ''. */
function totalDelResumen(ultimosBot: string[] = []): string {
  for (const m of ultimosBot) {
    if (!RE_LO_CONFIRMO.test(String(m ?? ''))) continue;
    const t = /\bTotal:?\s*(\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/i.exec(String(m));
    if (t) return t[1].replace(/\s/g, '');
  }
  return '';
}

/** Saca la oración que le pide al cliente que escriba «confirmo». */
export function sinPedirConfirmo(texto: string, textoCliente = '', ultimosBot: string[] = []): string {
  const t = String(texto ?? '');
  if (!RE_PIDE_CONFIRMO.test(t)) return t;
  // sin aplanar el mensaje: el renglón que queda vacío se saca (quitarOraciones)
  const limpio = quitarOraciones(t, (o) => RE_PIDE_CONFIRMO.test(o)).texto;
  if (limpio) return limpio;
  // no quedó nada: si habla de pagar, la respuesta de siempre; si no, la pregunta
  // del resumen CON SU TOTAL (regla 3b del prompt): un «¿Lo confirmo?» suelto no
  // lo acepta el «sí» y el bot volvía a armar el resumen (5/10/2026, revisión)
  if (/transfer|pag[oóa]|abon|comprobante|alias|cbu/i.test(textoCliente)) return 'Dale, mandalo por acá.';
  const total = totalDelResumen(ultimosBot);
  return total ? `Total ${total}. ¿Lo confirmo?` : '¿Lo confirmo?';
}

/**
 * Las notas de preparar_pedido salen en el resumen que lee el cliente: no
 * pueden decir «pagado» ni «pago confirmado» (mensaje 22 de Pablo: «Pagado por
 * transferencia ($285.390, comprobante enviado)», sin que administración
 * hubiera visto nada). «Pagado por transferencia (…)» → «Paga por transferencia».
 */
export function notasSinPagado(notas: string): string {
  let t = String(notas ?? '');
  if (!t.trim()) return t;
  const paga = (medio: string) => {
    const m = sinTildes(medio);
    return /transfer/.test(m) ? 'paga por transferencia' : /efectivo/.test(m) ? 'paga en efectivo' : /mercado|link/.test(m) ? 'paga por link' : 'paga con tarjeta';
  };
  const mayuscula = (s: string, antes: string) => (!antes.trim() || /[.!?;:·\n]\s*$/.test(antes) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // 1) «Pagado por transferencia ($285.390, comprobante enviado)». «Pago por
  //    transferencia» (el sustantivo, sin tilde) habla del medio: no se toca.
  t = t.replace(
    /(?:ya\s+pag[oó]|ya\s+abon[oó]|pagad[oa]s?|abonad[oa]s?|pagó|abonó)\s+(?:por|con|en|mediante|v[ií]a)\s+(transferencia|efectivo|tarjeta(?:\s+de\s+(?:d[eé]bito|cr[eé]dito))?|d[eé]bito|cr[eé]dito|mercado\s*pago|link)(?:\s*\([^)]*\))?/gi,
    (_m, medio, off, todo) => mayuscula(paga(medio), todo.slice(0, off)),
  );
  // 2) «Pago confirmado por transferencia…», «pago acreditado»
  t = t.replace(/\bpago\s+(?:ya\s+)?(?:confirmad|acreditad|recibid|realizad|hech|aprobad|efectuad)[oa]s?\b((?:[^.;\n]|\.(?=\d))*)/gi, (_m, resto, off, todo) => {
    const r = sinTildes(resto);
    const s = /transfer/.test(r) ? 'paga por transferencia' : /efectivo/.test(r) ? 'paga en efectivo' : '';
    return s ? mayuscula(s, todo.slice(0, off)) : '';
  });
  // 3) lo que quede con «pagado», «abonado», «acreditado» o «ya pagó»
  t = t.replace(/(?:[^.;\n]|\.(?=\d))*(?:\bpagad[oa]s?\b|\babonad[oa]s?\b|\bacreditad[oa]s?\b|\bya\s+pag[oó](?![a-záéíóúñ])|\bya\s+abon[oó](?![a-záéíóúñ]))(?:[^.;\n]|\.(?=\d))*[.;]?/gi, (m, off, todo) => {
    const s = /transfer/i.test(sinTildes(m)) ? 'paga por transferencia.' : '';
    return s ? `${/^\s/.test(m) ? ' ' : ''}${mayuscula(s, todo.slice(0, off))}` : '';
  });
  return t
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/([.;])\s*[.;]+/g, '$1')
    .replace(/^\s*[.;·,]\s*/, '')
    .trim();
}

/**
 * La respuesta al cliente cuando su comprobante confirmó el pedido. Nunca
 * «acreditado», «pagado» ni «te confirmo»: la plata la confirma administración.
 * Para envío, la plantilla de siempre: «Envío sin cargo a …».
 */
export function respuestaPedidoPorComprobante(p: { codigo: string; tipo?: string | null; direccion?: string | null }): string {
  return p.tipo === 'domicilio'
    ? `Recibido. Tu pedido ${p.codigo} quedó confirmado. Envío sin cargo${p.direccion ? ` a ${p.direccion}` : ''}.`
    : `Recibido. Tu pedido ${p.codigo} quedó confirmado para retirar en la ${SUCURSAL_CENTRAL}.`;
}

/**
 * Razonamiento siempre encendido (regla fija del 9/9/2026): adaptive en los
 * modelos 4.6 en adelante y en los 5; los viejos (Haiku 4.5, Sonnet y Opus 4.5
 * o anteriores) piensan con budget_tokens, que tiene que ser menor que max_tokens.
 */
export function razonamientoPara(modelo: string): { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number } {
  const m = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/i.exec(String(modelo ?? ''));
  if (!m) return /claude-[123]\b|claude-[123]-/i.test(String(modelo ?? '')) ? { type: 'enabled', budget_tokens: 2048 } : { type: 'adaptive' };
  const mayor = Number(m[1]);
  const menor = m[2] && m[2].length <= 2 ? Number(m[2]) : 0; // «-20250514» es una fecha, no la versión
  return mayor > 4 || (mayor === 4 && menor >= 6) ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: 2048 };
}

type ClienteClaude = { messages: { create: (params: any) => Promise<any> } };

/**
 * UNA lectura aparte del comprobante, sin el historial de la charla: el modelo
 * que atiende ve «$285.390» en la charla y puede «leer» el monto que espera.
 * Con razonamiento encendido y salida estructurada {importe:number|null}.
 */
export async function leerImporteDelComprobante(claude: ClienteClaude, modelo: string, archivo: ArchivoDelTurno): Promise<number | null> {
  const esPdf = /pdf/i.test(archivo?.mime ?? '');
  const mime = String(archivo?.mime ?? '').split(';')[0].toLowerCase();
  const bloque = esPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|gif|webp)$/.test(mime) ? mime : 'image/jpeg', data: archivo.base64 } };
  const r = await claude.messages.create({
    model: modelo,
    max_tokens: 8192, // el razonamiento sale del mismo presupuesto: con poco, la respuesta viene vacía
    thinking: razonamientoPara(modelo),
    system: 'Leés comprobantes de transferencias y pagos bancarios de Argentina. Devolvés solo el importe transferido, en pesos.',
    messages: [{
      role: 'user',
      content: [
        bloque,
        { type: 'text', text: '¿Es un comprobante de transferencia o de pago? Si lo es, devolvé el importe transferido en pesos como número, sin separadores de miles (por ejemplo 285390 o 285390.5). Si no es un comprobante o el importe no se lee con claridad, devolvé null.' },
      ],
    }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: { type: 'object', properties: { importe: { anyOf: [{ type: 'number' }, { type: 'null' }] } }, required: ['importe'], additionalProperties: false },
      },
    },
  });
  if (r?.stop_reason === 'refusal') return null;
  const texto = ((r?.content ?? []) as any[]).find((b) => b?.type === 'text')?.text;
  if (!texto) return null;
  try {
    const n = Number(JSON.parse(texto)?.importe);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * ¿Este comprobante ya está en administración? Una fila abierta (sin
 * confirmar) del mismo chat, con el mismo monto si lo hay, de las últimas 2 h.
 * Una fila sin fecha de creación no cuenta como reciente. Sin monto, solo una
 * fila con monto (de un comprobante): una «consulta de pago» abierta no alcanza
 * para callar un comprobante (5/10/2026, revisión).
 */
export async function comprobanteYaRegistrado(db: any, linea: string, telefono: string, monto: number): Promise<boolean> {
  const desde = Date.now() - 2 * 3600_000;
  const { data } = await db.from('bot_pagos_en_confirmacion').select('id, monto, creado_en, confirmado_en')
    .eq('linea', linea).eq('telefono_cliente', telefono).is('confirmado_en', null)
    .gte('creado_en', new Date(desde).toISOString()).order('creado_en', { ascending: false }).limit(10);
  const filas: any[] = Array.isArray(data) ? data : [];
  return filas.some((f) => {
    const creado = f?.creado_en ? new Date(f.creado_en).getTime() : NaN;
    if (f?.confirmado_en || !Number.isFinite(creado) || creado < desde) return false;
    // sin monto, solo cuenta un comprobante con monto (no una consulta de pago abierta)
    return monto > 0 ? Math.abs(Number(f?.monto ?? 0) - monto) < 1 : Number(f?.monto ?? 0) > 0;
  });
}

/**
 * Qué contestarle al que avisa «ahí te pasé el comprobante» sin mandar nada
 * nuevo: «Recibido.», o la confirmación si su comprobante ya creó el pedido. Y
 * nunca el mismo mensaje dos veces seguidas (22/9/2026): si lo último que le
 * dijimos ya era eso, «Sí, ya lo tengo.».
 */
export async function respuestaAlComprobanteRepetido(db: any, linea: string, telefono: string, ultimoDelBot: string): Promise<string> {
  let texto = 'Recibido.';
  try {
    const { data: q } = await db.from('bot_cotizaciones').select('id, tipo, direccion, confirmacion, confirmada_en, pedido_id')
      .eq('telefono', telefono).eq('linea', linea).order('creada_en', { ascending: false }).limit(1).maybeSingle();
    const confirmada = q?.confirmada_en ? new Date(q.confirmada_en).getTime() : NaN;
    if (q?.pedido_id && /^comprobante:/i.test(String(q.confirmacion ?? '')) && Date.now() - confirmada < 3 * 3600_000) {
      const { data: ped } = await db.from('pedidos').select('qr_retiro').eq('id', q.pedido_id).maybeSingle();
      if (ped?.qr_retiro) texto = respuestaPedidoPorComprobante({ codigo: String(ped.qr_retiro), tipo: q.tipo, direccion: q.direccion });
    }
  } catch { /* sin datos: «Recibido.» */ }
  return ultimoDelBot && casiIgual(texto, ultimoDelBot) ? 'Sí, ya lo tengo.' : texto;
}

/** El código del pedido de una cotización confirmada, como lo arma confirmar_cotizacion_bot: PICKUP-/DOM- + 12 del id. */
export function codigoDelPedido(q: { id?: string | null; tipo?: string | null }): string {
  return `${q?.tipo === 'domicilio' ? 'DOM-' : 'PICKUP-'}${String(q?.id ?? '').replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

export type PedidoPorComprobante = {
  /** el pedido que se creó (código y respuesta al cliente), o null */
  creado: { codigo: string; respuesta: string } | null;
  /** lo que se le antepone al aviso a administración ('' si no hay nada que decir) */
  nota: string;
  /** por qué no se creó (para el log) */
  motivo: string;
};

/**
 * EL COMPROBANTE CONFIRMA EL PEDIDO (decisión de Leandro, 5/10/2026). Solo si
 * todo da:
 *  · la última cotización del chat (la misma consulta que crearPedido) no tiene
 *    pedido ni está confirmada y tiene menos de 3 h;
 *  · el cliente la vio: uno de los últimos mensajes del bot trae «¿Lo
 *    confirmo?» con el total de esa cotización, y no se preparó otra en este turno;
 *  · nada de lo que escribió después de ese resumen cambia el pedido;
 *  · nada de lo que escribió cambia la entrega (envío, dirección, día) y el bot
 *    no le pidió un dato después del resumen;
 *  · no hay un pedido del chat confirmado en las últimas 6 h (puede ser su pago);
 *  · el monto que pasó el modelo Y una lectura aparte del archivo coinciden con
 *    el total de lista o con el de efectivo (diferencia < $1).
 * Si algo no da, no se crea nada y el turno sigue como siempre («Recibido.»).
 * La base vuelve a controlar el monto (confirmar_cotizacion_bot, modo 'comprobante').
 */
export async function pedidoPorComprobante(p: {
  db: any;
  telefono: string;
  linea: string;
  montoDelModelo: number;
  ultimosBot: string[];
  historial?: MensajeDeCharla[];
  textoCliente: string;
  preparoEnElTurno?: boolean;
  leerImporte: () => Promise<number | null>;
  crear: (dto: { cotizacionId: string; monto: number }) => Promise<{ codigoRetiro: string; respuesta: string }>;
  log?: { log: (m: string) => void; warn: (m: string) => void };
}): Promise<PedidoPorComprobante> {
  const no = (motivo: string, nota = ''): PedidoPorComprobante => {
    p.log?.log(`el comprobante de ${p.telefono} no crea el pedido: ${motivo}`);
    return { creado: null, nota, motivo };
  };
  if (p.preparoEnElTurno) return no('se preparó otro resumen en este mismo turno (el cliente no lo vio)');

  const { data } = await p.db.from('bot_cotizaciones')
    .select('id, total, items, tipo, direccion, resumen, creada_en, confirmada_en, pedido_id')
    .eq('telefono', p.telefono).eq('linea', p.linea).order('creada_en', { ascending: false }).limit(5);
  const filas: any[] = Array.isArray(data) ? data : data ? [data] : [];
  const q = filas[0];
  if (!q?.id) return no('no hay ningún resumen guardado');
  if (q.pedido_id || q.confirmada_en) return no('el último resumen ya tiene pedido');
  if (!(Date.now() - new Date(q.creada_en).getTime() < 3 * 3600_000)) return no('el último resumen tiene más de 3 h');
  // UN PEDIDO DEL CHAT DE LAS ÚLTIMAS HORAS (5/10/2026, revisión): antes
  // frenaba solo uno de hace menos de 15 min. «Pasame el total y el alias»
  // después de confirmar armaba otro resumen igual, y el PDF del pago del
  // primero creaba un SEGUNDO pedido (dos reservas de stock por una compra).
  // Con un pedido de las últimas 6 h no se crea nada: administración sabe que
  // puede ser el pago de ese pedido.
  const reciente = filas.find((f) => f?.confirmada_en && Date.now() - new Date(f.confirmada_en).getTime() < 6 * 3600_000);
  if (reciente) {
    const codigo = codigoDelPedido(reciente);
    return no(`hay un pedido del chat confirmado hace menos de 6 h (${codigo})`, `Puede ser el pago del pedido ${codigo}, confirmado hace un rato: no se creó otro pedido.`);
  }

  const total = Number(q.total);
  const efectivo = totalEfectivoDe(q.items);
  const totalTxt = `$${pesos(total)}`;
  const esElResumen = (m: unknown) => RE_LO_CONFIRMO.test(String(m ?? '')) && String(m ?? '').includes(totalTxt);
  if (!(p.ultimosBot ?? []).slice(0, 3).some(esElResumen)) return no('el cliente no vio ese resumen con «¿Lo confirmo?»');

  // lo que escribió el cliente DESPUÉS del resumen (y lo de este turno)
  const historial = Array.isArray(p.historial) ? p.historial : [];
  let i = historial.length - 1;
  while (i >= 0 && !(historial[i]?.role === 'assistant' && esElResumen(historial[i]?.content))) i--;
  if (i < 0) return no('no encuentro el resumen en la charla');
  const despues = [...historial.slice(i + 1).filter((m) => m?.role === 'user').map((m) => String(m.content ?? '')), p.textoCliente ?? ''];
  const cambio = despues.find((t) => cambiaElPedido(t) || cambiaLaEntrega(t));
  if (cambio !== undefined) return no(`después del resumen el cliente cambió el pedido («${cambio.slice(0, 60)}»)`);
  // y si después del resumen el bot le pidió un dato (la dirección, a nombre de
  // quién), el pedido todavía no estaba cerrado (5/10/2026, revisión)
  if (historial.slice(i + 1).some((m) => m?.role === 'assistant' && RE_PIDE_DATO.test(String(m.content ?? '')))) return no('después del resumen el bot le pidió un dato');
  // y si después del resumen el bot volvió a anotar una lista («• 2 × …», «¿Está
  // completo…?»), el pedido se estaba cambiando aunque las palabras no lo digan
  const listaNueva = historial.slice(i + 1).some((m) => m?.role === 'assistant' && /\d\s*×\s*\S|¿[^?]*(?:est[aá] completo|sumar algo|agregar algo)[^?]*\?/i.test(String(m.content ?? '')));
  if (listaNueva) return no('después del resumen el bot anotó otra lista');

  const pedidoEs = totalesDe(total, efectivo);
  const cual = montoDelPedido(p.montoDelModelo, total, efectivo);
  if (!cual) {
    return no(`monto ${p.montoDelModelo} distinto de ${pedidoEs}`, `El monto no coincide con el resumen ($${pesos(Number(p.montoDelModelo) || 0)}; el pedido es ${pedidoEs}): no se creó el pedido.`);
  }
  // la lectura aparte, sin la charla: los DOS montos tienen que coincidir
  const leido = await p.leerImporte().catch((e: any) => { p.log?.warn(`lectura aparte del comprobante de ${p.telefono} falló: ${e?.message ?? e}`); return null; });
  if (leido == null) {
    return no('la lectura aparte no encontró el importe', `No se pudo verificar el importe del comprobante (el pedido es ${pedidoEs}): no se creó el pedido.`);
  }
  if (montoDelPedido(leido, total, efectivo) !== cual) {
    return no(`la lectura aparte dice ${leido} y el modelo ${p.montoDelModelo}`, `El monto no coincide con el resumen ($${pesos(leido)}; el pedido es ${pedidoEs}): no se creó el pedido.`);
  }
  try {
    const c = await p.crear({ cotizacionId: q.id, monto: leido });
    p.log?.log(`pedido ${c.codigoRetiro} confirmado por el comprobante de ${p.telefono} ($${pesos(leido)}, total ${cual === 'efectivo' ? 'con descuento' : 'de lista'})`);
    return {
      creado: { codigo: c.codigoRetiro, respuesta: c.respuesta },
      nota: `El monto coincide con el pedido ${c.codigoRetiro} ($${pesos(leido)}, ${cual === 'efectivo' ? 'total con descuento por transferencia' : 'total de lista'}): el pedido quedó creado por el comprobante.`,
      motivo: '',
    };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 160);
    // ojo: si falló DESPUÉS de la base (al leer el pedido), el pedido puede existir: que lo revisen antes de cargarlo
    return no(`la base no lo creó: ${error}`, `El monto coincide con el resumen ($${pesos(leido)}; el pedido es ${pedidoEs}), pero hubo un error al confirmar el pedido (${error}): revisá si quedó cargado y, si no, cargalo a mano.`);
  }
}

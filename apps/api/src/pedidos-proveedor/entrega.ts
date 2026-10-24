import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// LA FECHA DE ENTREGA LA CONFIRMA EL PROVEEDOR POR WHATSAPP (23/10/2026).
// Pedido de Leandro: «que el bot le mande la nota de pedido, le pregunte cuándo
// lo puede entregar, que confirme por ese medio, y que el sistema registre
// cuándo va a entregar».
//
// Cuando un proveedor con un pedido esperando la fecha escribe, la IA lee SOLO
// su mensaje y dice: si dio una fecha (y cuál), si avisó que falta algo, o si el
// mensaje no tiene que ver. El código decide qué hacer y qué contestar: la IA
// no le escribe al proveedor ni inventa fechas.
// ============================================================

export type LecturaRespuesta = {
  /** el mensaje habla del pedido (fecha, entrega, faltantes) */
  sobreElPedido: boolean;
  /** fecha de entrega que dio, AAAA-MM-DD, o null si no dio una fecha concreta */
  fecha: string | null;
  /** franja u hora si la dijo ("a la mañana", "de 9 a 13") */
  horario: string | null;
  /** lo que avisó que falta o no puede entregar, en una línea; null si nada */
  faltantes: string | null;
  /** dice que NO puede hacer el pedido */
  rechaza: boolean;
};

const ESQUEMA = {
  type: 'object',
  properties: {
    sobreElPedido: { type: 'boolean' },
    fecha: { type: ['string', 'null'], description: 'AAAA-MM-DD, solo si el proveedor dio un día concreto o relativo resoluble (mañana, el jueves). null si no.' },
    horario: { type: ['string', 'null'] },
    faltantes: { type: ['string', 'null'] },
    rechaza: { type: 'boolean' },
  },
  required: ['sobreElPedido', 'fecha', 'horario', 'faltantes', 'rechaza'],
  additionalProperties: false,
};

const hoyAR = (ahora = new Date()) => ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const diaAR = (ahora = new Date()) => ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });

/** Una fecha que sirve: válida, de hoy en adelante y no más lejos que 90 días. */
export function fechaValida(f: unknown, ahora = new Date()): string | null {
  const t = String(f ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00-03:00`);
  if (Number.isNaN(d.getTime()) || d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) !== t) return null;
  const hoy = new Date(`${hoyAR(ahora)}T12:00:00-03:00`).getTime();
  const dias = Math.round((d.getTime() - hoy) / 86_400_000);
  return dias >= 0 && dias <= 90 ? t : null;
}

export function fechaLegible(f: string): string {
  return new Date(`${f}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
}

export async function leerRespuestaProveedor(texto: string, contexto: { folio: string; proveedor: string }, ahora = new Date()): Promise<LecturaRespuesta> {
  const claude = new Anthropic();
  const r: any = await claude.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 1500,
    system: [
      'Leés la respuesta de un proveedor de un almacén de Canning (Argentina) a un pedido que se le mandó por WhatsApp pidiéndole la fecha de entrega.',
      `Hoy es ${diaAR(ahora)} (${hoyAR(ahora)}). Resolvé «mañana», «el jueves», «la semana que viene el martes» a una fecha AAAA-MM-DD; «el jueves» es el próximo jueves (si hoy es jueves, hoy). Si dice algo vago («esta semana», «en unos días», «apenas pueda») no hay fecha: null.`,
      'sobreElPedido es false si el mensaje no habla del pedido ni de la entrega (un saludo suelto, otro tema, una factura de otra cosa).',
      'faltantes: lo que avisa que no tiene o no puede entregar, en una línea, con sus palabras. rechaza: true solo si dice que no puede hacer el pedido.',
      'No inventes nada que el mensaje no diga.',
    ].join('\n'),
    messages: [{ role: 'user', content: `Pedido ${contexto.folio} a ${contexto.proveedor}. Mensaje del proveedor:\n"""${texto.slice(0, 2000)}"""` }],
    output_config: { format: { type: 'json_schema', schema: ESQUEMA as any } },
  } as any);
  const bloque = (r.content ?? []).find((x: any) => x.type === 'text');
  const crudo = JSON.parse(bloque?.text ?? '{}');
  return {
    sobreElPedido: crudo.sobreElPedido === true,
    fecha: fechaValida(crudo.fecha, ahora),
    horario: typeof crudo.horario === 'string' && crudo.horario.trim() ? crudo.horario.trim().slice(0, 80) : null,
    faltantes: typeof crudo.faltantes === 'string' && crudo.faltantes.trim() ? crudo.faltantes.trim().slice(0, 300) : null,
    rechaza: crudo.rechaza === true,
  };
}

export type Decision =
  | { accion: 'ignorar' }
  | { accion: 'confirmar'; fecha: string; horario: string | null; faltantes: string | null; texto: string }
  | { accion: 'repreguntar'; faltantes: string | null; texto: string }
  | { accion: 'a_revisar'; faltantes: string | null; motivo: string; texto: string | null };

/**
 * Qué se hace con lo que dijo el proveedor. Repregunta UNA vez; si tampoco
 * queda clara la fecha, lo mira una persona (no se insiste más).
 */
export function decidir(l: LecturaRespuesta, folio: string, yaRepreguntado: boolean): Decision {
  if (!l.sobreElPedido) return { accion: 'ignorar' };
  if (l.rechaza) {
    return { accion: 'a_revisar', faltantes: l.faltantes, motivo: 'El proveedor dice que no puede hacer el pedido',
      texto: `Gracias por avisarnos. Lo vemos con administración y les escribimos.` };
  }
  if (l.fecha) {
    const cuando = `${fechaLegible(l.fecha)}${l.horario ? ` (${l.horario})` : ''}`;
    const falta = l.faltantes ? ` Tomamos nota de lo que falta: ${l.faltantes}.` : '';
    return { accion: 'confirmar', fecha: l.fecha, horario: l.horario, faltantes: l.faltantes,
      texto: `¡Gracias! Anotamos la entrega del pedido *${folio}* para el *${cuando}*.${falta}` };
  }
  if (!yaRepreguntado) {
    return { accion: 'repreguntar', faltantes: l.faltantes,
      texto: `¡Gracias! ¿Para qué día nos podrían entregar el pedido *${folio}*? Así lo dejamos agendado.` };
  }
  return { accion: 'a_revisar', faltantes: l.faltantes, motivo: 'El proveedor contestó pero no dio una fecha de entrega', texto: null };
}

export const textoRecordatorio = (folio: string) =>
  `Hola, ¿cómo están? Les escribimos por el pedido *${folio}* que les mandamos ayer: ¿para qué día nos lo pueden entregar? ¡Gracias!`;

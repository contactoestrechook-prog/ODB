// ============================================================
// LA RESPUESTA DEL ÁREA, VENGA DEL TELÉFONO QUE VENGA (24/10/2026)
//
// Lo que el bot no sabe se le pregunta al área (consulta silenciosa, 6/10/2026) y
// los comprobantes van a confirmar: los dos avisos salen DESDE la línea general
// AL teléfono de administración (lineas_whatsapp.derivar_pagos_a). Hasta hoy solo
// contaba como respuesta lo que salía de ESE teléfono citando el aviso.
//
// Revisión del 21/10: casi nadie contestaba desde ahí. Quien sabe las respuestas
// tiene el teléfono de la LÍNEA, donde las consultas aparecen como mensajes
// enviados en el chat con administración, y contestaba en ese mismo chat («Siii
// quedan», «Ya sale a reparto»). Eso le llega al bot como un mensaje propio y se
// perdía: el cliente nunca recibía la respuesta. Y cualquier respuesta sin citar
// rebotaba con «Respondé CITANDO…» porque había 159 pendientes que no vencen nunca.
//
// Las reglas (puras, con sus pruebas en respuesta-del-area.spec.ts):
// - Citando una consulta, un pago o el «Dato nuevo» de una consulta: es la
//   respuesta a eso, desde cualquiera de los dos teléfonos.
// - Sin citar, desde el teléfono de administración: cuentan solo los pendientes de
//   las últimas HORAS_SIN_CITA horas. Si queda uno solo, es ese; si hay más, se
//   pide citar. Lo de días atrás ya no traba nada.
// - Sin citar, desde el teléfono de la línea: ese chat también se usa para pasar
//   números, listas y reenvíos. Cuenta solo si hay UNA consulta de los últimos
//   MINUTOS_SIN_CITA_DESDE_LA_LINEA minutos y el texto parece una respuesta (ni un
//   teléfono, ni un reenvío, ni un «gracias»). Un pago desde la línea, solo citado:
//   hay plata de por medio.
// ============================================================
import { idWhatsappCorto } from './comercio';

export type OrigenRespuesta = 'area' | 'linea';

/** Sin cita, desde el teléfono del área: los pendientes de estas horas (los de antes ya no traban). */
export const HORAS_SIN_CITA = 48;
/** Sin cita, desde el teléfono de la línea: solo una consulta de estos últimos minutos. */
export const MINUTOS_SIN_CITA_DESDE_LA_LINEA = 30;

/** Una consulta o un pago pendiente, como viene de la base. */
export type Pendiente = {
  id: string;
  waha_msg_id?: string | null;
  creado_en?: string | null;
  respuesta_admin?: string | null;
};

export type Decision =
  | { tipo: 'consulta'; fila: Pendiente }
  | { tipo: 'pago'; fila: Pendiente }
  | { tipo: 'pedir_referencia' }
  | { tipo: 'nada'; motivo: string };

/** El origen que se anota en bot_envios para el «Dato nuevo» de una consulta: citarlo es citar la consulta. */
export const ORIGEN_DATO_NUEVO = 'consulta-dato:';
export const origenDelDatoNuevo = (consultaId: string) => `${ORIGEN_DATO_NUEVO}${consultaId}`;
/** «consulta-dato:<id>» → el id de la consulta; null si es otro envío. */
export function consultaDelDatoNuevo(origen: string | null | undefined): string | null {
  const o = String(origen ?? '');
  return o.startsWith(ORIGEN_DATO_NUEVO) && o.length > ORIGEN_DATO_NUEVO.length ? o.slice(ORIGEN_DATO_NUEVO.length) : null;
}

/**
 * ¿Cuenta para una respuesta SIN cita? Una consulta que ya tiene la respuesta del
 * área anotada (la entrega quedó pendiente) no toma otra. Sin fecha de creación,
 * cuenta, como siempre: no se descarta lo que no se puede medir.
 */
export function cuentaSinCita(f: Pendiente, o: { esConsulta: boolean; origen: OrigenRespuesta; ahora: number }): boolean {
  if (o.esConsulta && f.respuesta_admin) return false;
  const creada = Date.parse(String(f.creado_en ?? ''));
  if (!Number.isFinite(creada)) return true;
  const ventana = o.origen === 'linea' ? MINUTOS_SIN_CITA_DESDE_LA_LINEA * 60_000 : HORAS_SIN_CITA * 3600_000;
  return o.ahora - creada <= ventana;
}

/**
 * ¿A qué responde? Con cita, a lo citado (la consulta, su «Dato nuevo» o el pago).
 * Sin cita, al único pendiente que cuenta. Lo que no se puede saber: desde el área
 * se pide citar; desde la línea se pide citar solo si había más de una consulta
 * reciente (lo demás puede ser cualquier cosa que se escribió en ese chat).
 */
export function elegirReferencia(o: {
  origen: OrigenRespuesta;
  /** el id corto del mensaje citado; vacío si no cita */
  citado: string | null | undefined;
  /** si lo citado es el «Dato nuevo» de una consulta, el id de esa consulta */
  consultaDelDato?: string | null;
  consultas: Pendiente[];
  /** los pagos sin confirmar (solo para el teléfono de administración) */
  pagos: Pendiente[];
  /** avisos de pedidos del día cuando el texto es un acuse: un «ok» puede ser para un pedido */
  avisosDelDia?: number;
  ahora: number;
}): Decision {
  const citado = o.citado ? idWhatsappCorto(o.citado) : '';
  if (citado) {
    const consulta = o.consultas.find((c) => c.waha_msg_id && idWhatsappCorto(c.waha_msg_id) === citado)
      ?? (o.consultaDelDato ? o.consultas.find((c) => c.id === o.consultaDelDato) : undefined);
    const pago = o.pagos.find((p) => p.waha_msg_id && idWhatsappCorto(p.waha_msg_id) === citado);
    if (consulta && !pago) return { tipo: 'consulta', fila: consulta };
    if (pago && !consulta) return { tipo: 'pago', fila: pago };
    return o.origen === 'area' ? { tipo: 'pedir_referencia' } : { tipo: 'nada', motivo: 'cita algo que no es una consulta ni un pago abierto' };
  }
  const consultas = o.consultas.filter((c) => cuentaSinCita(c, { esConsulta: true, origen: o.origen, ahora: o.ahora }));
  // desde la línea, un pago se confirma solo citándolo
  const pagos = o.origen === 'linea' ? [] : o.pagos.filter((p) => cuentaSinCita(p, { esConsulta: false, origen: o.origen, ahora: o.ahora }));
  const acuse = o.origen === 'area' && Number(o.avisosDelDia ?? 0) > 0 ? 1 : 0;
  if (consultas.length + pagos.length + acuse > 1) return { tipo: 'pedir_referencia' };
  if (consultas.length === 1) return { tipo: 'consulta', fila: consultas[0] };
  if (pagos.length === 1) return { tipo: 'pago', fila: pagos[0] };
  return { tipo: 'nada', motivo: o.origen === 'linea' ? 'no hay una consulta reciente para esto' : 'sin consultas o pagos pendientes' };
}

// un teléfono en el texto («+54 9 11 6750-9996», «1151604731»): es un dato que se pasa, no una respuesta
const RE_TELEFONO = /(?:\+?\d[\s().-]*){8,}/;
// solo un agradecimiento o emojis: no es una respuesta para el cliente
const RE_SOLO_GRACIAS = /^(?:(?:muchas|mil|muy)\s+)?(?:gracias+|graciass*)(?:\s+(?:a\s+vos|genia?|crack))?[\s.,!]*$|^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️\s.,!]+$/iu;
// lo que el sistema le escribe a ese chat (por si el eco no se reconoció por el id)
const RE_DEL_SISTEMA = /^(?:❓|⏳|💳|🧾|consulta de un cliente|consulta sin respuesta|consulta de pago|comprobante recibido|proveedor por una factura|dato nuevo para una consulta|pedido nuevo|pedido sin tomar|pedido cancelado|pedido pagado|pedido confirmado sin cargar|piden la baja|respondé citando|para que le llegue al cliente|no le llegó al cliente|no le dije nada a|respuesta guardada|confirmación guardada|listo[,:]\s+(?:le|se lo)|eso no le llega al cliente|escribí la respuesta|información vigente)/i;

/**
 * Lo escrito SIN citar desde el teléfono de la línea en el chat de administración:
 * ¿puede ser la respuesta para un cliente? No, si es un teléfono, un reenvío, solo
 * un agradecimiento, un archivo, un texto del sistema o algo larguísimo. Citando no
 * hace falta: la cita ya dice para quién es.
 */
export function pareceRespuestaDesdeLaLinea(texto: string, o: { reenviado?: boolean; conArchivo?: boolean } = {}): boolean {
  const t = String(texto ?? '').trim();
  if (!t || t.length > 1000) return false;
  if (o.reenviado || o.conArchivo) return false;
  if (RE_TELEFONO.test(t)) return false;
  if (RE_SOLO_GRACIAS.test(t)) return false;
  if (RE_DEL_SISTEMA.test(t)) return false;
  return true;
}

// La respuesta del asistente del manual, leída y controlada. El modelo contesta
// un JSON; acá se descarta lo que no sirve: una pantalla o una sección que no
// existen no se muestran nunca como botón (un link a la nada es peor que nada).

export type Existe = 'si' | 'parcial' | 'no';

export type RespuestaManual = {
  existe: Existe;
  respuesta: string;
  pasos: string[];
  pantalla: string | null; // href del menú, solo si existe y la persona la puede abrir
  seccion: string | null; // id de la sección del manual
};

// La frase de siempre cuando algo no está en el sistema (Leandro, 10/11/2026:
// «si lo que están pidiendo no existe en el sistema que lo digan, que tienen que
// hablar con MetoGroup»). Si el modelo no la puso, se agrega.
export const HABLAR_CON_METOGROUP = 'Para pedirlo, hablá con MetoGroup.';

export const SIN_RESPUESTA: RespuestaManual = {
  existe: 'parcial',
  respuesta: 'No pude armar la respuesta ahora. Probá preguntarlo de otra forma o buscalo con el buscador del manual.',
  pasos: [],
  pantalla: null,
  seccion: null,
};

export function leerRespuesta(
  texto: string,
  pantallas: ReadonlySet<string>,
  secciones: ReadonlySet<string>,
): RespuestaManual {
  const m = String(texto ?? '').match(/\{[\s\S]*\}/);
  if (!m) return SIN_RESPUESTA;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return SIN_RESPUESTA;
  }
  const existe: Existe = j?.existe === 'si' || j?.existe === 'no' || j?.existe === 'parcial' ? j.existe : 'parcial';
  let respuesta = String(j?.respuesta ?? '').trim().slice(0, 1500);
  if (!respuesta) return SIN_RESPUESTA;
  if (existe !== 'si' && !/metogroup/i.test(respuesta)) respuesta = `${respuesta} ${HABLAR_CON_METOGROUP}`;
  const pasos = Array.isArray(j?.pasos)
    ? j.pasos.map((p: unknown) => String(p ?? '').trim()).filter(Boolean).slice(0, 8).map((p: string) => p.slice(0, 300))
    : [];
  const pantalla = typeof j?.pantalla === 'string' && pantallas.has(j.pantalla) ? j.pantalla : null;
  const seccion = typeof j?.seccion === 'string' && secciones.has(j.seccion) ? j.seccion : null;
  return { existe, respuesta, pasos: existe === 'no' ? [] : pasos, pantalla: existe === 'no' ? null : pantalla, seccion };
}

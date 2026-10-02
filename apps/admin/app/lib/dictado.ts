// La cuenta del dictado por voz (BotonMicrofono). Vive en el panel porque corre
// en el navegador; se prueba desde la API (apps/api/src/comun/dictado.spec.ts).
//
// 2/10/2026, «los audios se cortan a los 5 segundos»: el micrófono del panel
// escuchaba con continuous = false, así que el navegador lo cortaba en la
// primera pausa, y al volver a tocarlo lo nuevo BORRABA lo ya dictado (los
// llamadores pasaban setTexto). Ahora se escucha de corrido, se reinicia si el
// navegador corta solo y todo se SUMA a lo que ya había en la caja.

const limpiar = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim();
const llave = (t: string) => limpiar(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;:!?¡¿]/g, '');

// Suma un pedazo nuevo a lo que ya hay sin repetirlo. Chrome de Android, con
// escucha continua, a veces devuelve en cada resultado TODO lo dicho hasta ahí
// ("hola" → "hola necesito" → ...): si lo nuevo ya empieza con lo anterior, se
// queda con lo nuevo; si lo anterior ya termina con lo nuevo, no se agrega.
export function sumarDictado(previo: string, nuevo: string): string {
  const a = limpiar(previo);
  const b = limpiar(nuevo);
  if (!b) return a;
  if (!a) return b;
  const la = llave(a);
  const lb = llave(b);
  if (lb.startsWith(la)) return b;
  if (la.endsWith(lb)) return a;
  return `${a} ${b}`;
}

type Resultado = { isFinal: boolean; 0: { transcript: string } };

// Procesa un evento onresult: suma los resultados finales nuevos (desde
// resultIndex) a lo ya confirmado y devuelve también el parcial en curso.
export function procesarResultados(
  confirmado: string,
  resultados: ArrayLike<Resultado>,
  desde: number,
): { confirmado: string; parcial: string } {
  let conf = confirmado;
  let parcial = '';
  for (let i = Math.max(0, desde); i < resultados.length; i++) {
    const r = resultados[i];
    const t = r?.[0]?.transcript ?? '';
    if (r?.isFinal) conf = sumarDictado(conf, t);
    else parcial = sumarDictado(parcial, t);
  }
  return { confirmado: conf, parcial };
}

// Lo que se muestra en la caja: lo que había antes de tocar el micrófono, más
// lo dictado y confirmado, más lo que se está diciendo ahora.
export function textoDictado(base: string, confirmado: string, parcial: string): string {
  return sumarDictado(sumarDictado(base, confirmado), parcial);
}

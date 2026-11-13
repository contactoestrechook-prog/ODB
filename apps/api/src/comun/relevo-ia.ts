// ============================================================
// RELEVO DE LA IA (13/11/2026). Anabella, cargando facturas: «está tardando
// mucho el sistema en responder». El servidor y la base estaban bien (carga
// 0,03, la base en 26–158 ms); lo que ella esperaba era UNA respuesta del chat
// de la factura que se quedó trabada 140,7 s con 595 tokens. De las 179
// llamadas de ese chat en dos semanas, la mitad tardó 8 s o menos y el 99 %
// menos de 33 s: fue un pedido que quedó colgado del lado de la IA.
//
// Cortarlo y volver a empezar tiraría las respuestas largas de verdad (una de
// 4.220 tokens tardó 38 s y estaba bien). Por eso NO se corta: pasado
// `relevoMs` sale un SEGUNDO pedido igual y gana el que termine primero; el
// otro se cancela. Cuesta una llamada más solo en las que ya venían lentas.
// ============================================================

export type ConRelevo<T> = { valor: T; relevo: boolean; gano: 1 | 2 };

/**
 * Corre `pedir` y, si a los `relevoMs` no terminó, lo corre otra vez en
 * paralelo. Devuelve el primero que termine bien y cancela el otro con su
 * `signal`. Un error antes del relevo se informa enseguida (los reintentos por
 * error tienen su propio camino); después del relevo se espera al otro, y solo
 * si fallan los dos se informa el primer error.
 */
export function conRelevo<T>(
  pedir: (signal: AbortSignal) => Promise<T>,
  opciones: { relevoMs: number; alRelevar?: () => void },
): Promise<ConRelevo<T>> {
  return new Promise((resolve, reject) => {
    const controles: AbortController[] = [];
    let terminado = false;
    let pendientes = 0;
    let primerError: unknown = undefined;
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const parar = () => {
      if (reloj) clearTimeout(reloj);
      reloj = null;
    };
    const lanzar = (n: 1 | 2) => {
      const control = new AbortController();
      controles.push(control);
      pendientes++;
      let p: Promise<T>;
      try {
        p = Promise.resolve(pedir(control.signal));
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (valor) => {
          pendientes--;
          if (terminado) return;
          terminado = true;
          parar();
          for (const otro of controles) if (otro !== control) otro.abort();
          resolve({ valor, relevo: controles.length > 1, gano: n });
        },
        (e) => {
          pendientes--;
          if (terminado) return;
          if (primerError === undefined) primerError = e;
          if (pendientes > 0) return; // el otro sigue: puede salir bien
          terminado = true;
          parar();
          reject(primerError);
        },
      );
    };
    lanzar(1);
    reloj = setTimeout(() => {
      reloj = null;
      if (terminado) return;
      opciones.alRelevar?.();
      lanzar(2);
    }, opciones.relevoMs);
  });
}

/** Cuánto esperar antes del relevo: el valor de la variable (en segundos) o el de siempre. */
export function relevoMs(variable: string, porDefectoSegundos: number): number {
  const s = Number(process.env[variable]);
  return (Number.isFinite(s) && s > 0 ? s : porDefectoSegundos) * 1000;
}

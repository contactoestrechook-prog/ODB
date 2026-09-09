// Recorre una lista llamando a `fn`, con varias en vuelo a la vez pero sin
// arrancar más de una cada `espaciadoMs`. Sirve para APIs con tope por minuto:
// el tope lo marca el espaciado (60.000 / consultas por minuto) y el paralelo
// solo evita que la espera de cada respuesta desperdicie el cupo.
//
// Si `parar(e)` da true para un error (clave rechazada, sin cupo), no se arranca
// ninguna más y se devuelve el motivo; las que ya estaban en vuelo terminan.
export type Ritmo = { paralelo: number; espaciadoMs: number };

export async function recorrerConRitmo<T, R>(
  items: T[],
  ritmo: Ritmo,
  fn: (item: T, indice: number) => Promise<R>,
  parar?: (e: unknown) => boolean,
): Promise<{ resultados: (R | undefined)[]; errores: { indice: number; error: unknown }[]; motivoParada: string | null }> {
  const resultados: (R | undefined)[] = new Array(items.length).fill(undefined);
  const errores: { indice: number; error: unknown }[] = [];
  let motivoParada: string | null = null;
  let proximo = 0; // momento en que se puede arrancar la siguiente
  let siguiente = 0; // índice a tomar

  const dormir = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const espaciado = Math.max(0, ritmo.espaciadoMs);
  const paralelo = Math.max(1, Math.min(ritmo.paralelo, items.length || 1));

  const trabajador = async () => {
    while (true) {
      if (motivoParada) return;
      const i = siguiente++;
      if (i >= items.length) return;
      const ahora = Date.now();
      const arranca = Math.max(ahora, proximo);
      proximo = arranca + espaciado;
      await dormir(arranca - ahora);
      if (motivoParada) return;
      try {
        resultados[i] = await fn(items[i], i);
      } catch (e) {
        errores.push({ indice: i, error: e });
        if (parar?.(e)) motivoParada = e instanceof Error ? e.message : String(e);
      }
    }
  };

  await Promise.all(Array.from({ length: paralelo }, () => trabajador()));
  return { resultados, errores, motivoParada };
}

import { BadRequestException } from '@nestjs/common';

// Supabase devuelve como mucho 1.000 renglones por consulta. Los informes de
// 30 días (comandas, pagos, visitas) pasan ese tope enseguida, y sin esto los
// promedios saldrían de una parte de los datos sin avisar. `armar` tiene que
// devolver la consulta nueva cada vez, con un orden fijo.
export async function leerTodo<T = any>(armar: () => any, tope = 50_000): Promise<T[]> {
  const PAGINA = 1000;
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += PAGINA) {
    const { data, error } = await armar().range(desde, desde + PAGINA - 1);
    if (error) throw new BadRequestException(error.message);
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) break;
  }
  return filas;
}

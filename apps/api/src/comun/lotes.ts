// Traer filas por una lista de ids, de a lotes.
//
// Supabase manda los filtros en la URL: un `in('id', [...])` con 500 UUIDs
// arma una dirección de casi 20.000 caracteres y la llamada falla entera. Y
// como el resultado se suele leer con `data ?? []`, el error no se ve: la
// pantalla queda vacía como si de verdad no hubiera nada. Ya pasó con la lista
// del proveedor más grande (1.423 productos, se veía vacía).
//
// 100 por lote deja la URL en unos 4.000 caracteres, con margen de sobra.
export async function enLotes<T>(
  ids: string[],
  // el builder de Supabase es 'thenable' pero no una Promise: se acepta así
  consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamano = 100,
): Promise<T[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const salida: T[] = [];
  for (let i = 0; i < unicos.length; i += tamano) {
    const { data, error } = await consulta(unicos.slice(i, i + tamano));
    if (error) throw new Error(error.message); // nunca devolver vacío por un error
    salida.push(...(data ?? []));
  }
  return salida;
}

// Traer TODAS las filas de una consulta que puede devolver más de mil.
//
// PostgREST corta cualquier respuesta en 1.000 filas y no avisa: ni error, ni
// marca de que faltan. Ya nos mordió tres veces en un día — la lista de fotos
// pendientes decía 951 cuando faltaban 7.260, y la sincronización de fotos vio
// 1.000 productos de 10.240. Cuando una consulta puede pasar las mil filas,
// tiene que venir por acá.
//
// `consulta(desde, hasta)` tiene que aplicar `.range(desde, hasta)`.
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pagina = 1000,
  tope = 200_000,
): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; desde < tope; desde += pagina) {
    const { data, error } = await consulta(desde, desde + pagina - 1);
    if (error) throw new Error(error.message); // nunca devolver vacío por un error
    const filas = data ?? [];
    salida.push(...filas);
    if (filas.length < pagina) break;
  }
  return salida;
}

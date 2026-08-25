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

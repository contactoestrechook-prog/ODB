import { apiFetch } from '../../lib/api';
import { LibroIvaWorkspace } from '../ui/LibroIvaWorkspace';
import { Aviso } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

// Al imprimir sale solo el libro: se esconden el menú, la barra del celular y
// el buscador (los hermanos del contenido dentro de <main>) y el contenido va
// a todo el ancho de la hoja. <Pantalla> todavía no tiene una opción para esto.
const IMPRIMIBLE =
  'print:max-w-none print:p-0 [main:has(>&)>:not(&)]:print:hidden [main:has(>&)]:print:bg-white [main:has(>&)]:print:pl-0';

export default async function LibroIva() {
  let inicial: any = null;
  let error: string | null = null;
  try {
    const r = await apiFetch('/facturacion/libro-iva');
    if (r.ok) inicial = await r.json();
    else throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/libro-iva" className={IMPRIMIBLE}>
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <LibroIvaWorkspace inicial={inicial} />
      )}
    </Pantalla>
  );
}

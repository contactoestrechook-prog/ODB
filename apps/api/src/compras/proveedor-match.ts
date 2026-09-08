// Elegir el proveedor de la base para un comprobante leído.
//
// 2026-09-08: "BODEGA DIAMANDES S.A." (sin alta) se vinculaba a "BODEGA
// VISTALBA S.A." y la factura quedaba "✓ en el sistema" con el proveedor
// equivocado. La búsqueda tomaba la primera palabra "distintiva" del emisor,
// 'bodega' no figuraba entre las genéricas, y un ilike '%bodega%' limit 1
// trajo otra bodega. Dos candados que no dependen de adivinar palabras:
//   1. si el papel y el candidato tienen CUIT y no coinciden, no es el mismo;
//   2. la parte distintiva del candidato tiene que estar en lo leído (no
//      alcanza con compartir una palabra genérica).
const GENERICAS = new Set([
  'distribuidora', 'distribuidor', 'distribuciones', 'comercial', 'comercializadora', 'mayorista', 'mayoristas',
  'sociedad', 'anonima', 'srl', 'sa', 'sas', 'saci', 'sacif', 'saic', 'sc', 'ltda', 'limitada', 'inc', 'cia', 'compania',
  'industrias', 'industria', 'industrial', 'importadora', 'exportadora', 'importacion', 'exportacion',
  'bodega', 'bodegas', 'vinos', 'vinoteca', 'finca', 'fincas', 'grupo', 'empresa', 'empresas', 'hnos', 'hermanos',
  'productos', 'alimentos', 'alimenticia', 'alimenticios', 'alimentacion', 'bebidas', 'servicios', 'logistica',
  'argentina', 'argentino', 'sur', 'norte', 'este', 'oeste', 'centro', 'nuevo', 'nueva', 'san', 'santa', 'don', 'dona',
  'del', 'de', 'la', 'las', 'los', 'el', 'y', 'e', 'the', 'and', 'of',
]);

const digitos = (s: any) => String(s ?? '').replace(/\D/g, '');

export function tokensDistintivos(nombre: string): string[] {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERICAS.has(w));
}

export type ProveedorCandidato = { id: string; razon_social: string; cuit?: string | null };

export function elegirProveedor(
  detectado: { nombre?: string | null; cuit?: string | null },
  candidatos: ProveedorCandidato[],
): (ProveedorCandidato & { metodo: 'cuit' | 'nombre' }) | null {
  const cuit = digitos(detectado.cuit);
  if (cuit) {
    const porCuit = candidatos.find((p) => digitos(p.cuit) === cuit);
    if (porCuit) return { ...porCuit, metodo: 'cuit' };
  }
  const leidos = tokensDistintivos(detectado.nombre ?? '');
  if (!leidos.length) return null;
  let mejor: ProveedorCandidato | null = null;
  let mejorPuntaje = 0;
  for (const p of candidatos) {
    const propios = tokensDistintivos(p.razon_social);
    if (!propios.length) continue;
    const comunes = propios.filter((t) => leidos.includes(t));
    if (!comunes.length) continue;
    if (cuit && digitos(p.cuit) && digitos(p.cuit) !== cuit) continue; // candado 1
    const cobertura = comunes.length / propios.length;
    if (cobertura < 0.5) continue; // candado 2
    const puntaje = comunes.length + cobertura;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = p; }
  }
  return mejor ? { ...mejor, metodo: 'nombre' } : null;
}

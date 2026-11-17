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

/**
 * ¿El CUIT cumple su dígito verificador (módulo 11)? Un CUIT mal leído de una
 * foto casi nunca lo cumple.
 *
 * 17/11/2026: Oxxon y Ricardo Nini estaban cargados DOS veces. El lector leyó un
 * dígito mal (30714052081 por 30714052981; 30565747509 por 30565574759), el
 * CUIT no estaba en la base, el candado 1 descartaba al proveedor de verdad
 * «porque el CUIT no coincide», y administración terminaba dándolo de alta otra
 * vez. Desde ahí, lo aprendido de ese proveedor quedaba partido en dos fichas.
 */
export function cuitValido(cuit: unknown): boolean {
  const d = digitos(cuit);
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((t, peso, k) => t + peso * Number(d[k]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return verificador === Number(d[10]);
}

/** ¿Los dos CUIT difieren en un solo dígito? */
const aUnDigito = (a: string, b: string) => a.length === 11 && b.length === 11 && [...a].filter((c, k) => c !== b[k]).length === 1;

export function elegirProveedor(
  detectado: { nombre?: string | null; cuit?: string | null },
  candidatos: ProveedorCandidato[],
): (ProveedorCandidato & { metodo: 'cuit' | 'nombre' }) | null {
  const leido = digitos(detectado.cuit);
  if (leido) {
    const porCuit = candidatos.find((p) => digitos(p.cuit) === leido);
    if (porCuit) return { ...porCuit, metodo: 'cuit' };
  }
  // Un CUIT que no cumple su dígito verificador está mal leído (17/11/2026): si
  // hay UN proveedor con un CUIT válido a un dígito de distancia, es ese. Y de
  // ahí en más no cuenta como CUIT: no puede descartar a nadie por «no coincidir».
  const cuit = cuitValido(leido) ? leido : '';
  if (leido.length === 11 && !cuit) {
    const cercanos = candidatos.filter((p) => cuitValido(p.cuit) && aUnDigito(digitos(p.cuit), leido));
    if (cercanos.length === 1) return { ...cercanos[0], metodo: 'cuit' };
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
    // entre dos fichas del mismo proveedor (una dada de alta con el CUIT mal leído), la del CUIT válido
    const puntaje = comunes.length + cobertura + (cuitValido(p.cuit) ? 0.01 : 0);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = p; }
  }
  return mejor ? { ...mejor, metodo: 'nombre' } : null;
}

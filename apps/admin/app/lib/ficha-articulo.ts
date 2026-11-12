// ============================================================
// LA FICHA DEL ARTÍCULO, EN LA TABLA (11/11/2026). Leandro: «memoria para cada
// proveedor … para que no falle más».
//
// La API guarda, por artículo de cada proveedor, cómo viene y cómo entra según
// lo último que se registró (apps/api/src/compras/ficha-articulo.ts). Acá se
// convierte esa ficha en los mismos cambios que hace el chat sobre la tabla
// (aplicarCambiosIA): no hay un camino nuevo para tocar un renglón.
//
// La ficha NO se aplica a ciegas. El lector no siempre arma el papel igual: la
// Rhodesia vino una vez como «1 caja a precio de caja» y se registró como «1
// bulto × 36 a precio de unidad». Por eso:
//
//   1. Se calcula cuánto tendría que entrar: la cantidad del papel × el factor
//      de la ficha, o las unidades del papel × lo que entra por unidad. Si dan
//      distinto, gana la que deja el COSTO por unidad parecido al de la última
//      vez (la otra lo deja 12 o 36 veces más caro o más barato).
//   2. Se prueban las formas de llegar ahí (cambiar cómo entra, agrupar de a N,
//      abrir la caja, reescribir el bulto) y se queda con la primera que deja
//      esa cantidad Y sigue dando el importe impreso.
//   3. Nunca una fracción de algo que no va por peso.
//
// Si nada cumple, el renglón queda como se leyó y se avisa.
//
// Funciones puras, sin React. Las prueban los tests de la API
// (apps/api/src/compras/ficha-articulo.spec.ts).
// ============================================================
import { aplicarCambiosIA, cuentaDelPapel, papelDeLectura, type CambioIA, type Papel } from './tabla-factura';

export type FichaArticulo = {
  cuentaEn: 'bultos' | 'sueltas';
  unidadesPorBulto: number | null;
  entraComo: 'unidades' | 'cajas' | 'abiertas' | 'peso';
  entraDe: number | null;
  /** cuánto entra al stock por cada 1 de la columna Cantidad (kilos si va por peso) */
  factor: number | null;
  /** cuánto entra por cada unidad del papel (bultos × lo que trae cada uno, o las sueltas) */
  porUnidad?: number | null;
  /** lo que costó cada unidad de stock la última vez, neto */
  costoNeto?: number | null;
  veces: number;
  ultimaFactura: string | null;
  ultimaFecha: string | null;
  por?: 'descripcion' | 'producto';
};

export type EstadoFicha =
  | 'sin_ficha'    // el artículo no vino antes
  | 'ya_estaba'    // la lectura ya lo dejó como dice la ficha
  | 'aplicada'     // se cambió para que quede como la última vez
  | 'no_cierra'    // con la ficha, la cuenta del renglón no da: queda como se leyó
  | 'no_aplica';   // descuento, devolución, peso sin kilos fijos, o no se puede saber cuál de dos lecturas es

type Cambio = Omit<CambioIA, 'renglon' | 'motivo'>;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const cerca = (a: number | null, b: number, tol = 0.002) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const esEntero = (x: number) => Math.abs(x - Math.round(x)) <= 0.001;

/** La cantidad de la columna Cantidad del papel: los bultos o las sueltas, si cuenta una sola cosa. */
export function cantidadDelPapel(papel: Papel | null | undefined): number | null {
  const b = num(papel?.bultos) ?? 0;
  const s = num(papel?.sueltas) ?? 0;
  if (b > 0 === s > 0) return null;
  return b > 0 ? b : s;
}

/** «3.5», «3,5» o «5» escritos en la descripción («HORMA 3.5 KG», «x 5 kilos») */
function laDescripcionTrae(descripcion: unknown, valor: number): boolean {
  const numeros = String(descripcion ?? '').match(/\d+(?:[.,]\d+)?/g) ?? [];
  return numeros.some((t) => cerca(Number(t.replace(',', '.')), valor, 0.001));
}

function motivoDe(ficha: FichaArticulo): string {
  const f = ficha.ultimaFecha && /^\d{4}-\d{2}-\d{2}/.test(ficha.ultimaFecha) ? ` del ${ficha.ultimaFecha.slice(8, 10)}/${ficha.ultimaFecha.slice(5, 7)}` : '';
  const de = ficha.ultimaFactura ? ` (factura ${ficha.ultimaFactura}${f})` : f ? ` (${f.trim()})` : '';
  return `Como la última vez${de}${ficha.veces > 1 ? ` · ${ficha.veces} veces igual` : ''}`;
}

/**
 * Cuánto tiene que entrar, según la ficha. Devuelve null si hay dos cuentas
 * posibles y el costo no alcanza para elegir una.
 */
function cuantoEntra(ficha: FichaArticulo, papel: Papel, importe: number): number | null {
  const q = cantidadDelPapel(papel);
  const u = cuentaDelPapel(papel).unidades;
  const f = num(ficha.factor);
  const pu = num(ficha.porUnidad);
  const objetivos: number[] = [];
  const sumar = (x: number | null) => { if (x != null && x > 0 && esEntero(x) && !objetivos.some((o) => cerca(o, x))) objetivos.push(Math.round(x)); };
  if (q != null && f != null) sumar(q * f);
  if (u > 0 && pu != null) sumar(u * pu);
  if (!objetivos.length) return null;
  if (objetivos.length === 1) return objetivos[0];
  // dos cuentas distintas: la buena deja el costo por unidad cerca del de la última vez
  const costo = num(ficha.costoNeto);
  if (costo == null || !(costo > 0) || !(importe > 0)) return null;
  const lejos = (t: number) => Math.abs(Math.log(importe / t / costo));
  const [mejor, otra] = [...objetivos].sort((a, b) => lejos(a) - lejos(b));
  // la buena, a menos de ×2,5 del costo; y la otra, bastante más lejos
  return lejos(mejor) <= Math.log(2.5) && lejos(otra) - lejos(mejor) >= Math.log(1.5) ? mejor : null;
}

/**
 * Los cambios para que UN renglón quede como dice su ficha. `renglon` empieza
 * en 1, como en aplicarCambiosIA.
 */
export function cambiosDeFicha<T extends Record<string, any>>(
  fila: T,
  ficha: FichaArticulo | null | undefined,
  renglon: number,
  esDescuento: (f: T) => boolean,
): { estado: EstadoFicha; cambios: CambioIA[] } {
  const nada = (estado: EstadoFicha) => ({ estado, cambios: [] as CambioIA[] });
  if (!ficha) return nada('sin_ficha');
  if (!fila || esDescuento(fila) || fila.esDevolucion || fila.devueltoAMano) return nada('no_aplica');
  const motivo = motivoDe(ficha);
  const probar = (lista: Cambio[]) => {
    const r = aplicarCambiosIA([fila], lista.map((c) => ({ ...c, renglon: 1, motivo })), esDescuento);
    return r.descartados.length ? null : r.items[0];
  };
  const salida = (lista: Cambio[]) => lista.map((c) => ({ ...c, renglon, motivo }));

  // ---- por peso ----
  if (ficha.entraComo === 'peso') {
    if (fila.porPeso) return nada('ya_estaba');
    const f = num(ficha.factor);
    // el papel ya trae los kilos y esta vez no se leyeron así: no hay con qué calcularlos
    if (f == null || !(f > 0)) return nada('no_aplica');
    const papel: Papel = fila.papel ?? papelDeLectura(fila);
    const q = cantidadDelPapel(papel);
    if (q == null) return nada('no_aplica');
    // Los kilos por pieza valen solo si son fijos: la cantidad ya son los kilos,
    // la descripción los dice («HORMA 3.5 KG») o se registró igual dos veces.
    // Un salame de peso variable no se adivina.
    const fijos = cerca(f, 1, 0.001) || ficha.veces >= 2 || laDescripcionTrae(fila.descripcion, f);
    if (!fijos) return nada('no_aplica');
    const kilos = Math.round(q * f * 1000) / 1000;
    const lista: Cambio[] = [{ campo: 'kilos', valor: kilos }];
    const final = probar(lista);
    return final && final.porPeso && cerca(num(final.cantidad), kilos) ? { estado: 'aplicada', cambios: salida(lista) } : nada('no_cierra');
  }

  // ---- por unidad, por caja o abierto ----
  // la lectura lo dejó por peso y la ficha dice que no: lo decide una persona
  if (fila.porPeso || !fila.papel) return nada('no_aplica');
  const papel: Papel = fila.papel;
  const importe = Math.abs(num(papel.importe) ?? num(fila.importe) ?? 0);
  const esperado = cuantoEntra(ficha, papel, importe);
  if (esperado == null) return nada('no_aplica');
  const cumple = (x: T | null) => {
    if (!x || x.porPeso || !cerca(num(x.cantidad), esperado)) return false;
    // quedó decidido (no «pendiente») y la cuenta del papel da el importe impreso
    if ((num(x.unidadesPorBulto) ?? 0) > 1) return false;
    const p: Papel | null = x.papel ?? null;
    return !p || num(p.importe) == null || cuentaDelPapel(p).cierra;
  };
  if (cumple(fila)) return nada('ya_estaba');

  const de = num(ficha.entraDe);
  const uxb = num(ficha.unidadesPorBulto);
  const q = cantidadDelPapel(papel);
  // cómo entra: primero como dice la ficha, después las otras formas (el lector
  // pudo armar el papel distinto y a la misma cantidad se llega por otro lado)
  const propia: Cambio[] = ficha.entraComo === 'cajas' ? [{ campo: 'entraComo', valor: 'cajas' }] : [{ campo: 'entraComo', valor: ficha.entraComo }];
  const formas: Cambio[][] = [
    propia,
    ...(de != null && de > 1 ? [[{ campo: 'unidadesPorVenta', valor: de }]] : []),
    [{ campo: 'entraComo', valor: 'unidades' }],
    [{ campo: 'entraComo', valor: 'abiertas' }],
    [{ campo: 'entraComo', valor: 'cajas' }],
  ];
  // qué dice el papel antes de decidir cómo entra
  const antes: Cambio[][] = [
    [], // como se leyó
    ...(uxb != null && uxb > 1 ? [[{ campo: 'unidadesPorBulto', valor: uxb }]] : []), // lo que trae el bulto, según la ficha
    ...(de != null && de > 1 && de !== uxb ? [[{ campo: 'unidadesPorBulto', valor: de }]] : []),
    ...(q != null ? [[{ campo: 'bultos', valor: q }, { campo: 'unidadesPorBulto', valor: uxb }, { campo: 'sueltas', valor: 0 }]] : []), // la cantidad son bultos
    ...(q != null ? [[{ campo: 'sueltas', valor: q }, { campo: 'bultos', valor: 0 }, ...(uxb != null ? [{ campo: 'unidadesPorBulto', valor: uxb }] : [])]] : []), // la cantidad son sueltas
  ];
  for (const a of antes) {
    for (const forma of formas) {
      const lista = [...a, ...forma];
      if (cumple(probar(lista))) return { estado: 'aplicada', cambios: salida(lista) };
    }
  }
  return nada('no_cierra');
}

/** Todos los renglones de una factura contra sus fichas (misma posición en las dos listas). */
export function cambiosDeFichas<T extends Record<string, any>>(
  filas: T[],
  fichas: (FichaArticulo | null | undefined)[],
  esDescuento: (f: T) => boolean,
): { cambios: CambioIA[]; aplicadas: number[]; yaEstaban: number[]; noCierran: number[] } {
  const cambios: CambioIA[] = [];
  const aplicadas: number[] = [];
  const yaEstaban: number[] = [];
  const noCierran: number[] = [];
  if (!Array.isArray(fichas) || fichas.length !== filas.length) return { cambios, aplicadas, yaEstaban, noCierran };
  filas.forEach((fila, k) => {
    const r = cambiosDeFicha(fila, fichas[k], k + 1, esDescuento);
    if (r.estado === 'aplicada') { cambios.push(...r.cambios); aplicadas.push(k + 1); }
    else if (r.estado === 'ya_estaba') yaEstaban.push(k + 1);
    else if (r.estado === 'no_cierra') noCierran.push(k + 1);
  });
  return { cambios, aplicadas, yaEstaban, noCierran };
}

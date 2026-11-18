// ============================================================
// LA FORMA DEL PROVEEDOR (17/11/2026). Leandro: «Ana le tiene que explicar y
// no aprende: cuando vuelve a cargar otra del mismo proveedor se vuelve a
// confundir en lo mismo».
//
// Medido ese día sobre todo lo registrado: de 555 renglones de mercadería, 488
// eran artículos que venían POR PRIMERA VEZ. La ficha del artículo (11/11) solo
// recuerda el artículo exacto, y no arregló ni uno. Lo que se repite de una
// factura a la otra no es el artículo: es CÓMO ESCRIBE EL PAPEL ese proveedor.
//
//   La Farina: «Figacita de manteca x 9 unidades», cantidad 24 → son 24
//   paquetes y entran tal cual. Vale igual para las figazas x 6, los chips x 9
//   y lo próximo que traiga con «x N».
//   Tronador: «FRANUI LECHE CAJA X 24», cantidad 2 → son 2 cajas y entran 48.
//
// Más de la mitad de lo que se corrige a mano (76 de 132) es esa misma
// pregunta: el renglón dice «×N» y nadie decidió todavía si la cantidad son
// paquetes que entran tal cual o bultos que se abren. Cada proveedor contesta
// siempre igual.
//
// Acá se junta, por proveedor, qué pasó con esos renglones en las facturas ya
// registradas, y si la respuesta fue siempre la misma se arma una ficha para
// el artículo nuevo. Esa ficha pasa por el mismo camino que la del artículo
// (lib/ficha-articulo.ts): se aplica solo si la cuenta del renglón sigue dando
// el importe impreso, y el freno del costo de catálogo la puede volver atrás.
// Si el proveedor contestó de las dos maneras, no se decide nada.
//
// Funciones puras, sin React. Las prueban los tests de la API
// (apps/api/src/compras/forma-proveedor.spec.ts).
// ============================================================
import { cantidadDelPapel, type FichaArticulo } from './ficha-articulo';
import { papelDeLectura, type Papel } from './tabla-factura';

/** Cómo quedó leída la cantidad de un renglón con «×N» sin decidir: en la columna de bultos o como cantidad suelta. */
export type Firma = 'sueltas' | 'bultos';
/** Qué terminó entrando: la cantidad tal cual, o la cantidad × lo que trae cada bulto. */
export type Salida = 'tal_cual' | 'abre';

/** Un renglón ya registrado de este proveedor, con lo que se había leído de él. */
export type Antecedente = {
  /** el renglón como lo guardó el lector (lecturas_comprobante.resultado.items[k]) */
  leido: any;
  registrado: {
    descripcion?: string | null;
    bultos?: number | null;
    unidadesPorBulto?: number | null;
    sueltas?: number | null;
    entraComo?: string | null;
    cantidadStock?: number | null;
    incluido?: boolean | null;
    esDescuento?: boolean | null;
  };
};

export type Cuenta = { talCual: number; abre: number; otra: number };
/** Un artículo que votó: cuántas trae su «x N» y cuánto sale cada unidad de las que entraron al stock. */
export type Caso = { salida: Salida | 'otra'; n: number; precioUnidad: number | null };
export type Forma = Record<Firma, Cuenta> & { casos?: Record<Firma, Caso[]> };
export type Decision = { salida: Salida; casos: number; total: number };

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const cerca = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= 0.002 * Math.max(1, Math.abs(b));
const clave = (d: unknown) => String(d ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** El renglón del lector, reducido a lo que mira la forma (igual que lo arma la pantalla al cargar una lectura). */
export function filaLeida(i: any): { cantidad: unknown; porPeso: boolean; unidadesPorBulto: number | null; papel: Papel | null; esDevolucion: boolean; devueltoAMano: boolean } {
  const r = i?.interpretado ?? {};
  const porPeso = !!r.porPeso;
  return {
    cantidad: r.cantidad ?? i?.cantidad ?? '',
    porPeso,
    unidadesPorBulto: num(r.unidadesPorBulto),
    esDevolucion: !!i?.esDevolucion,
    devueltoAMano: !!i?.devueltoAMano,
    papel: i?.esDescuento || i?.esDevolucion || porPeso ? null : papelDeLectura({ ...i, unidadesDelCatalogo: i?.unidadesDelCatalogo ?? null }),
  };
}

/**
 * La firma de un renglón: solo la tienen los que dicen «×N» y quedaron sin
 * decidir (bulto pendiente). Los demás no son la pregunta de la forma.
 */
export function firmaDe(fila: any): Firma | null {
  if (!fila || fila.porPeso || fila.esDevolucion || fila.devueltoAMano || !fila.papel) return null;
  if (!((num(fila.unidadesPorBulto) ?? 0) > 1) || !((num(fila.papel.uxb) ?? 0) > 1)) return null;
  if (cantidadDelPapel(fila.papel) == null) return null;
  return (num(fila.papel.bultos) ?? 0) > 0 ? 'bultos' : 'sueltas';
}

/** Qué pasó con un renglón sin decidir cuando se registró. null: de ese renglón no se aprende. */
export function salidaDe(fila: any, reg: Antecedente['registrado']): Salida | 'otra' | null {
  if (!reg || reg.esDescuento || reg.incluido === false) return null;
  const q = cantidadDelPapel(fila.papel);
  const n = num(fila.papel?.uxb);
  if (q == null || n == null || !(n > 1)) return null;
  const como = String(reg.entraComo ?? '');
  if (como !== 'unidades' && como !== 'abiertas' && como !== 'cajas' && como !== 'peso') return null;
  if (como === 'peso' || como === 'cajas') return 'otra';
  const entro = num(reg.cantidadStock);
  // lo facturado, como quedó escrito al registrar (aunque haya llegado una parte)
  const b = num(reg.bultos) ?? 0;
  const s = num(reg.sueltas) ?? 0;
  const uReg = (num(reg.unidadesPorBulto) ?? 0) > 1 ? (num(reg.unidadesPorBulto) as number) : 1;
  const delPapel = b * uReg + s;
  const facturado = como === 'abiertas' ? delPapel * uReg : delPapel;
  if (cerca(entro, q) || (como === 'unidades' && cerca(facturado, q))) return 'tal_cual';
  if (cerca(entro, q * n) || cerca(facturado, q * n)) return 'abre';
  return 'otra';
}

/** Lo que sale la unidad que entra al stock: el precio del papel, o el de la caja repartido si se abre. */
function precioDeLaUnidad(firma: Firma, salida: Salida, papel: Papel | null | undefined): number | null {
  const precio = num(papel?.precio);
  const n = num(papel?.uxb);
  if (precio == null || !(precio > 0)) return null;
  return salida === 'abre' && firma === 'sueltas' && n != null && n > 1 ? precio / n : precio;
}

/**
 * SE PARECE A LO QUE EL PROVEEDOR YA MOSTRÓ (18/11/2026). La Farina trae
 * paquetes «x 4», «x 6» y «x 9» de $2.154 a $3.770 que entran tal cual: 4 de 4.
 * Ese día vino por primera vez «Medialunas de manteca cruda congelada x 144
 * unidades», 1 × $64.690, y la forma la dejó entrando como UNA unidad de
 * $64.690. Ana la tuvo que pasar a 144. Una caja de 144 a veinte veces el
 * precio no es «otro paquete de los suyos».
 *
 * Una costumbre es un GRUPO de artículos que entraron igual («tal cual» o «se
 * abren»), y tiene su franja: cuántas trae el «x N» y lo que sale cada unidad
 * que entra al stock, hasta cuatro veces más o cuatro veces menos que lo visto.
 *  · Un artículo nuevo la sigue solo si cae adentro de esa franja.
 *  · Los artículos que hicieron otra cosa la desmienten solo si también caen
 *    adentro: la caja de 144, ya registrada abierta, no le saca la costumbre a
 *    los paquetes de 9; un proveedor que con artículos parecidos contestó de las
 *    dos maneras sigue sin decidir.
 * Si el renglón entra en las dos costumbres, o en ninguna, lo mira una persona.
 */
const HOLGURA = 4;
const enFranja = (x: number | null, vistos: (number | null)[]) => {
  const v = vistos.filter((y): y is number => y != null && y > 0);
  return x == null || !(x > 0) || !v.length || (x <= Math.max(...v) * HOLGURA && x >= Math.min(...v) / HOLGURA);
};

/**
 * La cuenta de la costumbre que le toca a este renglón: los artículos del grupo
 * y los que, pareciéndose, hicieron otra cosa. null si no le toca ninguna (o le
 * tocan las dos).
 */
export function cuentaParecida(fila: any, firma: Firma, forma: Forma | null | undefined): Cuenta | null {
  if (!forma) return null;
  const casos = forma.casos?.[firma];
  if (!casos) return forma[firma];
  const cuentas: Cuenta[] = [];
  for (const salida of ['tal_cual', 'abre'] as const) {
    const grupo = casos.filter((c) => c.salida === salida);
    if (grupo.length < 2) continue;
    const adentro = (n: number | null, precio: number | null) => enFranja(n, grupo.map((c) => c.n)) && enFranja(precio, grupo.map((c) => c.precioUnidad));
    if (!adentro(num(fila?.papel?.uxb), precioDeLaUnidad(firma, salida, fila?.papel))) continue;
    const cuenta: Cuenta = { talCual: 0, abre: 0, otra: 0 };
    for (const c of casos) {
      if (c.salida !== salida && !adentro(c.n, c.precioUnidad)) continue;
      cuenta[c.salida === 'tal_cual' ? 'talCual' : c.salida === 'abre' ? 'abre' : 'otra']++;
    }
    cuentas.push(cuenta);
  }
  return cuentas.length === 1 ? cuentas[0] : null;
}

/** Junta los antecedentes de un proveedor: un voto por artículo (el más nuevo manda). */
export function formaDe(antecedentes: Antecedente[] | null | undefined): Forma {
  const forma: Forma = { sueltas: { talCual: 0, abre: 0, otra: 0 }, bultos: { talCual: 0, abre: 0, otra: 0 } };
  const casos: Record<Firma, Caso[]> = { sueltas: [], bultos: [] };
  const vistos = new Set<string>();
  for (const a of antecedentes ?? []) {
    const fila = filaLeida(a?.leido);
    const firma = firmaDe(fila);
    if (!firma) continue;
    const salida = salidaDe(fila, a.registrado);
    if (!salida) continue;
    const k = `${firma}|${clave(a.registrado?.descripcion ?? a.leido?.descripcion)}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    forma[firma][salida === 'tal_cual' ? 'talCual' : salida === 'abre' ? 'abre' : 'otra']++;
    casos[firma].push({ salida, n: num(fila.papel?.uxb) ?? 0, precioUnidad: salida === 'otra' ? null : precioDeLaUnidad(firma, salida, fila.papel) });
  }
  // aparte de la cuenta, para saber si un artículo nuevo se parece a los que votaron
  Object.defineProperty(forma, 'casos', { value: casos, enumerable: false });
  return forma;
}

/**
 * ¿El proveedor contestó siempre igual? Hacen falta al menos 2 artículos
 * distintos, y todos de acuerdo; con 6 o más se tolera uno distinto cada diez.
 */
export function decidir(forma: Forma | null | undefined, firma: Firma | null): Decision | null {
  if (!forma || !firma) return null;
  return decidirCuenta(forma[firma]);
}
export function decidirCuenta(c: Cuenta | null | undefined): Decision | null {
  if (!c) return null;
  const total = c.talCual + c.abre + c.otra;
  if (total < 2) return null;
  const [salida, casos]: [Salida, number] = c.talCual >= c.abre ? ['tal_cual', c.talCual] : ['abre', c.abre];
  const alcanza = total >= 6 ? casos / total >= 0.9 : casos === total;
  return alcanza ? { salida, casos, total } : null;
}

/**
 * La ficha para un artículo que nunca vino, armada con la forma del proveedor.
 * null si el renglón no es de los que la forma decide, o el proveedor no
 * contestó siempre igual.
 */
export function fichaDeForma(fila: any, forma: Forma | null | undefined, proveedor?: string | null): FichaArticulo | null {
  const firma = firmaDe(fila);
  if (!firma) return null;
  // con los artículos de este proveedor que se parecen a este renglón (ver cuentaParecida)
  const d = decidirCuenta(cuentaParecida(fila, firma, forma));
  if (!d) return null;
  // Lo que el propio renglón ya muestra manda sobre la costumbre del proveedor: si
  // el lector sugiere lo contrario (por el costo del catálogo o por una columna
  // del papel), no se decide y lo mira una persona, como hasta ahora.
  const sugerencia = String(fila.razonBulto?.sugerencia ?? '');
  if (d.salida === 'tal_cual' && sugerencia === 'convertir') return null;
  if (d.salida === 'abre' && (sugerencia === 'unidades' || sugerencia === 'caja')) return null;
  const n = num(fila.papel.uxb) as number;
  const de = proveedor ? `los artículos de ${proveedor}` : 'los artículos de este proveedor';
  const veces = `${d.casos} de ${d.total}`;
  const base = { unidadesPorBulto: n, costoNeto: null, veces: d.casos, ultimaFactura: null, ultimaFecha: null, por: 'forma' as const };
  if (d.salida === 'tal_cual') {
    return {
      ...base, cuentaEn: 'sueltas', entraComo: 'unidades', entraDe: null, factor: 1, porUnidad: firma === 'sueltas' ? 1 : null,
      porque: `Como entran ${de} que dicen «x N»: la cantidad ya son los paquetes y entran tal cual (${veces} artículos)`,
    };
  }
  return firma === 'sueltas'
    ? {
      ...base, cuentaEn: 'sueltas', entraComo: 'abiertas', entraDe: n, factor: n, porUnidad: n,
      porque: `Como entran ${de} que dicen «x N»: la cantidad son bultos y se abren (${veces} artículos)`,
    }
    : {
      ...base, cuentaEn: 'bultos', entraComo: 'unidades', entraDe: null, factor: n, porUnidad: 1,
      porque: `Como entran ${de} que dicen «x N»: la cantidad son bultos y se abren (${veces} artículos)`,
    };
}

/**
 * Las fichas de una factura, completadas con la forma del proveedor: donde el
 * artículo ya tiene su ficha, manda esa; donde no, la de la forma (si decide).
 */
export function fichasConForma<F extends FichaArticulo>(
  filas: any[],
  fichas: (F | null | undefined)[],
  antecedentes: Antecedente[] | null | undefined,
  proveedor?: string | null,
): { fichas: (FichaArticulo | null)[]; porForma: number[] } {
  const porForma: number[] = [];
  if (!Array.isArray(fichas) || fichas.length !== filas.length) return { fichas: (fichas ?? []).map((f) => f ?? null), porForma };
  const forma = antecedentes?.length ? formaDe(antecedentes) : null;
  const salida = filas.map((fila, k) => {
    if (fichas[k]) return fichas[k] as FichaArticulo;
    const f = forma ? fichaDeForma(fila, forma, proveedor) : null;
    if (f) porForma.push(k + 1);
    return f;
  });
  return { fichas: salida, porForma };
}

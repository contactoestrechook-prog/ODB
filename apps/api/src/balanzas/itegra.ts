// La lista de PLU para las balanzas Kretz, en el archivo que importa iTegra
// (Leandro, 11/11/2026: «sí, armala»).
//
// NÚCLEO lee la etiqueta de la balanza (catalogo/balanza.ts: 2 + PLU de 6 +
// gramos de 5 + control) y cobra con la lista Minorista. Este archivo es el
// camino de vuelta: que la balanza tenga el mismo nombre y precio. En iTegra:
// Archivo › Importar › Desde archivo › PLU's, «importar desde la fila 2»,
// separador «caracteres especiales» con «;», y los campos en este orden
// (instructivo de Kretz «Enviar PLU a balanza Report NX», 2017):
export const COLUMNAS_ITEGRA = [
  'Numero de PLU',
  'Codigo de PLU',
  'Nombre de PLU',
  'Tipo de PLU',
  'Precio',
  'Codigo de Departamento',
  'Codigo de etiqueta',
] as const;

// Lo que devuelve balanza_lista() (db/migracion-balanzas.sql)
export type FilaBalanza = {
  producto_id: string;
  sku: string;
  nombre: string;
  plu: string | null;
  por_peso: boolean;
  en_balanza: boolean;
  precio: number | string | null;
  precio_desde: string | null;
};

// P = pesable (precio por kilo), N = no pesable (precio por unidad): así lo
// escribe el instructivo de Kretz.
export type TipoPlu = 'P' | 'N';

export type ItemBalanza = {
  plu: string; // sin ceros adelante: el mismo número que la caja lee de la etiqueta
  nombre: string; // como lo imprime la balanza
  nombreSistema: string;
  sku: string;
  tipo: TipoPlu;
  precio: number;
  precioDesde: string | null;
  porUnidadSumado: boolean; // va por unidad porque alguien lo sumó (en_balanza)
};

export type MotivoProblema = 'sin_plu' | 'plu_repetido' | 'sin_precio';
export type ProblemaBalanza = { sku: string; nombre: string; plu: string | null; motivo: MotivoProblema };

// Lo que se guarda de cada bajada para saber qué cambió después
export type FotoItem = { plu: string; nombre: string; tipo: TipoPlu; precio: number };
export type TipoCambio = 'alta' | 'precio' | 'nombre' | 'tipo' | 'baja';
export type CambioBalanza = { plu: string; nombre: string; cambios: TipoCambio[]; antes: FotoItem | null; ahora: FotoItem | null };

// El PLU entra en 6 lugares de la etiqueta. Se guarda sin ceros adelante, igual
// que lo compara la caja (catalogo.service.ts).
export function pluValido(plu: string | null | undefined): string | null {
  const t = String(plu ?? '').trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  const sin = t.replace(/^0+/, '');
  return sin || null;
}

// El nombre en la balanza: mayúsculas y solo letras y números comunes, porque
// las balanzas viejas no imprimen tildes y un «;» rompería el archivo. Se saca
// el «x fracción» / «x peso» / «x kg» del final: en la etiqueta sobra.
export function nombreParaBalanza(nombre: string): string {
  let t = String(nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,%/()+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // «FRACCCION» y «FRACC.» también: así vienen escritos algunos del Crack
  t = t.replace(/\s+X\s*(FRAC+I?O?N?|PESO|KGS?|KILO)\.?$/, '').trim();
  return t || 'SIN NOMBRE';
}

// Precio con coma decimal, como lo guarda un Excel en castellano. Los de ODB
// son enteros (11/11/2026: los 265 por peso), y así van, sin decimales.
export function precioTexto(precio: number): string {
  const r = Math.round(precio * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',');
}

export function armarLista(filas: FilaBalanza[]): { items: ItemBalanza[]; problemas: ProblemaBalanza[] } {
  const problemas: ProblemaBalanza[] = [];
  const candidatos: ItemBalanza[] = [];
  for (const f of filas) {
    const plu = pluValido(f.plu);
    if (!plu) { problemas.push({ sku: f.sku, nombre: f.nombre, plu: f.plu ?? null, motivo: 'sin_plu' }); continue; }
    const precio = f.precio == null ? NaN : Number(f.precio);
    if (!(precio > 0)) { problemas.push({ sku: f.sku, nombre: f.nombre, plu, motivo: 'sin_precio' }); continue; }
    candidatos.push({
      plu,
      nombre: nombreParaBalanza(f.nombre),
      nombreSistema: f.nombre,
      sku: f.sku,
      tipo: f.por_peso ? 'P' : 'N',
      precio,
      precioDesde: f.precio_desde ?? null,
      porUnidadSumado: !f.por_peso && !!f.en_balanza,
    });
  }
  // Dos productos con el mismo PLU: la balanza tiene uno solo y la caja no sabe
  // cuál cobrar. No va ninguno de los dos hasta que se corrija.
  const cuenta = new Map<string, number>();
  for (const c of candidatos) cuenta.set(c.plu, (cuenta.get(c.plu) ?? 0) + 1);
  const items: ItemBalanza[] = [];
  for (const c of candidatos) {
    if ((cuenta.get(c.plu) ?? 0) > 1) problemas.push({ sku: c.sku, nombre: c.nombreSistema, plu: c.plu, motivo: 'plu_repetido' });
    else items.push(c);
  }
  items.sort((a, b) => Number(a.plu) - Number(b.plu));
  return { items, problemas };
}

// El archivo: encabezado (por eso «importar desde la fila 2»), una fila por
// PLU, fin de línea de Windows. El Número de PLU es el mismo Código: es el
// número que se marca en la balanza y el que sale en la etiqueta.
export function csvItegra(items: Pick<ItemBalanza, 'plu' | 'nombre' | 'tipo' | 'precio'>[]): string {
  const filas = [COLUMNAS_ITEGRA.join(';')];
  for (const i of items) filas.push([i.plu, i.plu, i.nombre, i.tipo, precioTexto(i.precio), '1', '1'].join(';'));
  return filas.join('\r\n') + '\r\n';
}

export function foto(items: ItemBalanza[]): FotoItem[] {
  return items.map((i) => ({ plu: i.plu, nombre: i.nombre, tipo: i.tipo, precio: i.precio }));
}

// Qué cambió desde la última bajada. Las bajas no se mandan (iTegra no borra al
// importar): se muestran para sacarlas a mano de la balanza.
export function compararListas(actual: FotoItem[], anterior: FotoItem[]): CambioBalanza[] {
  const antes = new Map(anterior.map((a) => [a.plu, a]));
  const ahoraMapa = new Map(actual.map((a) => [a.plu, a]));
  const cambios: CambioBalanza[] = [];
  for (const a of actual) {
    const b = antes.get(a.plu);
    if (!b) { cambios.push({ plu: a.plu, nombre: a.nombre, cambios: ['alta'], antes: null, ahora: a }); continue; }
    const tipos: TipoCambio[] = [];
    if (Number(b.precio) !== Number(a.precio)) tipos.push('precio');
    if (b.nombre !== a.nombre) tipos.push('nombre');
    if (b.tipo !== a.tipo) tipos.push('tipo');
    if (tipos.length) cambios.push({ plu: a.plu, nombre: a.nombre, cambios: tipos, antes: b, ahora: a });
  }
  for (const b of anterior) if (!ahoraMapa.has(b.plu)) cambios.push({ plu: b.plu, nombre: b.nombre, cambios: ['baja'], antes: b, ahora: null });
  return cambios.sort((x, y) => Number(x.plu) - Number(y.plu));
}

export function nombreArchivo(modo: 'completo' | 'cambios', fecha = new Date()): string {
  const dia = fecha.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  return `odb-balanzas-${modo === 'cambios' ? 'cambios' : 'plu'}-${dia}.csv`;
}

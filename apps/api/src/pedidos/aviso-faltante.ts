// «SE LE AVISÓ AL CLIENTE QUE NO ESTÁ» (Leandro, 22/11/2026, con la foto de
// DOM-1284BEF14D1D: «acá necesitamos que en el proceso se marque cuando se le
// comunicó al cliente que no está ese producto, ej. la Cindor»).
//
// El caso: a las 15:01 el armado sacó 17 Cindor; a las 15:12 alguien le escribió
// al cliente desde el teléfono del local «Cindor no hay, te puedo ofrecer
// ilolay»; a las 15:16 el sistema le preguntó por el parecido. En «Quién hizo
// cada cosa» no estaba ni el mensaje del teléfono ni la pregunta (solo la
// respuesta del cliente): no se veía cuándo se enteró ni cuánto tardó.
//
// Ahora queda en el historial del pedido (evento 'aviso_cliente'):
//  - lo que se le escribe desde el teléfono del local (o WhatsApp Web) cuando dice
//    que falta un producto de su pedido abierto;
//  - el «No hay: avisarle» del armado (sale solo por WhatsApp), o por qué no salió.
// La pregunta por un parecido o por otra variedad ya está en pedidos_reemplazos
// (preguntado_en) y se lee de ahí. Y si a un producto que se sacó no le
// corresponde ningún aviso, el historial lo dice.

import type { SupabaseClient } from '@supabase/supabase-js';

export const EVENTO_AVISO = 'aviso_cliente';

/** Desde cuándo se marca «no figura ningún aviso»: antes no se anotaban los del teléfono. */
export const AVISOS_DESDE = '2026-11-22T03:00:00Z';

const sinAcentos = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// palabras que no distinguen un producto de otro
const GENERICAS = new Set([
  'unidad', 'unidades', 'pack', 'caja', 'cajas', 'botella', 'botellas', 'lata', 'latas', 'paquete', 'paquetes',
  'bolsa', 'bolsas', 'sobre', 'sobres', 'frasco', 'litro', 'litros', 'gramos', 'kilo', 'kilos', 'sabor', 'sabores',
  'clasico', 'clasica', 'original', 'grande', 'chico', 'chica', 'mediano', 'mediana', 'surtido', 'surtidos',
]);

/** Las palabras que nombran a un producto («Leche Cindor x 200 cc» → leche, cindor). */
export function palabrasDe(nombre: string): string[] {
  return [...new Set(sinAcentos(nombre).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/\d/.test(w) && !GENERICAS.has(w)))];
}

/**
 * Qué productos de la lista nombra el texto. Cuenta lo que distingue a cada uno:
 * con «Leche Cindor» y «Leche Ilolay» en el pedido, «leche» no dice cuál.
 */
export function productosQueNombra(texto: string, nombres: string[]): string[] {
  const delTexto = new Set(sinAcentos(texto).split(/[^a-z0-9]+/).filter(Boolean).flatMap((w) => [w, w.replace(/s$/, '')]));
  const productos = [...new Set(nombres.map((n) => String(n ?? '').trim()).filter(Boolean))].map((n) => ({ n, ps: palabrasDe(n) }));
  return productos
    .filter(({ n, ps }) => {
      const propias = ps.filter((p) => !productos.some((o) => o.n !== n && o.ps.includes(p)));
      return (propias.length ? propias : ps).some((p) => delTexto.has(p) || delTexto.has(p.replace(/s$/, '')));
    })
    .map(({ n }) => n);
}

// «no hay», «no tenemos», «se terminó», «te puedo ofrecer…», «en su lugar»…
// («no la tenemos», «no nos queda», «no te lo conseguí»)
const DICE_QUE_FALTA = /\b(no ((la|lo|las|los|te|le|les|nos) ){0,2}(hay|tenemos|tengo|queda|quedan|quedo|quedaron|contamos|vino|vinieron|llego|llegaron|entro|entraron|esta|estan|consegui|conseguimos)\b|sin stock|agotad|falt|se (nos )?termin|(te|les) (puedo|podemos) ofrecer|(puedo|podemos) ofrecerte|te ofrezco|te ofrecemos|en su lugar|reemplaz|alternativa)/;

export const diceQueFalta = (texto: string) => DICE_QUE_FALTA.test(sinAcentos(texto));

/** Los productos del pedido de los que el mensaje dice que faltan (vacío si no habla de eso). */
export function avisaQueFalta(texto: string, nombres: string[]): string[] {
  return texto && diceQueFalta(texto) ? productosQueNombra(texto, nombres) : [];
}

// ---- Las líneas de «Quién hizo cada cosa» ----

const enLista = (ns: string[]) => (ns.length <= 1 ? ns[0] ?? 'un producto' : `${ns.slice(0, -1).join(', ')} ni ${ns[ns.length - 1]}`);
const recortar = (s: string, n = 200) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const cantidad = (n: unknown) => { const c = Number(n); return Number.isFinite(c) && c > 0 ? `${c.toLocaleString('es-AR')} × ` : ''; };

type Tono = 'neutro' | 'ok' | 'atencion' | 'error' | 'info';

/** El evento 'aviso_cliente' en palabras. */
export function lineaDeAviso(d: any): { que: string; tono: Tono } {
  const productos = enLista(((d?.productos ?? []) as unknown[]).map(String));
  if (d?.por === 'telefono') return { que: `Se le avisó al cliente que no hay ${productos}: se lo escribieron desde el teléfono del local («${recortar(d?.texto)}»)`, tono: 'info' };
  if (d?.avisado === false) return { que: `No se le pudo avisar al cliente que no hay ${productos}: ${d?.motivo ?? 'no salió el WhatsApp'}`, tono: 'error' };
  return { que: `Se le avisó al cliente por WhatsApp que no hay ${productos} y que no va en el pedido`, tono: 'info' };
}

export type CambioConsultado = {
  tipo?: string | null; nombre_falta?: string | null; nombre_reemplazo?: string | null; cantidad?: number | null;
  pedida?: string | null; variedades?: string[] | null; preguntado_en?: string | null;
};

/** La pregunta por un parecido o por otra variedad: también es avisarle que no hay. */
export function lineaDePregunta(c: CambioConsultado): string {
  const falta = c.nombre_falta || 'un producto';
  if (c.tipo === 'variedad') {
    const opciones = (c.variedades ?? []).map(String).filter(Boolean);
    return `Se le avisó al cliente por WhatsApp que no hay ${c.pedida ? `${falta} de ${c.pedida}` : falta}${opciones.length ? ` y se le preguntó cuál quiere: ${opciones.join(', ')}` : ''}`;
  }
  return `Se le avisó al cliente por WhatsApp que no hay ${falta} y se le preguntó si le sirve ${cantidad(c.cantidad)}${c.nombre_reemplazo || 'un parecido'}`;
}

type Paso = { evento: string; detalle?: any; creado_en: string };

/**
 * Lo que se sacó del pedido (desde AVISOS_DESDE) sin ningún aviso al cliente: ni
 * un mensaje, ni la pregunta por un parecido, ni lo que anotó quien arma después
 * de hablar con él («Lo llamé y dijo que sí / que no»). Una línea por producto.
 */
export function sacadosSinAviso(pasos: Paso[], cambios: CambioConsultado[]): { cuando: string; nombre: string }[] {
  const avisados = new Set<string>();
  for (const p of pasos) {
    if (p.evento === EVENTO_AVISO && p.detalle?.avisado !== false) for (const n of p.detalle?.productos ?? []) avisados.add(String(n));
    if (p.evento === 'reemplazo' && p.detalle?.falta) avisados.add(String(p.detalle.falta));
  }
  for (const c of cambios) if (c.preguntado_en && c.nombre_falta) avisados.add(String(c.nombre_falta));
  const vistos = new Set<string>();
  const sin: { cuando: string; nombre: string }[] = [];
  for (const p of pasos) {
    const nombre = p.evento === 'productos' ? String(p.detalle?.saco?.nombre ?? '') : '';
    if (!nombre || avisados.has(nombre) || vistos.has(nombre) || Date.parse(p.creado_en) < Date.parse(AVISOS_DESDE)) continue;
    vistos.add(nombre);
    sin.push({ cuando: p.creado_en, nombre });
  }
  return sin;
}

export const lineaSinAviso = (nombre: string) => `No figura ningún aviso al cliente de que falta ${nombre}`;

// ---- Lo que se escribe desde el teléfono del local ----

const ABIERTOS = ['recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino'];

/**
 * Lo que alguien le escribe a un cliente desde el teléfono del local: si dice que
 * falta un producto de un pedido suyo abierto, queda en el historial de ese
 * pedido. Devuelve los pedidos en los que quedó.
 */
export async function anotarAvisoDelTelefono(db: SupabaseClient, a: { linea: string; chat: string; texto: string; en?: string }): Promise<string[]> {
  if (!a.texto || !a.chat || !diceQueFalta(a.texto)) return [];
  const { data: cots } = await db.from('bot_cotizaciones').select('pedido_id')
    .eq('telefono', a.chat).eq('linea', a.linea).not('pedido_id', 'is', null)
    .order('creada_en', { ascending: false }).limit(10);
  const ids = [...new Set(((cots ?? []) as any[]).map((c) => c.pedido_id).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const { data: peds } = await db.from('pedidos').select('id, estado, items:pedidos_items(producto:productos(nombre))').in('id', ids).in('estado', ABIERTOS);
  if (!peds?.length) return [];
  const pids = (peds as any[]).map((p) => String(p.id));
  const [{ data: sacados }, { data: cambios }] = await Promise.all([
    db.from('pedidos_historial').select('pedido_id, detalle').in('pedido_id', pids).eq('evento', 'productos'),
    db.from('pedidos_reemplazos').select('pedido_id, nombre_falta').in('pedido_id', pids),
  ]);
  const anotados: string[] = [];
  for (const p of peds as any[]) {
    const nombres = [
      ...((p.items ?? []) as any[]).map((i) => i.producto?.nombre),
      ...((sacados ?? []) as any[]).filter((s) => s.pedido_id === p.id).map((s) => s.detalle?.saco?.nombre),
      ...((cambios ?? []) as any[]).filter((c) => c.pedido_id === p.id).map((c) => c.nombre_falta),
    ].filter(Boolean).map(String);
    const productos = avisaQueFalta(a.texto, nombres);
    if (!productos.length) continue;
    const { error } = await db.from('pedidos_historial').insert({
      pedido_id: p.id, evento: EVENTO_AVISO, estado_despues: p.estado, usuario_id: null,
      detalle: { por: 'telefono', productos, texto: String(a.texto).slice(0, 500) },
      ...(a.en ? { creado_en: a.en } : {}),
    });
    if (!error) anotados.push(String(p.id));
  }
  return anotados;
}

// PONER AL DÍA EL STOCK Y LAS VENTAS DE UN LOCAL (11/11/2026).
//
// Los locales todavía venden con su sistema (Sant Thomas, con el Crack): el
// stock y las ventas de NÚCLEO son una foto, la de la última carga. Hasta hoy
// cada carga era una sesión entera con los nueve CSV del Crack «con criterio»
// (scripts/sistema-viejo). Esto deja andando sola la parte de todos los días:
// stock y ventas. Lo demás (precios, altas, clientes, cuenta corriente,
// proveedores) sigue yendo por la carga completa.
//
// Las reglas son LAS MISMAS de la carga del 10/11 (scripts/sistema-viejo/
// simular-csv.py, secciones 4 y 8; auditoría 1062):
//
//  - Se cruza por productos.codigo_legacy. Lo que el archivo no trae, no se toca.
//  - Stock = lo que dice el sistema del local + lo que entró o salió SOLO en
//    NÚCLEO desde la carga anterior (las compras de administración, correcciones,
//    traspasos, reservas). Las ventas de prueba de NÚCLEO no cuentan.
//  - Si el sistema del local también tuvo esa compra (su stock subió), no se
//    cuenta dos veces.
//  - Negativos → 0.
//  - Si un código viene dos veces en el archivo (pasó el 10/11 con tres: 17 y 0,
//    7 y 0, 0 y 0,705) se SUMAN: son dos renglones del mismo artículo. La carga
//    del 10/11 se quedaba con el último y dejó dos productos en cero.
//  - Ventas: unidades por producto y por día, solo los días COMPLETOS que
//    todavía no están cargados. El día del corte queda para la próxima.
//
// Acá no se escribe nada: sale el plan. Lo aplica, todo o nada, la función
// aplicar_puesta_al_dia de la base (db/migracion-puesta-al-dia.sql).

export type EntradaPuestaAlDia = {
  sucursalId: string;
  /** fecha y hora del corte del archivo de stock, con zona: 2026-11-10T11:20:16-03:00 */
  corte: string;
  stock: { codigo: string; cantidad: number }[];
  /** unidades por día y producto de los días posteriores a lo ya cargado; incluye el día del corte, a medias */
  ventas: { fecha: string; codigo: string; unidades: number }[];
};

export type BasePuestaAlDia = {
  productos: { id: string; sku: string; nombre: string; codigo_legacy: string | null; activo: boolean }[];
  /** stock de hoy en ese local, por producto */
  stock: Map<string, number>;
  /** todo lo que se movió en ese local desde la última sincronización */
  movimientos: { producto_id: string; tipo: string; cantidad: number; referencia_tipo: string | null }[];
  /** cuándo se aplicó la última sincronización (creado_en de sus movimientos) */
  ultimaSincronizacion: string | null;
  /** hasta qué día hay ventas cargadas (AAAA-MM-DD) */
  ventasHasta: string | null;
};

export type AjusteDeStock = { producto_id: string; objetivo: number; antes: number; crack: number; solo_nucleo: number };
export type VentaDelDia = { producto_id: string; sku: string; codigo: string; nombre: string; fecha: string; unidades: number };

export type PlanPuestaAlDia = {
  sucursalId: string;
  /** como queda en movimientos_stock y en ventas_historicas: crack-20261111-1120 */
  referencia: string;
  corte: string;
  stock: AjusteDeStock[];
  ventas: VentaDelDia[];
  resumen: {
    stock: {
      enArchivo: number; conProducto: number; sinProducto: number; deBaja: number;
      ajustes: number; suben: number; bajan: number; unidadesSuben: number; unidadesBajan: number;
      quedanEnCero: number; comprasSoloNucleo: number; comprasQueElLocalYaTenia: number;
      mayores: { nombre: string; antes: number; objetivo: number }[];
    };
    ventas: { desde: string | null; hasta: string | null; dias: number; renglones: number; unidades: number; porDia: { fecha: string; renglones: number; unidades: number }[] };
  };
  /** no se puede aplicar */
  frenos: string[];
  /** se puede aplicar, pero hay que leerlo */
  avisos: string[];
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// las fechas de un local son las de Argentina (UTC−3, sin horario de verano)
const diaLocal = (iso: string | Date) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const corto = (dia: string) => `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;
const masUnDia = (dia: string) => new Date(Date.parse(`${dia}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

/** Los movimientos de NÚCLEO que el sistema del local no conoce: todo menos sus propias ventas y las sincronizaciones. */
const soloDeNucleo = (m: { tipo: string; referencia_tipo: string | null }) =>
  m.tipo !== 'venta' && m.referencia_tipo !== 'venta_prueba' && m.referencia_tipo !== 'importacion';

export function planDePuestaAlDia(entrada: EntradaPuestaAlDia, base: BasePuestaAlDia, ahora = new Date()): PlanPuestaAlDia {
  const frenos: string[] = [];
  const avisos: string[] = [];
  const corteMs = Date.parse(entrada.corte);
  const corteOk = Number.isFinite(corteMs);
  const diaCorte = corteOk ? diaLocal(entrada.corte) : '';
  const hhmm = corteOk ? new Date(corteMs - 3 * 3600_000).toISOString().slice(11, 16).replace(':', '') : '';
  const referencia = corteOk ? `crack-${diaCorte.replace(/-/g, '')}-${hhmm}` : 'crack-sin-fecha';

  if (!corteOk) frenos.push('El archivo de stock no trae la fecha y hora del corte: no se puede saber de cuándo es.');
  else if (corteMs > ahora.getTime() + 10 * 60_000) frenos.push('El corte del archivo de stock es de una fecha futura: revisá el archivo.');
  else if (base.ultimaSincronizacion && corteMs <= Date.parse(base.ultimaSincronizacion)) {
    frenos.push(`Este archivo es del ${corto(diaCorte)} a las ${hhmm.slice(0, 2)}:${hhmm.slice(2)}, anterior a la última carga (${corto(diaLocal(base.ultimaSincronizacion))}): bajá uno nuevo del sistema del local.`);
  } else if (ahora.getTime() - corteMs > 36 * 3600_000) {
    avisos.push(`El archivo es del ${corto(diaCorte)}: el stock va a quedar como estaba ese día, no como está hoy.`);
  }
  if (!entrada.stock.length) frenos.push('El archivo de stock no trae productos.');

  // ---------- productos por código ----------
  const porCodigo = new Map<string, BasePuestaAlDia['productos']>();
  for (const p of base.productos) {
    const c = String(p.codigo_legacy ?? '').trim();
    if (c) porCodigo.set(c, [...(porCodigo.get(c) ?? []), p]);
  }
  const unico = (codigo: string) => {
    const ps = porCodigo.get(String(codigo ?? '').trim()) ?? [];
    return ps.length === 1 ? ps[0] : null;
  };

  // ---------- lo que se movió solo en NÚCLEO desde la última carga ----------
  const soloNucleo = new Map<string, number>();
  const comprasNucleo = new Map<string, number>();
  const todoDesde = new Map<string, number>();
  for (const m of base.movimientos) {
    const q = num(m.cantidad);
    todoDesde.set(m.producto_id, (todoDesde.get(m.producto_id) ?? 0) + q);
    if (!soloDeNucleo(m)) continue;
    soloNucleo.set(m.producto_id, (soloNucleo.get(m.producto_id) ?? 0) + q);
    if (m.tipo === 'compra') comprasNucleo.set(m.producto_id, (comprasNucleo.get(m.producto_id) ?? 0) + q);
  }
  // lo que vendió el local desde el día de la última carga (el día entero: alcanza
  // para ver si su stock subió por una compra)
  const desdeVenta = base.ultimaSincronizacion ? diaLocal(base.ultimaSincronizacion) : '';
  const vendioElLocal = new Map<string, number>();
  for (const v of entrada.ventas) {
    if (desdeVenta && v.fecha < desdeVenta) continue;
    vendioElLocal.set(v.codigo, (vendioElLocal.get(v.codigo) ?? 0) + num(v.unidades));
  }

  // ---------- stock ----------
  const stock: AjusteDeStock[] = [];
  const nombreDe = new Map<string, string>();
  let conProducto = 0, sinProducto = 0, deBaja = 0, comprasSolo = 0, comprasDobles = 0, repetidos = 0;
  const vistos = new Map<string, number>();
  for (const fila of entrada.stock) {
    const codigo = String(fila.codigo ?? '').trim();
    if (!codigo) continue;
    if (vistos.has(codigo)) repetidos++;
    vistos.set(codigo, (vistos.get(codigo) ?? 0) + num(fila.cantidad));
  }
  if (repetidos) avisos.push(`${repetidos} código${repetidos === 1 ? ' viene' : 's vienen'} más de una vez en el archivo de stock: se suman sus cantidades.`);
  for (const [codigo, cantidad] of vistos) {
    const p = unico(codigo);
    if (!p) { sinProducto++; continue; }
    if (!p.activo) { deBaja++; continue; }
    conProducto++;
    nombreDe.set(p.id, p.nombre);
    const crack = cantidad;
    const antes = base.stock.get(p.id) ?? 0;
    let extra = soloNucleo.get(p.id) ?? 0;
    const compras = comprasNucleo.get(p.id) ?? 0;
    if (compras > 0) {
      // lo que había justo después de la última carga = lo que decía el local ese día
      const alCargar = antes - (todoDesde.get(p.id) ?? 0);
      const entroAlLocal = Math.max(0, crack - alCargar + (vendioElLocal.get(codigo) ?? 0));
      const quita = Math.min(compras, entroAlLocal);
      if (quita > 0.0005) { comprasDobles++; extra -= quita; }
      if (compras - quita > 0.0005) comprasSolo++;
    }
    const objetivo = r3(Math.max(0, crack + extra));
    if (Math.abs(objetivo - antes) >= 0.001) stock.push({ producto_id: p.id, objetivo, antes: r3(antes), crack: r3(crack), solo_nucleo: r3(extra) });
  }
  if (entrada.stock.length && conProducto < entrada.stock.length * 0.5) {
    frenos.push(`Solo ${conProducto} de los ${entrada.stock.length} códigos del archivo son productos de NÚCLEO: no parece el archivo de stock de este local.`);
  }
  const suben = stock.filter((a) => a.objetivo > a.antes);
  const bajan = stock.filter((a) => a.objetivo < a.antes);
  const mayores = [...stock]
    .sort((a, b) => Math.abs(b.objetivo - b.antes) - Math.abs(a.objetivo - a.antes))
    .slice(0, 12)
    .map((a) => ({ nombre: nombreDe.get(a.producto_id) ?? a.producto_id, antes: a.antes, objetivo: a.objetivo }));

  // ---------- ventas: los días completos que faltan ----------
  const ventas: VentaDelDia[] = [];
  const porDia = new Map<string, { renglones: number; unidades: number }>();
  let ventasSinProducto = 0;
  for (const v of entrada.ventas) {
    const fecha = String(v.fecha ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    if (base.ventasHasta && fecha <= base.ventasHasta) continue; // ya está cargado
    if (!diaCorte || fecha >= diaCorte) continue; // el día del corte está a medias
    const unidades = r3(num(v.unidades));
    if (!unidades) continue;
    const p = unico(v.codigo);
    if (!p) { ventasSinProducto++; continue; }
    ventas.push({ producto_id: p.id, sku: p.sku, codigo: String(v.codigo).trim(), nombre: p.nombre, fecha, unidades });
    const d = porDia.get(fecha) ?? { renglones: 0, unidades: 0 };
    d.renglones++; d.unidades += unidades;
    porDia.set(fecha, d);
  }
  const dias = [...porDia.keys()].sort();
  // un día sin ventas en el medio puede ser un feriado… o un archivo cortado
  if (corteOk && base.ventasHasta) {
    const faltan: string[] = [];
    for (let d = masUnDia(base.ventasHasta); d < diaCorte; d = masUnDia(d)) if (!porDia.has(d)) faltan.push(corto(d));
    if (faltan.length) avisos.push(`El archivo de ventas no trae nada del ${faltan.join(', ')}. Si ese día el local abrió, el archivo está incompleto: no lo apliques.`);
  }
  if (ventasSinProducto) avisos.push(`${ventasSinProducto} renglones de venta son de códigos que NÚCLEO no tiene: no se cargan.`);
  if (sinProducto) avisos.push(`${sinProducto} códigos del stock no son productos de NÚCLEO: entran con la carga completa del sistema del local (altas).`);

  return {
    sucursalId: entrada.sucursalId, referencia, corte: entrada.corte, stock, ventas,
    resumen: {
      stock: {
        enArchivo: vistos.size, conProducto, sinProducto, deBaja,
        ajustes: stock.length, suben: suben.length, bajan: bajan.length,
        unidadesSuben: r3(suben.reduce((s, a) => s + a.objetivo - a.antes, 0)),
        unidadesBajan: r3(bajan.reduce((s, a) => s + a.antes - a.objetivo, 0)),
        quedanEnCero: stock.filter((a) => a.objetivo === 0 && a.antes > 0).length,
        comprasSoloNucleo: comprasSolo, comprasQueElLocalYaTenia: comprasDobles,
        mayores,
      },
      ventas: {
        desde: dias[0] ?? null, hasta: dias[dias.length - 1] ?? null, dias: dias.length,
        renglones: ventas.length, unidades: r3(ventas.reduce((s, v) => s + v.unidades, 0)),
        porDia: dias.map((fecha) => ({ fecha, renglones: porDia.get(fecha)!.renglones, unidades: r3(porDia.get(fecha)!.unidades) })),
      },
    },
    frenos, avisos,
  };
}

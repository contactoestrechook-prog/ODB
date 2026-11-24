// PONER AL DÍA EL STOCK Y LAS VENTAS DE UN LOCAL (11/11/2026).
//
// Los locales todavía venden con su sistema (Sant Thomas, con el Crack): el
// stock y las ventas de NÚCLEO son una foto, la de la última carga. Hasta hoy
// cada carga era una sesión entera con los nueve CSV del Crack «con criterio»
// (scripts/sistema-viejo). Esto deja andando sola la parte de todos los días:
// stock y ventas. Lo demás (precios, altas, clientes, cuenta corriente,
// proveedores) sigue yendo por la carga completa.
//
// Las reglas son LAS MISMAS de la carga completa (scripts/sistema-viejo/
// simular-csv.py, secciones 4 y 8):
//
//  - Se cruza por productos.codigo_legacy. Lo que el archivo no trae, no se toca.
//  - Mientras el local venda con su sistema, ese sistema es la verdad del stock
//    (Leandro, 24/11/2026): Stock = lo que dice el sistema del local − lo
//    reservado hoy para pedidos abiertos de NÚCLEO (el local no los conoce).
//    Nada de lo cargado en NÚCLEO se suma encima, ni antes ni después del corte:
//    la factura llega SIEMPRE después que la mercadería, y el local la carga en
//    su sistema cuando la recibe. Una compra que el local nunca cargó se carga
//    en su sistema, donde se vende.
//
//    Hasta el 24/11/2026 se sumaba lo cargado en NÚCLEO desde la carga ANTERIOR,
//    y para no contar dos veces una compra se miraba si el stock del local había
//    subido. Falló: el 18/11 Ana cargó, después de la carga, 40 facturas del 10 al
//    17/11 que el Crack ya tenía; su stock no subió en la semana (había subido
//    antes) y la carga del 24/11 dejó 242 productos de Sant Thomas con 3.234
//    unidades contadas dos veces (Jaqui: prepizzas 37 en NÚCLEO y 27 en el Crack;
//    corregido en la auditoría 1461). Tampoco sirve sumar lo cargado DESPUÉS del
//    corte: ese mismo día Juan Pablo cargó a las 15:36 una factura de 40 Saint
//    Felicien que el Crack ya tenía en el corte de las 15:26.
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
  /** solo para el control: lo que se movió en ese local mientras se aplicaba la carga (desde que se leyó la base del plan) */
  movimientos: { producto_id: string; tipo: string; cantidad: number; referencia_tipo: string | null }[];
  /** lo reservado HOY para pedidos abiertos de ese local, por producto, en positivo */
  reservado: Map<string, number>;
  /** cuándo se aplicó la última sincronización (creado_en de sus movimientos) */
  ultimaSincronizacion: string | null;
  /** hasta qué día hay ventas cargadas (AAAA-MM-DD) */
  ventasHasta: string | null;
};

export type AjusteDeStock = { producto_id: string; objetivo: number; antes: number; crack: number; reservado: number };
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
      quedanEnCero: number;
      /** cómo queda contra el sistema del local: igual, o distinto y por qué */
      igualAlLocal: number; conReservas: number; negativosACero: number;
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

/** Lo que tiene que quedar en NÚCLEO para un producto: lo del local − lo reservado para pedidos abiertos. */
export const stockEsperado = (crack: number, reservado: number) => r3(Math.max(0, crack - reservado));

/** El archivo de stock por código: un código que viene dos veces se suma (son dos renglones del mismo artículo). */
function sumarPorCodigo(filas: EntradaPuestaAlDia['stock']) {
  const vistos = new Map<string, number>();
  for (const fila of filas) {
    const codigo = String(fila.codigo ?? '').trim();
    if (codigo) vistos.set(codigo, (vistos.get(codigo) ?? 0) + num(fila.cantidad));
  }
  return vistos;
}

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

  // ---------- stock ----------
  const stock: AjusteDeStock[] = [];
  const nombreDe = new Map<string, string>();
  let conProducto = 0, sinProducto = 0, deBaja = 0, repetidos = 0;
  let igualAlLocal = 0, conReservas = 0, negativosACero = 0;
  const vistos = sumarPorCodigo(entrada.stock);
  repetidos = entrada.stock.filter((f) => String(f.codigo ?? '').trim()).length - vistos.size;
  if (repetidos) avisos.push(`${repetidos} código${repetidos === 1 ? ' viene' : 's vienen'} más de una vez en el archivo de stock: se suman sus cantidades.`);
  for (const [codigo, cantidad] of vistos) {
    const p = unico(codigo);
    if (!p) { sinProducto++; continue; }
    if (!p.activo) { deBaja++; continue; }
    conProducto++;
    nombreDe.set(p.id, p.nombre);
    const crack = cantidad;
    const antes = base.stock.get(p.id) ?? 0;
    const res = r3(base.reservado.get(p.id) ?? 0);
    const objetivo = stockEsperado(crack, res);
    if (Math.abs(objetivo - crack) < 0.001) igualAlLocal++;
    if (res >= 0.001) conReservas++;
    if (crack < 0) negativosACero++;
    if (Math.abs(objetivo - antes) >= 0.001) stock.push({ producto_id: p.id, objetivo, antes: r3(antes), crack: r3(crack), reservado: res });
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
        igualAlLocal, conReservas, negativosACero,
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

export type ControlContraElLocal = {
  comparados: number;
  iguales: number;
  /** distintos al archivo, con su motivo: lo reservado para pedidos, un negativo del local que quedó en cero, o algo que se movió mientras se aplicaba */
  explicados: number;
  /** distintos al archivo SIN motivo: la carga no quedó bien */
  sinExplicar: { sku: string; nombre: string; local: number; nucleo: number; esperado: number }[];
};

/**
 * DESPUÉS de aplicar, producto por producto contra el archivo del local
 * (24/11/2026). Hasta ese día la carga se daba por buena porque «volver a simular
 * da 0», que compara NÚCLEO consigo mismo: con la regla equivocada daba 0 igual.
 * Esto compara contra el archivo: cada diferencia tiene que tener su motivo.
 */
export function controlContraElLocal(entrada: EntradaPuestaAlDia, base: BasePuestaAlDia): ControlContraElLocal {
  const porCodigo = new Map<string, BasePuestaAlDia['productos']>();
  for (const p of base.productos) {
    const c = String(p.codigo_legacy ?? '').trim();
    if (c) porCodigo.set(c, [...(porCodigo.get(c) ?? []), p]);
  }
  // lo que se movió en NÚCLEO mientras se aplicaba (una venta, una compra): la
  // carga lo respeta. La carga misma y las reservas (van por lo reservado) no.
  const durante = new Map<string, number>();
  for (const m of base.movimientos) {
    if (m.referencia_tipo === 'importacion' || m.tipo === 'reserva' || m.tipo === 'liberacion_reserva') continue;
    durante.set(m.producto_id, (durante.get(m.producto_id) ?? 0) + num(m.cantidad));
  }
  let comparados = 0, iguales = 0, explicados = 0;
  const sinExplicar: ControlContraElLocal['sinExplicar'] = [];
  for (const [codigo, local] of sumarPorCodigo(entrada.stock)) {
    const ps = porCodigo.get(codigo) ?? [];
    if (ps.length !== 1 || !ps[0].activo) continue;
    const p = ps[0];
    comparados++;
    const nucleo = r3(base.stock.get(p.id) ?? 0);
    if (Math.abs(nucleo - local) < 0.001) { iguales++; continue; }
    const esperado = r3(Math.max(0, stockEsperado(local, base.reservado.get(p.id) ?? 0) + (durante.get(p.id) ?? 0)));
    if (Math.abs(nucleo - esperado) < 0.001) explicados++;
    else sinExplicar.push({ sku: p.sku, nombre: p.nombre, local: r3(local), nucleo, esperado });
  }
  sinExplicar.sort((a, b) => Math.abs(b.nucleo - b.esperado) - Math.abs(a.nucleo - a.esperado));
  return { comparados, iguales, explicados, sinExplicar };
}

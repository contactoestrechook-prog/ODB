// ============================================================
// EL CHAT VE LO QUE HACE (18/11/2026). Leandro: «siempre encontrás la falla
// pero nunca encontrás el problema de raíz».
//
// La raíz: el que habla no es el que hace. El chat decidía y contestaba en el
// servidor; la pantalla aplicaba después, en el navegador, con su propia cuenta.
// El chat nunca sabía qué había pasado con lo que mandó. De ahí salen, desde el
// 22/10 («sugerimos cambios pero no los aplica»), las dos fallas de siempre:
// decir «listo» sin saber si quedó, y dejar la factura trabada sin darse cuenta
// (los renglones en cero de Distribuidora City). Medido del 5 al 18/11: de 75
// facturas que pasaron por el chat, 37 necesitaron tres mensajes o más, en 11
// el chat admitió que lo anterior no había quedado, y 13 no se registraron.
//
// Acá el servidor aplica los cambios del chat sobre las filas de la pantalla
// con LA MISMA cuenta que la pantalla (./panel/tabla-factura, copia controlada
// de apps/admin/app/lib/tabla-factura.ts) y dice qué pasó de verdad: qué entró,
// qué se rechazó y por qué, y qué renglones dejaron de cerrar. Con eso el chat
// corrige o contesta la verdad ANTES de que la persona vea nada.
//
// Funciones puras; se prueban en probar-cambios.spec.ts.
// ============================================================
import { aplicarCambiosIA, cuentaDelPapel, tablaParaIA, type CambioIA } from './panel/tabla-factura';

export type Rechazo = { renglon: number | null; campo: string; porque: string };
export type Prueba = {
  /** las filas como quedan después de lo que sí se aplicó */
  filas: any[];
  /** los cambios que la pantalla va a poder aplicar, en el orden en que vinieron */
  aceptados: CambioIA[];
  rechazados: Rechazo[];
  /** renglones (desde 1) que daban su importe y con estos cambios dejaron de darlo: traban el registro */
  rotos: number[];
};

/** La pantalla manda cada fila con `_esDescuento` ya resuelto (lo decide su propia cuenta de descuentos). */
const esDescuento = (f: any) => !!f?._esDescuento;
const trabaElRegistro = (f: any) => !!f && !esDescuento(f) && !f.esDevolucion && !f.porPeso && !f.juntadoEn && !!f.papel && !cuentaDelPapel(f.papel).cierra;

/**
 * Prueba los cambios del chat sobre las filas de la pantalla. El producto
 * vinculado («producto») lo resuelve la pantalla buscando en el catálogo: acá
 * pasa sin probar.
 */
export function probarCambios(filas: any[], cambios: CambioIA[]): Prueba {
  const aProbar = (cambios ?? []).filter((c) => c?.campo !== 'producto');
  const r = aplicarCambiosIA(filas, aProbar, esDescuento);
  const firmes = new Set(r.aceptados);
  const rechazados: Rechazo[] = r.descartados.map((c) => ({
    renglon: Number.isFinite(Number(c?.renglon)) ? Number(c.renglon) : null,
    campo: String(c?.campo ?? ''),
    porque: String(c?.porque ?? 'el valor no es válido para ese dato'),
  }));
  const rotos = r.items.map((f, k) => (trabaElRegistro(f) && !trabaElRegistro(filas[k]) ? k + 1 : 0)).filter(Boolean);
  return { filas: r.items, aceptados: (cambios ?? []).filter((c) => c?.campo === 'producto' || firmes.has(c)), rechazados, rotos };
}

/** La tabla como la ve el chat, después de aplicar (los descuentos conservan a dónde iban; los costos no se recalculan acá). */
export function tablaDespues(filas: any[], tablaAntes: unknown[]): unknown[] {
  return tablaParaIA(filas, esDescuento, (k) => String((tablaAntes?.[k] as any)?.aplicaA ?? '') || null);
}

const lista = (ns: number[]) => (ns.length <= 12 ? ns.join(', ') : `${ns.slice(0, 12).join(', ')} y ${ns.length - 12} más`);

/**
 * Lo que se le dice al chat cuando la prueba encontró algo: null si todo se
 * aplicó y nada quedó trabado (ahí su respuesta sale tal cual).
 */
export function observacionDeLaPrueba(p: Prueba, tablaAhora: unknown[]): string | null {
  if (!p.rechazados.length && !p.rotos.length) return null;
  return [
    'LA PANTALLA PROBÓ TUS CAMBIOS antes de mostrarle nada a la persona (tu respuesta anterior todavía no la vio: la que escribas ahora la reemplaza).',
    `Se aplicaron ${p.aceptados.length}.`,
    ...(p.rechazados.length ? ['NO se pudieron aplicar:', ...p.rechazados.map((r) => `- Renglón ${r.renglon ?? '?'} «${r.campo}»: ${r.porque}`)] : []),
    ...(p.rotos.length ? [`Con lo que se aplicó, ${p.rotos.length === 1 ? `el renglón ${p.rotos[0]} dejó de dar su importe` : `los renglones ${lista(p.rotos)} dejaron de dar su importe`} (antes cerraban): así la factura queda TRABADA y no se puede registrar. Si eso no es lo que pidió la persona, deshacelo o corregilo ahora.`] : []),
    `La tabla como quedó (JSON): ${JSON.stringify(tablaAhora).slice(0, 60_000)}`,
    'Mirá esa tabla. Si lo que pidió la persona se puede lograr con otro campo o con otro valor, mandá AHORA solo los cambios que faltan: no repitas los que ya se aplicaron ni el mismo cambio que se rechazó. Si no se puede, no mandes ningún cambio. En «respuesta» contá la verdad completa de cómo quedó: qué quedó hecho y qué NO se pudo y por qué, dicho en palabras simples. Nunca digas «listo» ni «ahora sí» por algo que la pantalla rechazó. No propongas reglas nuevas en este mensaje.',
  ].join('\n');
}

/** Cuando ni probando de otra forma se pudo: lo dice la pantalla, sin repetir lo que el chat creyó haber hecho. */
export function fraseSinAplicar(aplicados: number): string {
  return `Probé de más de una forma y hay una parte que la pantalla no toma, así que no la doy por hecha${aplicados ? ' (lo que sí quedó aplicado está acá abajo)' : ''}. El motivo está en el cartel de abajo y quedó registrado para corregirlo.`;
}
export function fraseRotos(rotos: number[]): string {
  return rotos.length ? ` Ojo: ${rotos.length === 1 ? `el renglón ${rotos[0]} quedó sin dar su importe` : `los renglones ${lista(rotos)} quedaron sin dar su importe`} y eso traba el registro.` : '';
}

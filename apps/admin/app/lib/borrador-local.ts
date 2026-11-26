// LO QUE SE ESTÁ CARGANDO NO SE PIERDE (26/11/2026). Leandro, por Juan Pablo: «si él está
// cargando una factura y por alguna razón sale, se corta la luz o cualquier cosa… cuando
// vuelva a entrar quede exactamente como la dejó, sin perder nada».
//
// Cada cambio se guarda en el navegador de esa compu (sobrevive a recargar, a cerrar la
// pestaña y a un corte de luz), a nombre de quien tiene la sesión: en una compu compartida
// el borrador de uno no le aparece a otro. Se borra al emitir o con «Empezar de cero».
// Lo usan «Emitir factura» (ui/EmitirComprobante.tsx), la carga de facturas de proveedor
// (ui/ComprasWorkspace.tsx) y el recordatorio «Tenés una factura a medias»
// (ui/AvisoFacturaAMedias.tsx). Las funciones puras se prueban en
// apps/api/src/compras/borrador-local.spec.ts.

export type Guardado<T> = { en: number; datos: T };

/** Las pantallas que guardan lo que se está cargando. */
export const BORRADOR_EMITIR = 'emitir-comprobante';
export const BORRADOR_FACTURA_PROVEEDOR = 'compras-factura-abierta';
/** Avisa a las otras partes de la pantalla (el recordatorio) que un borrador cambió. */
export const EVENTO_BORRADOR = 'odb-borrador';

/** Quién tiene la sesión en este navegador (la cookie odb_usuario, que no es httpOnly). */
export function usuarioDeLaCookie(cookie: string): string {
  const m = /(?:^|;\s*)odb_usuario=([^;]*)/.exec(cookie ?? '');
  try { return m ? decodeURIComponent(m[1]).trim().toLowerCase() : ''; } catch { return m?.[1] ?? ''; }
}

export const claveDeBorrador = (nombre: string, usuario: string) => `odb_borrador:${usuario || 'sin-sesion'}:${nombre}`;

const usuario = () => (typeof document === 'undefined' ? '' : usuarioDeLaCookie(document.cookie));

export function guardarBorrador<T>(nombre: string, datos: T): void {
  try {
    localStorage.setItem(claveDeBorrador(nombre, usuario()), JSON.stringify({ en: Date.now(), datos } satisfies Guardado<T>));
    window.dispatchEvent(new Event(EVENTO_BORRADOR));
  } catch { /* sin lugar o modo privado: sigue igual, sin guardar */ }
}

export function leerBorrador<T>(nombre: string): Guardado<T> | null {
  try {
    const v = localStorage.getItem(claveDeBorrador(nombre, usuario()));
    const g = v ? (JSON.parse(v) as Guardado<T>) : null;
    return g && typeof g.en === 'number' && g.datos != null ? g : null;
  } catch { return null; }
}

export function borrarBorrador(nombre: string): void {
  try {
    localStorage.removeItem(claveDeBorrador(nombre, usuario()));
    window.dispatchEvent(new Event(EVENTO_BORRADOR));
  } catch { /* nada */ }
}

// ---------- «Emitir factura» ----------

export type ItemEmitir = { sku?: string; descripcion: string; cantidad: number; precioUnitario: number; alicuota: number };
export type BorradorEmitir = {
  abierto: boolean;
  ventaId: string | null;
  /** El total de la venta que se factura (para volver a la misma pantalla). */
  ventaTotal?: number;
  tipo: string;
  cliente: { id: string; [k: string]: unknown } | null;
  items: ItemEmitir[];
  importe: string;
  concepto: string;
  condicionPago: 'contado' | 'cta_cte';
  sucursalId: string;
  moverStock: boolean;
  referenciaId: string;
};

/** ¿Hay algo cargado que valga la pena guardar? (una ventana vacía no es un borrador) */
export function emitirTieneAlgo(b: Pick<BorradorEmitir, 'cliente' | 'items' | 'importe' | 'concepto'>): boolean {
  return !!b.cliente || b.items.length > 0 || !!String(b.importe ?? '').trim() || !!String(b.concepto ?? '').trim();
}

/** El borrador guardado sirve para esta pantalla si es de la misma venta (o los dos sin venta). */
export function emitirCorresponde(b: Pick<BorradorEmitir, 'ventaId'>, ventaId: string | null | undefined): boolean {
  return (b.ventaId ?? null) === (ventaId ?? null);
}

/** Adónde volver para seguir la factura de «Emitir» que quedó a medias. */
export function linkParaSeguirEmitir(b: Pick<BorradorEmitir, 'ventaId' | 'ventaTotal'>): string {
  const p = new URLSearchParams({ seguir: '1' });
  if (b.ventaId) { p.set('venta', b.ventaId); if (b.ventaTotal) p.set('total', String(b.ventaTotal)); }
  return `/facturacion?${p.toString()}`;
}

/** «hace 5 minutos», «hace 2 horas», «el 24/11 a las 18:40» */
export function haceCuantoGuardado(en: number, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - en) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = new Date(en);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  const fecha = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
  return `el ${fecha} a las ${hora}`;
}

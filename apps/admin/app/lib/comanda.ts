// LA COMANDA IMPRESA (Leandro, 4/11/2026: "cuando entre un pedido, en las PC
// que tienen impresora, que imprima la comanda como PedidosYa"). Cada PC con
// impresora se marca una vez en Pedidos («Esta PC imprime las comandas»; queda
// guardado en esa PC). Cuando entra un pedido, cada PC marcada saca su copia, y
// en una misma PC sale una sola aunque tengan varias pestañas abiertas.
//
// Sin diálogo: el navegador siempre pregunta antes de imprimir, salvo que Chrome
// se abra con --kiosk-printing. Por eso esas PC abren el panel con el acceso
// directo «ODB Pedidos» (public/comandas/ODB-Pedidos.bat), que manda la comanda
// derecho a la impresora predeterminada (la térmica de 80 mm, como la caja).

import { pesos, ZONA_HORARIA } from './formato';
import { conCodigo } from './codigo-producto';
import { cantidadLegible, codigoDe, entregaDe, origenDe, telefonoLegible, type PedidoCola } from './pedidos';
import { textoVisible } from './texto';

const CLAVE_PC = 'odb_pc_imprime_comandas';
const CLAVE_IMPRESAS = 'odb_comandas_impresas';
const EVENTO = 'odb-comandas-cambio';
// lo impreso se recuerda 3 días (después ya no puede volver a entrar como nuevo)
const RECUERDA_MS = 3 * 86400_000;

const leerLS = <T>(clave: string, vacio: T): T => {
  try { const v = localStorage.getItem(clave); return v == null ? vacio : (JSON.parse(v) ?? vacio); } catch { return vacio; }
};
const guardarLS = (clave: string, v: unknown) => {
  try { localStorage.setItem(clave, JSON.stringify(v)); } catch { /* modo privado */ }
};

/** ¿Esta PC imprime las comandas? Se marca en cada PC, no en el usuario. */
export const estaPcImprime = (): boolean => leerLS<boolean>(CLAVE_PC, false) === true;

export function marcarEstaPc(si: boolean) {
  guardarLS(CLAVE_PC, si);
  window.dispatchEvent(new CustomEvent(EVENTO));
}

/** Avisa cuando se prende o apaga en esta PC (en esta pestaña o en otra). */
export function alCambiarEstaPc(f: () => void): () => void {
  const enOtra = (e: StorageEvent) => { if (e.key === CLAVE_PC) f(); };
  window.addEventListener(EVENTO, f);
  window.addEventListener('storage', enOtra);
  return () => { window.removeEventListener(EVENTO, f); window.removeEventListener('storage', enOtra); };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_HORARIA });

function comoPaga(p: PedidoCola): string {
  if (p.pagado_en) return 'PAGADO por Mercado Pago';
  if (String(p.qr_retiro ?? '').startsWith('PY-') || p.origen === 'pedidosya') return 'Lo cobra PedidosYa';
  const f = String(p.forma_pago ?? '').trim();
  return f ? `A cobrar · ${f}` : 'A cobrar al entregar';
}

/**
 * La comanda en 80 mm (72 mm de impresión). Márgenes de página en 0: así
 * Chrome no agrega su encabezado con la fecha y la dirección del panel.
 */
export function htmlComanda(p: PedidoCola, { prueba = false } = {}): string {
  const tel = telefonoLegible(p.clienteTelefono);
  const nota = textoVisible(p.notas);
  const renglones = (p.items ?? []).map((it) => {
    const cant = Number(it.cantidad) || 0;
    const unit = Number(it.precio_unitario);
    const importe = Number.isFinite(unit) && unit > 0 ? pesos(cant * unit) : '';
    return `<div class="fila"><span class="cant">${esc(cantidadLegible(cant))} x</span><span class="nombre">${esc(conCodigo(it.producto?.nombre ?? 'Producto', it.producto))}</span><span>${esc(importe)}</span></div>`;
  }).join('');
  const ahora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_HORARIA });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda ${esc(codigoDe(p))}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #000; }
body { width: 72mm; padding: 3mm 2mm 8mm; font: 12px/1.35 ui-monospace, Menlo, Consolas, "Courier New", monospace; }
.c { text-align: center; }
.titulo { border-top: 3px solid #000; border-bottom: 3px solid #000; padding: 3px 0; font-size: 16px; font-weight: 800; letter-spacing: 2px; }
.codigo { margin-top: 4px; font-size: 30px; font-weight: 800; line-height: 1.1; }
.sep { border-top: 1px dashed #000; margin: 6px 0; }
.fin { border-top: 3px solid #000; margin: 6px 0 4px; }
.entrega { font-size: 14px; font-weight: 800; }
.fila { display: flex; gap: 6px; align-items: baseline; }
.cant { min-width: 10mm; font-size: 14px; font-weight: 800; }
.nombre { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.paga { font-weight: 800; }
.total { display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; }
.chica { font-size: 10px; }
</style></head><body>
<div class="c titulo">${prueba ? 'PRUEBA DE IMPRESIÓN' : 'PEDIDO NUEVO'}</div>
<div class="c codigo">${esc(codigoDe(p))}</div>
<div class="c">${esc(origenDe(p).label)} · ${esc(cuando(p.creado_en))}</div>
<div class="sep"></div>
<div class="entrega">${esc(entregaDe(p))}</div>
<div>${esc(p.clienteNombre || 'Cliente sin nombre')}</div>
${tel ? `<div>${esc(tel)}</div>` : ''}
<div class="sep"></div>
${renglones || '<div>Sin productos cargados</div>'}
<div class="sep"></div>
${nota ? `<div style="white-space:pre-wrap"><b>Nota:</b> ${esc(nota)}</div>` : ''}
<div class="paga">${esc(comoPaga(p))}</div>
<div class="total"><span>TOTAL</span><span>${esc(pesos(Number(p.total) || 0))}</span></div>
<div class="fin"></div>
<div class="c chica">Impresa ${esc(ahora)}</div>
</body></html>`;
}

/**
 * Imprime la comanda desde un marco invisible: así no la tapa el estilo de
 * impresión de la pantalla donde esté la persona (la caja esconde todo menos su
 * ticket al imprimir).
 */
export function imprimirComanda(p: PedidoCola, opciones: { prueba?: boolean } = {}): Promise<void> {
  return new Promise((listo) => {
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.tabIndex = -1;
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    let sacado = false;
    const sacar = () => { if (!sacado) { sacado = true; marco.remove(); } };
    marco.onload = () => {
      const w = marco.contentWindow;
      try {
        w?.addEventListener('afterprint', () => setTimeout(sacar, 1000));
        w?.focus();
        w?.print();
      } catch { /* sin impresora: no se traba la pantalla */ }
      // por si el navegador no avisa que terminó
      setTimeout(sacar, 60_000);
      listo();
    };
    marco.srcdoc = htmlComanda(p, opciones);
    document.body.appendChild(marco);
  });
}

/**
 * Imprime la comanda si esta PC todavía no la sacó. Se anota ANTES de imprimir:
 * si la impresora falla, no queda reintentando cada 12 segundos.
 */
export async function imprimirSiFalta(p: PedidoCola): Promise<boolean> {
  const anotar = () => {
    const hechas = leerLS<Record<string, number>>(CLAVE_IMPRESAS, {});
    if (hechas[p.id]) return false;
    const ahora = Date.now();
    for (const [id, t] of Object.entries(hechas)) if (ahora - t > RECUERDA_MS) delete hechas[id];
    hechas[p.id] = ahora;
    guardarLS(CLAVE_IMPRESAS, hechas);
    return true;
  };
  // con dos pestañas abiertas, las dos miran a la vez: el candado deja pasar a una
  const candados = (navigator as any).locks;
  const toca: boolean = candados ? await candados.request('odb-comandas', anotar) : anotar();
  if (toca) await imprimirComanda(p);
  return toca;
}

/** El pedido de muestra de «Imprimir una de prueba». */
export const pedidoDePrueba = (): PedidoCola => ({
  id: 'prueba',
  canal: 'pickup',
  origen: 'bot',
  estado: 'recibido',
  total: 94450,
  qr_retiro: 'PRUEBA',
  creado_en: new Date().toISOString(),
  clienteNombre: 'Cliente de prueba',
  notas: 'Esto es una prueba: no hay que armar nada.',
  items: [
    { cantidad: 6, precio_unitario: 9900, producto: { nombre: 'Fernet Branca 750 ml' } },
    { cantidad: 12, precio_unitario: 2800, producto: { nombre: 'Coca-Cola 2,25 L' } },
    { cantidad: 1, precio_unitario: 1450, producto: { nombre: 'Hielo 3 kg' } },
  ],
});

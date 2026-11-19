'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Entrada, Modal, unir } from './kit';
import { numero } from '../lib/formato';

// Falta en la góndola (Leandro, 19/11/2026: «el que arma el pedido tiene que
// poder modificar artículos por falta de stock»). Lo usan el armado
// (ArmadoPantalla) y la ventana de fiambrería (AvisoFiambreria).

/** Lo mínimo del renglón: qué producto, cuánto pide y cuánto ya está en el carro. */
export type RenglonFalta = { productoId: string; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null; porPeso?: boolean };

/** Lo pesado en gramos o kilos (como lo lee fiambrería); lo demás, el número. */
export function cantidadDe(cantidad: number, porPeso?: boolean) {
  if (!porPeso) return numero(cantidad, 2);
  return cantidad < 1 ? `${Math.round(cantidad * 1000)} g` : `${numero(cantidad, 3)} kg`;
}
const redondo = (n: number) => Math.round(n * 1000) / 1000;

export type Reemplazo = { id: string; nombre: string; stock: number | null };

/** Falta en la góndola (Leandro, 19/11/2026: «el que arma el pedido tiene que
 *  poder modificar artículos por falta de stock»). Cuánto hay de verdad y, si
 *  se quiere, qué va en su lugar. El pedido y su total se corrigen en el
 *  servidor; en el historial queda cuánto había y cuánto decía el sistema. */
export function FaltaEnGondola({ item, onCerrar, onListo }: {
  item: RenglonFalta;
  onCerrar: () => void;
  onListo: (d: { hay: number; reemplazo: Reemplazo | null; cantidad: number | null }) => Promise<void>;
}) {
  const entero = Number.isInteger(item.cantidad);
  const [hay, setHay] = useState(numero(item.enCarro, 3).replace(/\./g, ''));
  const [buscar, setBuscar] = useState('');
  const [opciones, setOpciones] = useState<Reemplazo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [reemplazo, setReemplazo] = useState<Reemplazo | null>(null);
  const [cant, setCant] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nHay = Number(hay.replace(',', '.'));
  const hayValido = hay !== '' && Number.isFinite(nHay) && nHay >= 0 && nHay < item.cantidad - 1e-9;
  const resto = hayValido ? redondo(item.cantidad - nHay) : item.cantidad;
  const nCant = cant === '' ? resto : Number(cant.replace(',', '.'));
  const cantValida = !reemplazo || (Number.isFinite(nCant) && nCant > 0 && nCant <= 1000);

  // buscar el reemplazo (por nombre, SKU o código), con su stock en la sucursal
  useEffect(() => {
    const q = buscar.trim();
    if (q.length < 2 || reemplazo) { setOpciones([]); setBuscando(false); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/salon?recurso=stock&q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const d = r.ok ? await r.json() : [];
        if (!vivo) return;
        setOpciones((Array.isArray(d) ? d : []).filter((x: any) => x.id !== item.productoId).slice(0, 8).map((x: any) => ({
          id: String(x.id),
          nombre: String(x.nombre),
          stock: Array.isArray(x.sucursales) && x.sucursales.length ? x.sucursales.reduce((s: number, y: any) => s + (Number(y.cantidad) || 0), 0) : null,
        })));
      } catch { if (vivo) setOpciones([]); }
      finally { if (vivo) setBuscando(false); }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [buscar, reemplazo, item.productoId]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try { await onListo({ hay: nHay, reemplazo, cantidad: reemplazo ? nCant : null }); }
    catch (e: any) { setError(String(e?.message ?? 'No se pudo cambiar el pedido')); setGuardando(false); }
  }

  const textoBoton = reemplazo ? 'Guardar el cambio' : nHay === 0 ? 'Sacar del pedido' : `Dejar ${cantidadDe(nHay, item.porPeso)}`;
  return (
    <Modal abierto onCerrar={onCerrar} ancho="chico" titulo={`No hay: ${item.nombre}`}
      descripcion={`Pide ${cantidadDe(item.cantidad, item.porPeso)}${item.ubicacion ? ` · ${item.ubicacion}` : ''}`}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={guardar} cargando={guardando} disabled={!hayValido || !cantValida}>{textoBoton}</Boton>
      </>}>
      <p className="mb-2 text-sm text-tinta/70">¿Cuánto hay en la góndola? <span className="text-tinta/50">{item.porPeso ? '(en kilos: 0,1 son 100 g · 0 si no hay nada)' : '(0 si no hay nada)'}</span></p>
      <div className="flex items-center gap-3">
        {entero && <Boton variante="secundario" onClick={() => setHay(String(Math.max(0, (Number.isFinite(nHay) ? nHay : 0) - 1)))} aria-label="Uno menos">−</Boton>}
        <Entrada inputMode="decimal" value={hay} onChange={(e) => setHay(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Cuánto hay en la góndola" className="importe flex-1 text-center text-2xl font-bold" />
        {entero && <Boton variante="secundario" onClick={() => setHay(String(Math.min(item.cantidad - 1, (Number.isFinite(nHay) ? nHay : 0) + 1)))} aria-label="Uno más">+</Boton>}
      </div>
      {!hayValido && hay !== '' && <Aviso tono="atencion" className="mt-3">Tiene que ser menos de {cantidadDe(item.cantidad, item.porPeso)}. Si hay todo, no falta nada.</Aviso>}

      <div className="mt-5 border-t border-black/[0.06] pt-4">
        <p className="mb-2 text-sm font-semibold text-tinta">¿Va otro producto en su lugar? <span className="font-normal text-tinta/50">(si no, dejalo vacío)</span></p>
        {reemplazo ? (
          <div className="rounded-xl bg-ok-suave/70 p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold text-tinta">{reemplazo.nombre}</p>
              <Boton tamano="chico" variante="fantasma" onClick={() => { setReemplazo(null); setCant(''); }}>Cambiar</Boton>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-tinta/70">
              Cantidad
              <Entrada inputMode="decimal" value={cant === '' ? numero(resto, 3).replace(/\./g, '') : cant} onChange={(e) => setCant(e.target.value.replace(/[^\d.,]/g, ''))}
                aria-label={`Cantidad de ${reemplazo.nombre}`} className="importe w-24 text-center font-bold" />
            </label>
            {!cantValida && <Aviso tono="atencion" className="mt-2">Poné una cantidad mayor que 0.</Aviso>}
          </div>
        ) : (
          <>
            <Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar el producto que va en su lugar, por nombre o código" />
            {buscando && <p className="mt-2 text-xs text-tinta/50">Buscando…</p>}
            {!buscando && buscar.trim().length >= 2 && !opciones.length && <p className="mt-2 text-xs text-tinta/60">No encontré nada con «{buscar.trim()}».</p>}
            {opciones.length > 0 && (
              <ul className="mt-2 max-h-56 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.06]">
                {opciones.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => setReemplazo(o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-crema-claro">
                      <span className="min-w-0 flex-1 text-sm text-tinta">{o.nombre}</span>
                      {o.stock != null && <span className={unir('importe shrink-0 text-xs', o.stock > 0 ? 'text-tinta/60' : 'text-marca')}>{o.stock > 0 ? `hay ${numero(o.stock, 2)}` : 'sin stock'}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <p className="mt-4 text-xs text-tinta/60">El total del pedido se corrige solo. Si el cliente ya pagó, te aviso para que se lo digas a la caja.</p>
      {error && <Aviso tono="error" className="mt-3">{error}</Aviso>}
    </Modal>
  );
}

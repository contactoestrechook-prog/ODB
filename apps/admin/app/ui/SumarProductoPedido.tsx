'use client';

// SUMAR UN PRODUCTO A UN PEDIDO QUE YA ENTRÓ (25/11/2026). Leandro: «necesito que si un cliente
// agrega algo exista la posibilidad de sumar el producto». El caso: la clienta de St Thomas
// Oeste 623 sumó 4 bidones por WhatsApp con el pedido ya armándose.
// Precio de lista del momento y stock de la sucursal a la vista; la base suma el renglón, lo
// reserva, sube el total y lo anota en el historial. Si alguien lo está armando, le llega por
// la charla del pedido y por WhatsApp.
import { useState } from 'react';
import { Aviso, Boton, Campo, Entrada } from './kit';
import { pesos } from '../lib/formato';
import { BuscadorProducto, type Encontrado } from './BuscadorProducto';
import { nombrePropio } from './salon/comun';

type Respuesta = { nombre: string; cantidad: number; total: number; estado: string; avisado: string | null; message?: string };

const cant = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 3 }));

export function SumarProductoPedido({ pedidoId, sucursalId, onSumado }: { pedidoId: string; sucursalId: string; onSumado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<Encontrado | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const n = Number(cantidad.replace(',', '.'));
  const cantidadOk = Number.isFinite(n) && n > 0 && n <= 9999;
  const alcanza = !elegido || elegido.stock == null || n <= elegido.stock;

  const cerrar = () => { setAbierto(false); setElegido(null); setCantidad('1'); setError(null); };

  const sumar = async () => {
    if (!elegido || !cantidadOk || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch('/api/salon', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sumar', pedidoId, productoId: elegido.productoId, cantidad: n }),
      });
      const d = (await r.json().catch(() => ({}))) as Respuesta;
      if (!r.ok) { setError(d?.message ?? 'No se pudo sumar. Probá de nuevo.'); return; }
      const quien = d.avisado ? nombrePropio(d.avisado).split(' ')[0] : null;
      const aviso = quien
        ? ` Le llegó a ${quien} para que lo arme.`
        : d.estado === 'listo' ? ' El pedido ya estaba listo: sumalo a la bolsa.' : '';
      setHecho(`Se sumó ${cant(Number(d.cantidad))} × ${d.nombre}. El total ahora es ${pesos(d.total)}.${aviso}`);
      cerrar();
      onSumado();
    } catch {
      setError('No me pude conectar. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section aria-label="Sumar un producto" className="space-y-2">
      {hecho && <Aviso tono="ok">{hecho}</Aviso>}
      {!abierto ? (
        <Boton tamano="chico" variante="secundario" onClick={() => { setHecho(null); setAbierto(true); }}>+ Sumar un producto</Boton>
      ) : (
        <div className="space-y-3 rounded-xl border border-black/[0.08] bg-crema-claro p-3">
          <h3 className="text-sm font-semibold text-tinta">El cliente agregó algo</h3>
          {!elegido ? (
            <BuscadorProducto sucursalId={sucursalId} onElegir={(e) => { setElegido(e); setError(null); }} etiqueta="¿Qué sumó?" sinStockNo />
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-sm">
                <p className="min-w-0 flex-1 break-words text-tinta">
                  <b className="font-semibold">{elegido.nombre}</b>
                  <span className="text-tinta/60"> · {elegido.precio != null ? pesos(elegido.precio) : 'sin precio'}{elegido.stock != null ? ` · hay ${cant(elegido.stock)}` : ''}</span>
                </p>
                <Boton tamano="chico" variante="fantasma" onClick={() => setElegido(null)} disabled={enviando}>Cambiar</Boton>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Campo etiqueta="Cantidad">
                  <Entrada value={cantidad} onChange={(e) => setCantidad(e.target.value)} type="number" inputMode="decimal" min={0} step="any"
                    className="importe w-24 text-right" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sumar(); } }} />
                </Campo>
                {cantidadOk && elegido.precio != null && (
                  <p className="pb-2 text-sm text-tinta">Suma <b className="importe font-semibold">{pesos(n * elegido.precio)}</b></p>
                )}
              </div>
              {!alcanza && <Aviso tono="atencion">En el sistema hay {cant(elegido.stock ?? 0)}: no alcanza para {cant(n)}.</Aviso>}
            </div>
          )}
          {error && <Aviso tono="error">{error}</Aviso>}
          <div className="flex flex-wrap gap-2">
            <Boton tamano="chico" variante="fantasma" onClick={cerrar} disabled={enviando}>Cancelar</Boton>
            {elegido && <Boton tamano="chico" onClick={sumar} cargando={enviando} disabled={!cantidadOk || !alcanza}>Sumar al pedido</Boton>}
          </div>
        </div>
      )}
    </section>
  );
}

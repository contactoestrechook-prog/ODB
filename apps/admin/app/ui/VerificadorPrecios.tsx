'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conectarImpresora, hayBluetooth, imprimirEtiqueta, impresoraConectada } from '../lib/impresora-bt';

// Verificador de precios para el salón. Pensado para un equipo de mano con
// lector: se escanea y el precio aparece en letra grande, legible a un brazo de
// distancia y con la góndola de fondo. Sin campos que enfocar ni menús.
//
// El botón de etiqueta usa la impresión del navegador a propósito: así imprime
// igual desde una PC con cualquier impresora, y en un equipo con impresora
// integrada (Sunmi y similares, con su complemento de impresión instalado) sale
// por la impresora del aparato sin que haya que desarrollar nada aparte.

type Producto = {
  sku: string;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  imagenUrl: string | null;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  volumenMl: number | null;
  unidadesPack: number | null;
  esAlcohol: boolean;
  stockPorSucursal: { sucursal_id: string; cantidad: number }[];
  codigosBarras: string[];
};

const pesos = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));

export function VerificadorPrecios({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [texto, setTexto] = useState('');
  const [producto, setProducto] = useState<Producto | null>(null);
  const [opciones, setOpciones] = useState<Producto[]>([]);
  const [aviso, setAviso] = useState('');
  const [buscando, setBuscando] = useState(false);
  const buffer = useRef('');
  const reloj = useRef<any>(null);
  // impresora de etiquetas por Bluetooth (Urovo K419 y compatibles)
  const [impresora, setImpresora] = useState<string | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [copias, setCopias] = useState(1);
  const [errorImp, setErrorImp] = useState('');

  const buscar = useCallback(async (q: string) => {
    const t = q.trim();
    if (t.length < 2) return;
    setBuscando(true);
    setAviso('');
    try {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(t)}`);
      const d = await r.json();
      const items: Producto[] = d?.items ?? [];
      if (!items.length) {
        setProducto(null);
        setOpciones([]);
        setAviso(`No encontré nada con "${t}". Si es mercadería nueva, hay que darla de alta.`);
        return;
      }
      if (items.length === 1) { setProducto(items[0]); setOpciones([]); return; }
      setProducto(null);
      setOpciones(items);
    } catch {
      setAviso('No pude consultar. Fijate la conexión y probá de nuevo.');
    } finally {
      setBuscando(false);
    }
  }, []);

  // Captura del lector: teclea en ráfaga y termina en Enter. Igual que en
  // Recepción y en la caja — no hace falta tener ningún casillero enfocado.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const donde = e.target as HTMLElement;
      if (donde && (donde.tagName === 'INPUT' || donde.tagName === 'TEXTAREA' || donde.isContentEditable)) return;
      if (e.key === 'Enter') {
        const codigo = buffer.current.trim();
        buffer.current = '';
        if (codigo) { setTexto(codigo); buscar(codigo); }
        return;
      }
      if (e.key.length === 1) {
        buffer.current += e.key;
        clearTimeout(reloj.current);
        reloj.current = setTimeout(() => { buffer.current = ''; }, 250);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => { window.removeEventListener('keydown', alTeclear); clearTimeout(reloj.current); };
  }, [buscar]);

  const limpiar = () => { setProducto(null); setOpciones([]); setTexto(''); setAviso(''); setErrorImp(''); };

  const vincularImpresora = async () => {
    setErrorImp('');
    try { setImpresora(await conectarImpresora()); }
    catch (e: any) { setErrorImp(e?.message ?? 'No pude conectar la impresora'); }
  };

  // Imprime en la térmica si hay uso de Bluetooth; si no (PC), usa la
  // impresión del navegador, que es la que ya funcionaba.
  const imprimir = async () => {
    if (!producto) return;
    if (!hayBluetooth()) { window.print(); return; }
    setImprimiendo(true);
    setErrorImp('');
    try {
      await imprimirEtiqueta({
        nombre: producto.nombre,
        marca: producto.marca,
        precio: producto.precio,
        promo: producto.descuento,
        codigo: producto.codigosBarras?.[0] ?? null,
        sku: producto.sku,
        copias,
      });
      setImpresora(impresoraConectada());
    } catch (e: any) {
      setErrorImp(e?.message ?? 'No pude imprimir');
    } finally {
      setImprimiendo(false);
    }
  };
  const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      {/* la etiqueta solo existe al imprimir: 58 mm de ancho, alto libre */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #etiqueta, #etiqueta * { visibility: visible !important; }
          #etiqueta { position: absolute; left: 0; top: 0; width: 54mm; }
          @page { size: 58mm auto; margin: 2mm; }
        }
      `}</style>

      <form
        onSubmit={(e) => { e.preventDefault(); buscar(texto); }}
        className="flex gap-2 print:hidden"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pasá el lector, o escribí nombre / código"
          className="flex-1 rounded-xl border-2 border-[#B82D25] bg-white px-4 py-3 text-base text-black outline-none"
          autoFocus
        />
        <button type="submit" className="rounded-xl bg-[#B82D25] px-5 py-3 text-sm font-medium text-white">
          {buscando ? '…' : 'Buscar'}
        </button>
      </form>

      {hayBluetooth() && (
        <div className="mt-2 flex items-center justify-between text-xs print:hidden">
          <span className={impresora ? 'text-emerald-700' : 'text-black/40'}>
            {impresora ? `Impresora: ${impresora}` : 'Impresora de etiquetas sin conectar'}
          </span>
          <button onClick={vincularImpresora} className="text-[#B82D25] underline">
            {impresora ? 'cambiar' : 'conectar impresora'}
          </button>
        </div>
      )}

      {aviso && <p className="mt-4 rounded-xl bg-white p-4 text-sm text-[#B82D25] print:hidden">{aviso}</p>}

      {opciones.length > 0 && (
        <div className="mt-4 rounded-xl bg-white divide-y divide-black/5 print:hidden">
          <p className="px-4 py-2 text-xs text-black/45">{opciones.length} coincidencias — tocá la que buscás</p>
          {opciones.map((p) => (
            <button key={p.sku} onClick={() => { setProducto(p); setOpciones([]); }} className="w-full text-left px-4 py-3 hover:bg-[#F0EBE2]/60 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm text-black">{p.nombre}</span>
                <span className="text-xs text-black/45">{p.sku}{p.marca ? ` · ${p.marca}` : ''}</span>
              </span>
              <span className="shrink-0 font-semibold text-black">{pesos(p.precio)}</span>
            </button>
          ))}
        </div>
      )}

      {producto && (
        <>
          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm print:hidden">
            <div className="flex gap-4">
              {producto.imagenUrl && (
                <img src={producto.imagenUrl} alt="" className="h-20 w-20 rounded-lg object-cover border border-black/10 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-lg font-semibold text-black leading-tight">{producto.nombre}</p>
                <p className="text-xs text-black/45 mt-0.5">
                  {producto.sku}
                  {producto.marca ? ` · ${producto.marca}` : ''}
                  {producto.categoria ? ` · ${producto.categoria}` : ''}
                  {producto.esAlcohol ? ' · +18' : ''}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-[#F0EBE2]/70 px-4 py-5 text-center">
              {producto.descuento && producto.precioLista != null && (
                <p className="text-sm text-black/40 line-through">{pesos(producto.precioLista)}</p>
              )}
              <p className="text-5xl font-bold text-black tabular-nums leading-none">{pesos(producto.precio)}</p>
              {producto.descuento && <p className="mt-1 text-sm font-medium text-[#B82D25]">{producto.descuento}</p>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {sucursales.map((s) => {
                const st = producto.stockPorSucursal?.find((x) => x.sucursal_id === s.id);
                const cant = Number(st?.cantidad ?? 0);
                return (
                  <div key={s.id} className="rounded-lg border border-black/10 px-3 py-2">
                    <p className="text-[11px] text-black/45">{s.nombre}</p>
                    <p className={`text-lg font-semibold tabular-nums ${cant > 0 ? 'text-black' : 'text-[#B82D25]'}`}>{cant}</p>
                  </div>
                );
              })}
            </div>

            {producto.codigosBarras?.length > 0 && (
              <p className="mt-2 text-[11px] font-mono text-black/35">{producto.codigosBarras.join(' · ')}</p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={imprimir}
                disabled={imprimiendo}
                className="flex-1 rounded-full bg-[#B82D25] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {imprimiendo ? 'Imprimiendo…' : 'Imprimir etiqueta'}
              </button>
              {/* cuántas etiquetas: reponer una góndola son varias del mismo */}
              <div className="flex items-center rounded-full border border-black/15">
                <button onClick={() => setCopias((c) => Math.max(1, c - 1))} className="px-3 py-3 text-black/50">−</button>
                <span className="w-6 text-center text-sm tabular-nums text-black">{copias}</span>
                <button onClick={() => setCopias((c) => Math.min(20, c + 1))} className="px-3 py-3 text-black/50">+</button>
              </div>
              <button onClick={limpiar} className="rounded-full border border-black/15 px-5 py-3 text-sm text-black/70">
                Otro
              </button>
            </div>
            {errorImp && <p className="mt-2 text-xs text-[#B82D25]">{errorImp}</p>}
          </div>

          {/* Etiqueta: lo único que se ve al imprimir */}
          <div id="etiqueta" style={{ display: 'none' }} className="print:block">
            <div style={{ fontFamily: 'Arial, sans-serif', color: '#000', textAlign: 'center' }}>
              <div style={{ fontSize: '11pt', fontWeight: 700, lineHeight: 1.15 }}>{producto.nombre}</div>
              {producto.marca && <div style={{ fontSize: '8pt' }}>{producto.marca}</div>}
              <div style={{ fontSize: '30pt', fontWeight: 800, lineHeight: 1.1, margin: '2mm 0' }}>
                {pesos(producto.precio)}
              </div>
              {producto.descuento && <div style={{ fontSize: '8pt', fontWeight: 700 }}>{producto.descuento}</div>}
              <div style={{ fontSize: '7pt', fontFamily: 'monospace' }}>{producto.codigosBarras?.[0] ?? producto.sku}</div>
              <div style={{ fontSize: '6pt' }}>{producto.sku} · {hoy}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

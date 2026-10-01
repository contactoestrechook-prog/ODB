'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conectarImpresora, hayBluetooth, imprimirEtiqueta, impresoraConectada } from '../lib/impresora-bt';
import { Aviso, Boton, Entrada, Tarjeta, FOCO_ADENTRO, unir } from './kit';
import { fecha, pesos } from '../lib/formato';

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
  const hoy = fecha(new Date(), 'completa');

  return (
    <div className="space-y-4">
      {/* la etiqueta solo existe al imprimir: 58 mm de ancho, alto libre.
          Lo demás (menú, cabecera, la ficha) queda invisible y sin ocupar lugar. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #etiqueta, #etiqueta * { visibility: visible !important; }
          /* display: block con !important: el display:none en línea de la etiqueta le gana a la clase print:block */
          #etiqueta { display: block !important; position: absolute; left: 0; top: 0; width: 54mm; }
          main { min-height: 0 !important; padding: 0 !important; }
          @page { size: 58mm auto; margin: 2mm; }
        }
      `}</style>

      <form
        onSubmit={(e) => { e.preventDefault(); buscar(texto); }}
        className="flex gap-2 print:hidden"
      >
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pasá el lector, o escribí nombre / código"
          aria-label="Buscar producto"
          className="min-w-0 flex-1"
          autoFocus
        />
        <Boton type="submit" className="shrink-0">
          {buscando ? '…' : 'Buscar'}
        </Boton>
      </form>

      {hayBluetooth() && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs print:hidden">
          <span className={unir('min-w-0 break-words', impresora ? 'text-ok' : 'text-tinta/60')}>
            {impresora ? `Impresora: ${impresora}` : 'Impresora de etiquetas sin conectar'}
          </span>
          <Boton variante="fantasma" tamano="chico" onClick={vincularImpresora}>
            {impresora ? 'cambiar' : 'conectar impresora'}
          </Boton>
        </div>
      )}

      {aviso && <Aviso tono="error" className="print:hidden">{aviso}</Aviso>}

      {opciones.length > 0 && (
        <Tarjeta relleno={false} className="divide-y divide-black/[0.06] overflow-hidden print:hidden">
          <p className="px-4 py-2 text-xs text-tinta/60">{opciones.length} coincidencias — tocá la que buscás</p>
          {opciones.map((p) => (
            <button
              key={p.sku}
              type="button"
              onClick={() => { setProducto(p); setOpciones([]); }}
              className={unir('flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-crema-claro', FOCO_ADENTRO)}
            >
              <span className="min-w-0">
                <span className="block min-w-0 break-words text-sm text-tinta">{p.nombre}</span>
                <span className="text-xs text-tinta/60">{p.sku}{p.marca ? ` · ${p.marca}` : ''}</span>
              </span>
              <span className="importe shrink-0 font-semibold text-tinta">{pesos(p.precio)}</span>
            </button>
          ))}
        </Tarjeta>
      )}

      {producto && (
        <>
          <Tarjeta className="print:hidden">
            <div className="flex gap-4">
              {producto.imagenUrl && (
                <img src={producto.imagenUrl} alt="" className="size-20 shrink-0 rounded-xl border border-black/[0.06] object-cover" />
              )}
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold leading-tight text-tinta">{producto.nombre}</p>
                <p className="mt-0.5 break-words text-xs text-tinta/60">
                  {producto.sku}
                  {producto.marca ? ` · ${producto.marca}` : ''}
                  {producto.categoria ? ` · ${producto.categoria}` : ''}
                  {producto.esAlcohol ? ' · +18' : ''}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-crema-claro px-4 py-5 text-center">
              {producto.descuento && producto.precioLista != null && (
                <p className="importe text-sm text-tinta/60 line-through">{pesos(producto.precioLista)}</p>
              )}
              {/* el precio se achica con la pantalla para no salirse en un equipo de mano angosto */}
              <p className="importe text-[clamp(2.25rem,12vw,3rem)] font-bold leading-none tracking-tight text-tinta">{pesos(producto.precio)}</p>
              {producto.descuento && <p className="mt-1 text-sm font-semibold text-marca-hondo">{producto.descuento}</p>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {sucursales.map((s) => {
                const st = producto.stockPorSucursal?.find((x) => x.sucursal_id === s.id);
                const cant = Number(st?.cantidad ?? 0);
                return (
                  <div key={s.id} className="min-w-0 rounded-xl border border-black/[0.06] px-3 py-2">
                    <p className="truncate text-xs text-tinta/60">{s.nombre}</p>
                    <p className={`importe text-lg font-semibold ${cant > 0 ? 'text-tinta' : 'text-marca-hondo'}`}>{cant}</p>
                  </div>
                );
              })}
            </div>

            {producto.codigosBarras?.length > 0 && (
              <p className="mt-2 break-all font-mono text-xs text-tinta/60">{producto.codigosBarras.join(' · ')}</p>
            )}

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center">
              <Boton
                onClick={imprimir}
                disabled={imprimiendo}
                className="col-span-2 sm:flex-1"
              >
                {imprimiendo ? 'Imprimiendo…' : 'Imprimir etiqueta'}
              </Boton>
              {/* cuántas etiquetas: reponer una góndola son varias del mismo */}
              <div className="flex items-center justify-self-start rounded-full border border-black/15 bg-white" role="group" aria-label="Cantidad de etiquetas">
                <button
                  type="button"
                  onClick={() => setCopias((c) => Math.max(1, c - 1))}
                  aria-label="Una etiqueta menos"
                  className={unir('grid size-11 place-items-center rounded-full text-lg text-tinta/70 hover:text-tinta sm:size-10', FOCO_ADENTRO)}
                >
                  −
                </button>
                <span className="importe w-6 text-center text-sm text-tinta" aria-live="polite">{copias}</span>
                <button
                  type="button"
                  onClick={() => setCopias((c) => Math.min(20, c + 1))}
                  aria-label="Una etiqueta más"
                  className={unir('grid size-11 place-items-center rounded-full text-lg text-tinta/70 hover:text-tinta sm:size-10', FOCO_ADENTRO)}
                >
                  +
                </button>
              </div>
              <Boton variante="secundario" onClick={limpiar}>
                Otro
              </Boton>
            </div>
            {errorImp && <Aviso tono="error" className="mt-3">{errorImp}</Aviso>}
          </Tarjeta>

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

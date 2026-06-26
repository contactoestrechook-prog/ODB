'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Producto = {
  imagenUrl: string | null;
  sku: string;
  nombre: string;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  esAlcohol: boolean;
  codigosBarras: string[];
  codigo?: string | null; // código interno de ODB (lo que se escanea / imprime en la etiqueta)
};

type Renglon = Producto & { cantidad: number };

type Cliente = {
  existe: boolean;
  dni: string;
  tipo?: string;
  compras?: number;
  ticketPromedio?: number;
};

const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MEDIOS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'mercadopago', label: 'MP QR' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'cta_cte', label: 'Cta. cte.' },
];

export function Caja({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [dni, setDni] = useState('');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [medio, setMedio] = useState('efectivo');
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [pagaCon, setPagaCon] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [catalogoLocal, setCatalogoLocal] = useState<any[]>([]);
  const [seleccion, setSeleccion] = useState<string | null>(null); // sku del renglón que edita el teclado
  const [cantBuf, setCantBuf] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debRef = useRef<any>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, [carrito.length]);

  // Precarga el catálogo con stock (≈575) para búsqueda LOCAL instantánea.
  useEffect(() => {
    fetch('/api/pos-catalogo')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setCatalogoLocal((d.items ?? []).map((p: any) => ({ ...p, _n: norm(p.nombre) }))))
      .catch(() => {});
  }, []);

  function filtrarLocal(t: string): Producto[] {
    const n = norm(t);
    const low = t.toLowerCase();
    return catalogoLocal
      .filter((p) =>
        p.codigo === t ||
        p._n?.includes(n) ||
        p.sku?.toLowerCase().startsWith(low) ||
        (p.codigosBarras ?? []).some((c: string) => c.includes(t)),
      )
      .slice(0, 8);
  }

  // El total cobrable se recalcula también en el servidor: esto es solo display
  const total = carrito.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0);
  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);
  const subtotalLista = carrito.reduce(
    (s, r) => s + (Number(r.precioLista ?? r.precio) || 0) * r.cantidad,
    0,
  );
  const pagaConN = Number(pagaCon) || 0;
  const vuelto = medio === 'efectivo' && pagaConN > 0 ? pagaConN - total : null;

  function agregar(p: Producto) {
    if (p.precio == null) {
      setEstado({ tipo: 'error', texto: `"${p.nombre}" no tiene precio cargado — no se puede vender` });
      setBusqueda(''); setResultados([]);
      return;
    }
    setCarrito((c) => {
      const existente = c.find((r) => r.sku === p.sku);
      if (existente) {
        return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + 1 } : r));
      }
      return [...c, { ...p, cantidad: 1 }];
    });
    setBusqueda('');
    setResultados([]);
    setEstado(null);
  }

  function onBuscar(termino: string) {
    setBusqueda(termino);
    setEstado(null);
    if (debRef.current) clearTimeout(debRef.current);
    const t = termino.trim();
    if (t.length < 2) { setResultados([]); return; }
    if (/^\d{4,14}$/.test(t)) {
      const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
      if (ex) { agregar(ex); return; }
    }
    const locales = filtrarLocal(t);
    setResultados(locales);
    if (locales.length === 0) debRef.current = setTimeout(() => ejecutar(t, false), 170);
  }

  async function ejecutar(t: string, esEnter: boolean) {
    const seq = ++seqRef.current;
    setBuscando(true);
    try {
      const res = await fetch(`/api/pos-buscar?q=${encodeURIComponent(t)}`);
      const datos: Producto[] = res.ok ? ((await res.json()).items ?? []) : [];
      if (seq !== seqRef.current) return;
      const esCodigo = /^\d{6,14}$/.test(t);
      if (esCodigo || esEnter) {
        const exacto = datos.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t)) ?? (datos.length === 1 ? datos[0] : null);
        if (exacto) { agregar(exacto); return; }
        if (esCodigo && datos.length === 0) { setEstado({ tipo: 'error', texto: `Código ${t} no encontrado` }); setResultados([]); return; }
      }
      setResultados(datos);
    } catch {
      if (seq === seqRef.current) setEstado({ tipo: 'error', texto: 'No se pudo buscar (revisá la conexión)' });
    } finally {
      if (seq === seqRef.current) setBuscando(false);
    }
  }

  function onKeyBuscar(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (debRef.current) clearTimeout(debRef.current);
    const t = busqueda.trim();
    const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
    if (ex) { agregar(ex); return; }
    if (resultados[0]) { agregar(resultados[0]); return; }
    if (t.length >= 1) ejecutar(t, true);
  }

  function cambiarCantidad(sku: string, delta: number) {
    setCarrito((c) =>
      c
        .map((r) => (r.sku === sku ? { ...r, cantidad: r.cantidad + delta } : r))
        .filter((r) => r.cantidad > 0),
    );
  }
  function quitar(sku: string) {
    setCarrito((c) => c.filter((r) => r.sku !== sku));
    if (seleccion === sku) setSeleccion(null);
  }

  // ---- teclado numérico en pantalla ----
  function seleccionarLinea(sku: string) {
    setSeleccion((s) => (s === sku ? null : sku));
    setCantBuf('');
  }
  function tecla(k: string) {
    const apply = (cur: string) => (k === 'C' ? '' : k === '⌫' ? cur.slice(0, -1) : cur === '0' ? k : cur + k);
    if (seleccion) {
      const nb = apply(cantBuf);
      setCantBuf(nb);
      const n = Number(nb);
      setCarrito((c) => c.map((r) => (r.sku === seleccion ? { ...r, cantidad: nb === '' ? r.cantidad : Math.max(1, Math.min(999, n || 1)) } : r)));
    } else {
      setPagaCon((p) => apply(p));
    }
  }
  function sumarCash(n: number) { setSeleccion(null); setPagaCon((p) => String((Number(p) || 0) + n)); }

  async function buscarCliente() {
    if (!dni.trim()) return;
    const res = await fetch(`/api/cliente?dni=${encodeURIComponent(dni.trim())}`);
    if (res.ok) setCliente(await res.json());
  }

  async function cobrar() {
    if (carrito.length === 0 || cobrando) return;
    setCobrando(true);
    setEstado(null);
    const res = await fetch('/api/venta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursalId,
        canal: 'mostrador',
        items: carrito.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
        pagos: [{ medio, monto: total }],
        clienteDni: cliente?.dni ?? (dni.trim() || undefined),
      }),
    });
    const datos = await res.json();
    if (res.ok) {
      const vueltoTxt = medio === 'efectivo' && pagaConN > total ? ` · VUELTO ${pesos(pagaConN - total)}` : '';
      setEstado({
        tipo: 'ok',
        texto: `✓ Venta ${pesos(datos.total)}${Number(datos.descuento) > 0 ? ` (ahorró ${pesos(datos.descuento)})` : ''}${datos.tipo_cliente ? ` · ${datos.tipo_cliente}` : ''}${vueltoTxt}`,
      });
      setCarrito([]);
      setCliente(null);
      setDni('');
      setPagaCon('');
      setSeleccion(null);
      inputRef.current?.focus();
    } else {
      setEstado({ tipo: 'error', texto: datos.message ?? 'No se pudo registrar la venta' });
    }
    setCobrando(false);
  }

  const seleccionado = carrito.find((r) => r.sku === seleccion) || null;

  return (
    <main className="h-screen bg-[#F0EBE2] flex flex-col overflow-hidden">
      <header className="bg-black px-4 py-3 flex items-center justify-between shrink-0">
        <span className="text-white tracking-widest font-medium">
          O.D.B <span className="tracking-normal font-normal text-[#F0EBE2]/70">· Caja</span>
        </span>
        <div className="flex items-center gap-3">
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="rounded-lg bg-white/10 text-[#F0EBE2] px-3 py-2 text-sm"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id} className="text-black">{s.nombre}</option>
            ))}
          </select>
          <Link href="/ventas" className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm">Panel</Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-3 p-3 overflow-hidden">
        {/* IZQUIERDA: búsqueda + carrito */}
        <section className="rounded-2xl bg-white p-3 flex flex-col overflow-hidden">
          <div className="relative shrink-0">
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => onBuscar(e.target.value)}
              onKeyDown={onKeyBuscar}
              placeholder="Escaneá o buscá un producto…"
              autoFocus
              inputMode="search"
              className="w-full rounded-2xl border-2 border-[#B82D25] px-5 py-4 text-lg text-black outline-none"
            />
            {buscando && <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm text-black/40">buscando…</span>}
            {resultados.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-2xl bg-white border border-black/10 overflow-hidden shadow-xl">
                {resultados.map((p) => (
                  <button
                    key={p.sku}
                    onClick={() => agregar(p)}
                    className="w-full px-4 py-3.5 text-left text-black active:bg-[#F0EBE2] hover:bg-[#F0EBE2] flex items-center justify-between gap-3 border-b border-black/5 last:border-0"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      {p.imagenUrl && <img src={p.imagenUrl} alt="" className="h-11 w-11 rounded-lg object-cover shrink-0" />}
                      <span className="truncate text-base">{p.nombre}</span>
                      {p.esAlcohol && <span className="rounded-full bg-black px-1.5 py-0.5 text-[10px] text-white shrink-0">+18</span>}
                    </span>
                    <span className="font-semibold text-lg whitespace-nowrap">{pesos(p.precio)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* carrito */}
          <div className="flex-1 overflow-y-auto mt-3 -mx-1 px-1">
            {carrito.length === 0 && (
              <div className="h-full flex items-center justify-center text-black/35 text-base">
                Escaneá un producto para empezar
              </div>
            )}
            {carrito.map((r) => {
              const sel = r.sku === seleccion;
              return (
                <div
                  key={r.sku}
                  className={`rounded-xl mb-2 px-3 py-2.5 flex items-center gap-2 border-2 ${sel ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-transparent bg-[#F0EBE2]/50'}`}
                >
                  <button onClick={() => seleccionarLinea(r.sku)} className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-black leading-tight">{r.nombre}</p>
                    <p className="text-xs text-black/45">{pesos(r.precio)} c/u{r.descuento ? ` · ${r.descuento}` : ''}{sel ? ' · tocá los números para la cantidad' : ''}</p>
                  </button>
                  <button onClick={() => cambiarCantidad(r.sku, -1)} className="h-12 w-12 rounded-xl bg-white border border-black/10 text-2xl text-black active:scale-95 shrink-0" aria-label="Restar">−</button>
                  <span className="w-9 text-center text-xl font-semibold tabular-nums">{r.cantidad}</span>
                  <button onClick={() => cambiarCantidad(r.sku, 1)} className="h-12 w-12 rounded-xl bg-black text-white text-2xl active:scale-95 shrink-0" aria-label="Sumar">+</button>
                  <span className="w-24 text-right font-semibold text-lg whitespace-nowrap shrink-0">{pesos((r.precio ?? 0) * r.cantidad)}</span>
                  <button onClick={() => quitar(r.sku)} className="h-12 w-10 rounded-xl text-black/30 active:text-[#B82D25] text-xl shrink-0" aria-label="Quitar">✕</button>
                </div>
              );
            })}
          </div>
        </section>

        {/* DERECHA: total + medios + teclado + cobrar */}
        <section className="rounded-2xl bg-white p-3 flex flex-col gap-3 overflow-y-auto">
          {/* total */}
          <div className="rounded-xl bg-black text-white px-4 py-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-white/60">{unidades} u.</span>
              {subtotalLista > total && <span className="text-xs text-[#F0EBE2]/60 line-through">{pesos(subtotalLista)}</span>}
            </div>
            <div className="flex justify-between items-baseline mt-0.5">
              <span className="text-sm text-white/70">Total</span>
              <span className="text-4xl font-semibold tabular-nums">{pesos(total)}</span>
            </div>
          </div>

          {/* medios */}
          <div className="grid grid-cols-2 gap-2">
            {MEDIOS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMedio(m.id)}
                className={'rounded-xl py-3.5 text-base font-medium border-2 active:scale-95 ' +
                  (medio === m.id ? 'bg-black text-white border-black' : 'bg-white text-black border-black/10')}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* display del teclado: cantidad o paga con */}
          <div className="rounded-xl bg-[#F0EBE2]/60 px-4 py-2.5 flex items-center justify-between">
            {seleccionado ? (
              <>
                <span className="text-sm text-black/60 truncate mr-2">Cantidad · {seleccionado.nombre}</span>
                <span className="text-2xl font-semibold tabular-nums">{seleccionado.cantidad}</span>
              </>
            ) : (
              <>
                <span className="text-sm text-black/60">{medio === 'efectivo' ? 'Paga con' : 'Importe recibido'}</span>
                <span className="text-2xl font-semibold tabular-nums">{pagaCon ? pesos(pagaConN) : '$0'}</span>
              </>
            )}
          </div>

          {/* atajos de efectivo */}
          {!seleccionado && (
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => setPagaCon(String(total))} className="rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium active:scale-95">Justo</button>
              {[1000, 2000, 5000].map((n) => (
                <button key={n} onClick={() => sumarCash(n)} className="rounded-lg bg-white border border-black/10 py-2.5 text-sm font-medium active:scale-95">+{n / 1000}k</button>
              ))}
            </div>
          )}

          {/* teclado numérico */}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <button
                key={k}
                onClick={() => tecla(k)}
                className={'rounded-xl py-4 text-2xl font-medium active:scale-95 ' +
                  (k === 'C' ? 'bg-[#B82D25]/10 text-[#932A1F]' : k === '⌫' ? 'bg-black/5 text-black' : 'bg-[#F0EBE2] text-black')}
              >
                {k}
              </button>
            ))}
          </div>

          {vuelto != null && (
            <div className={`rounded-xl px-4 py-3 text-center text-lg font-semibold ${vuelto < 0 ? 'bg-[#B82D25]/10 text-[#932A1F]' : 'bg-emerald-50 text-emerald-700'}`}>
              {vuelto < 0 ? `Faltan ${pesos(-vuelto)}` : `Vuelto ${pesos(vuelto)}`}
            </div>
          )}

          {/* cliente (opcional, compacto) */}
          <div className="flex gap-2">
            <input
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscarCliente()}
              placeholder="DNI cliente (opcional)"
              inputMode="numeric"
              className="flex-1 rounded-xl border border-black/15 px-3 py-3 text-base text-black outline-none focus:border-[#B82D25]"
            />
            <button onClick={buscarCliente} className="rounded-xl bg-black px-5 text-base text-white active:scale-95">Buscar</button>
          </div>
          {cliente && (
            <p className={`rounded-xl px-3 py-2 text-sm ${cliente.existe ? 'bg-black text-white' : 'bg-[#F0EBE2] text-black'}`}>
              {cliente.existe ? `${cliente.tipo} · ${cliente.compras} compras · ticket ${pesos(cliente.ticketPromedio)}` : 'Cliente nuevo: se registra con esta venta'}
            </p>
          )}

          {/* cobrar */}
          <button
            onClick={cobrar}
            disabled={carrito.length === 0 || cobrando}
            className="mt-auto rounded-2xl bg-[#B82D25] py-6 text-2xl font-semibold text-white active:scale-95 disabled:opacity-40"
          >
            {cobrando ? 'Cobrando…' : `Cobrar ${pesos(total)}`}
          </button>

          {estado && (
            <p className={'rounded-xl px-3 py-3 text-base ' + (estado.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-[#B82D25]/10 text-[#932A1F]')}>
              {estado.texto}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

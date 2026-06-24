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
        p.codigo === t ||                                  // código interno exacto (escaneo)
        p._n?.includes(n) ||
        p.sku?.toLowerCase().startsWith(low) ||
        (p.codigosBarras ?? []).some((c: string) => c.includes(t)),
      )
      .slice(0, 8);
  }

  // El total cobrable se recalcula también en el servidor: esto es solo display
  const total = carrito.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0);
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

  // local-first: busca instantáneo en el catálogo precargado; si no hay nada,
  // cae al server (productos "a pedido" / fuera de stock). El escáner agrega solo.
  function onBuscar(termino: string) {
    setBusqueda(termino);
    setEstado(null);
    if (debRef.current) clearTimeout(debRef.current);
    const t = termino.trim();
    if (t.length < 2) { setResultados([]); return; }
    // código interno / barra exacto en el catálogo local → agrega al instante
    if (/^\d{4,14}$/.test(t)) {
      const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
      if (ex) { agregar(ex); return; }
    }
    const locales = filtrarLocal(t);
    setResultados(locales);
    // sin match local → buscar en el servidor (debounced)
    if (locales.length === 0) debRef.current = setTimeout(() => ejecutar(t, false), 170);
  }

  async function ejecutar(t: string, esEnter: boolean) {
    const seq = ++seqRef.current;
    setBuscando(true);
    try {
      const res = await fetch(`/api/pos-buscar?q=${encodeURIComponent(t)}`);
      const datos: Producto[] = res.ok ? ((await res.json()).items ?? []) : [];
      if (seq !== seqRef.current) return; // descarta respuestas viejas
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
    // 1) match exacto por código interno / sku / barra (escaneo)
    const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
    if (ex) { agregar(ex); return; }
    // 2) primer resultado mostrado
    if (resultados[0]) { agregar(resultados[0]); return; }
    // 3) server (a pedido / fuera de stock)
    if (t.length >= 1) ejecutar(t, true);
  }

  function cambiarCantidad(sku: string, delta: number) {
    setCarrito((c) =>
      c
        .map((r) => (r.sku === sku ? { ...r, cantidad: r.cantidad + delta } : r))
        .filter((r) => r.cantidad > 0),
    );
  }

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
      inputRef.current?.focus();
    } else {
      setEstado({ tipo: 'error', texto: datos.message ?? 'No se pudo registrar la venta' });
    }
    setCobrando(false);
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] flex flex-col">
      <header className="bg-black px-4 py-2.5 flex items-center justify-between">
        <span className="text-white tracking-widest font-medium text-sm">
          O.D.B <span className="tracking-normal font-normal text-[#F0EBE2]/70">· Caja</span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="rounded bg-white/10 text-[#F0EBE2] px-2 py-1 text-xs"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id} className="text-black">
                {s.nombre}
              </option>
            ))}
          </select>
          <Link href="/ventas" className="text-[#F0EBE2]/60 hover:text-white text-xs">
            Volver al panel
          </Link>
        </div>
      </header>

      <div className="flex-1 grid md:grid-cols-[1.5fr_1fr] gap-4 p-4 max-w-6xl w-full mx-auto">
        <section className="rounded-xl bg-white p-4 flex flex-col">
          <div className="relative">
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => onBuscar(e.target.value)}
              onKeyDown={onKeyBuscar}
              placeholder="Escanear código de barras o buscar producto…"
              autoFocus
              className="w-full rounded-full border-2 border-[#B82D25] px-5 py-3 text-base text-black outline-none"
            />
            {buscando && <span className="absolute right-5 top-1/2 -translate-y-1/2 text-xs text-black/40">buscando…</span>}
            {resultados.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-xl bg-white border border-black/10 overflow-hidden shadow-lg">
                {resultados.map((p) => (
                  <button
                    key={p.sku}
                    onClick={() => agregar(p)}
                    className="w-full px-4 py-2.5 text-left text-sm text-black hover:bg-[#F0EBE2] flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-3">
                      {p.imagenUrl && (
                        <img src={p.imagenUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                      )}
                      {p.nombre}
                      {p.esAlcohol && (
                        <span className="ml-2 rounded-full bg-black px-1.5 py-0.5 text-[10px] text-white">
                          +18
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{pesos(p.precio)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <table className="w-full text-sm text-black mt-4">
            <tbody>
              {carrito.map((r) => (
                <tr key={r.sku} className="border-b border-black/5 last:border-0">
                  <td className="py-2.5">
                    <p className="font-medium">{r.nombre}</p>
                    {r.descuento && <p className="text-xs text-[#B82D25]">{r.descuento}</p>}
                  </td>
                  <td className="py-2.5 w-28">
                    <div className="flex items-center gap-1.5 justify-center">
                      <button
                        onClick={() => cambiarCantidad(r.sku, -1)}
                        className="h-7 w-7 rounded-full bg-[#F0EBE2] text-black font-medium"
                        aria-label="Restar"
                      >
                        −
                      </button>
                      <span className="w-7 text-center font-medium">{r.cantidad}</span>
                      <button
                        onClick={() => cambiarCantidad(r.sku, 1)}
                        className="h-7 w-7 rounded-full bg-black text-white font-medium"
                        aria-label="Sumar"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 text-right w-28">
                    {r.precioLista != null && r.precio != null && r.precioLista > r.precio ? (
                      <>
                        <p className="text-xs text-black/40 line-through">
                          {pesos(r.precioLista * r.cantidad)}
                        </p>
                        <p className="font-medium text-[#B82D25]">{pesos(r.precio * r.cantidad)}</p>
                      </>
                    ) : (
                      <p className="font-medium">{pesos((r.precio ?? 0) * r.cantidad)}</p>
                    )}
                  </td>
                </tr>
              ))}
              {carrito.length === 0 && (
                <tr>
                  <td className="py-16 text-center text-black/40 text-sm">
                    Escaneá un producto para empezar la venta
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl bg-white p-4 flex flex-col gap-4 self-start sticky top-4">
          <div>
            <p className="text-xs text-black/50 mb-1.5">DNI del cliente (opcional)</p>
            <div className="flex gap-2">
              <input
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscarCliente()}
                placeholder="28456789"
                className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
              />
              <button
                onClick={buscarCliente}
                className="rounded-lg bg-black px-4 text-sm text-white"
              >
                Buscar
              </button>
            </div>
            {cliente && (
              <div className="mt-2">
                {cliente.existe ? (
                  <span className="rounded-full bg-black px-3 py-1 text-xs font-medium text-white">
                    {cliente.tipo} · {cliente.compras} compras · ticket {pesos(cliente.ticketPromedio)}
                  </span>
                ) : (
                  <span className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs text-black">
                    Cliente nuevo: se registra con esta venta
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-black/10 pt-3">
            {subtotalLista > total && (
              <div className="flex justify-between text-sm text-black/50">
                <span>Precio de lista</span>
                <span className="line-through">{pesos(subtotalLista)}</span>
              </div>
            )}
            {subtotalLista > total && (
              <div className="flex justify-between text-sm text-[#932A1F]">
                <span>Descuentos</span>
                <span>−{pesos(subtotalLista - total)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline mt-1">
              <span className="text-sm text-black/60">Total</span>
              <span className="text-3xl font-medium text-black">{pesos(total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {MEDIOS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMedio(m.id)}
                className={
                  'rounded-lg py-2.5 text-sm font-medium border ' +
                  (medio === m.id
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-black border-black/15 hover:border-black/40')
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {medio === 'efectivo' && total > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-black/60 whitespace-nowrap">Paga con</span>
              <input
                type="number"
                value={pagaCon}
                onChange={(e) => setPagaCon(e.target.value)}
                placeholder="$"
                className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-right text-black outline-none focus:border-[#B82D25]"
              />
              {vuelto != null && (
                <span className={`text-sm font-semibold whitespace-nowrap ${vuelto < 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                  {vuelto < 0 ? `Faltan ${pesos(-vuelto)}` : `Vuelto ${pesos(vuelto)}`}
                </span>
              )}
            </div>
          )}

          <button
            onClick={cobrar}
            disabled={carrito.length === 0 || cobrando}
            className="rounded-full bg-[#B82D25] py-3.5 text-base font-medium text-white hover:bg-[#932A1F] disabled:opacity-40"
          >
            {cobrando ? 'Cobrando…' : `Cobrar ${pesos(total)}`}
          </button>

          {estado && (
            <p
              className={
                'rounded-lg px-3 py-2.5 text-sm ' +
                (estado.tipo === 'ok'
                  ? 'bg-[#F0EBE2] text-black'
                  : 'bg-[#B82D25]/10 text-[#932A1F]')
              }
            >
              {estado.texto}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

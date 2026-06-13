'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TIPOS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'Nota de crédito A', NCB: 'Nota de crédito B', NCC: 'Nota de crédito C',
  NDA: 'Nota de débito A', NDB: 'Nota de débito B', NDC: 'Nota de débito C',
  REM: 'Remito', REC: 'Recibo de cobranza', ANT: 'Anticipo', SIN: 'Comprobante interno',
};

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

type Item = { sku?: string; descripcion: string; cantidad: number; precioUnitario: number; alicuota: number };
type Sucursal = { id: string; nombre: string };

const esNota = (t: string) => t.startsWith('NC') || t.startsWith('ND');
const llevaItems = (t: string) => ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'REM', 'SIN'].includes(t);
const importeLibre = (t: string) => ['REC', 'ANT', 'NDA', 'NDB', 'NDC', 'SIN'].includes(t);

export function EmitirComprobante({
  sucursales,
  ventaInicial,
}: {
  sucursales: Sucursal[];
  ventaInicial?: { id: string; total: number } | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(!!ventaInicial);
  const [tipo, setTipo] = useState(ventaInicial ? 'FB' : 'FB');
  const [cliente, setCliente] = useState<any>(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [sugClientes, setSugClientes] = useState<any[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [buscaProducto, setBuscaProducto] = useState('');
  const [sugProductos, setSugProductos] = useState<any[]>([]);
  const [importe, setImporte] = useState('');
  const [concepto, setConcepto] = useState('');
  const [condicionPago, setCondicionPago] = useState<'contado' | 'cta_cte'>('contado');
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [moverStock, setMoverStock] = useState(true);
  const [referencias, setReferencias] = useState<any[]>([]);
  const [referenciaId, setReferenciaId] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // sugerencias de clientes
  useEffect(() => {
    if (buscaCliente.trim().length < 2) return setSugClientes([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(buscaCliente)}`);
      if (res.ok) setSugClientes(((await res.json()).clientes ?? []).slice(0, 6));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaCliente]);

  // sugerencias de productos
  useEffect(() => {
    if (buscaProducto.trim().length < 2) return setSugProductos([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/buscar-producto?q=${encodeURIComponent(buscaProducto)}`);
      if (res.ok) setSugProductos((await res.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaProducto]);

  // facturas del cliente para referenciar notas
  useEffect(() => {
    if (!esNota(tipo) || !cliente) return setReferencias([]);
    (async () => {
      const res = await fetch(`/api/facturacion?clienteId=${cliente.id}&tipo=FA,FB,FC&limite=10`);
      if (res.ok) setReferencias(await res.json());
    })();
  }, [tipo, cliente]);

  const total = llevaItems(tipo) && items.length
    ? items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
    : Number(importe) || 0;

  const emitir = async () => {
    setCargando(true);
    setError('');
    try {
      const cuerpo: any = {
        accion: 'emitir',
        tipo,
        clienteId: cliente?.id,
        condicionPago,
        concepto: concepto || undefined,
        referenciaId: referenciaId || undefined,
      };
      if (ventaInicial && ['FA', 'FB', 'FC'].includes(tipo) && !items.length) {
        cuerpo.ventaId = ventaInicial.id;
      } else if (llevaItems(tipo) && items.length) {
        cuerpo.items = items;
      } else {
        cuerpo.importe = Number(importe) || 0;
      }
      if (tipo === 'REM') {
        cuerpo.sucursalId = sucursalId;
        cuerpo.moverStock = moverStock;
      }
      const res = await fetch('/api/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const datos = await res.json();
      if (!res.ok) {
        setError(datos.message ?? 'No se pudo emitir');
        return;
      }
      setAbierto(false);
      router.push(`/facturacion/${datos.id}`);
    } finally {
      setCargando(false);
    }
  };

  const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm whitespace-nowrap"
      >
        + Emitir comprobante
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-black text-lg">Emitir comprobante</h2>
                <p className="text-xs text-black/45 mt-0.5">
                  {ventaInicial ? `Facturando la venta de ${pesos(ventaInicial.total)}` : 'Numeración automática por tipo y punto de venta.'}
                </p>
              </div>
              <select value={tipo} onChange={(e) => { setTipo(e.target.value); setError(''); }} className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white font-medium">
                {Object.entries(TIPOS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* receptor */}
            <div className="rounded-xl bg-[#F0EBE2]/60 p-3 space-y-2">
              {cliente ? (
                <div className="flex items-center justify-between text-sm text-black">
                  <span>
                    <strong>{cliente.razon_social ?? cliente.nombre}</strong>
                    <span className="text-xs text-black/50 ml-2">
                      {cliente.cuit ?? cliente.dni} · {cliente.condicion_iva?.replaceAll('_', ' ') ?? 'consumidor final'}
                    </span>
                  </span>
                  <button onClick={() => setCliente(null)} className="text-black/40 hover:text-[#B82D25]">✕</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={buscaCliente}
                    onChange={(e) => setBuscaCliente(e.target.value)}
                    placeholder="Cliente (nombre o DNI) — vacío = Consumidor final"
                    className={input}
                  />
                  {sugClientes.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10">
                      {sugClientes.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setCliente(c); setBuscaCliente(''); setSugClientes([]); }}
                          className="w-full text-left px-3 py-2 text-sm text-black hover:bg-[#F0EBE2] border-b border-black/5 last:border-0"
                        >
                          {c.razon_social ?? c.nombre}
                          <span className="text-xs text-black/40 ml-2">{c.cuit ?? c.dni} · {(c.condicion_iva ?? '').replaceAll('_', ' ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'].includes(tipo) && cliente && (
                <label className="flex items-center gap-2 text-xs text-black">
                  <input type="checkbox" checked={condicionPago === 'cta_cte'} onChange={(e) => setCondicionPago(e.target.checked ? 'cta_cte' : 'contado')} className="accent-[#B82D25]" />
                  A cuenta corriente (queda como deuda del cliente)
                </label>
              )}
            </div>

            {/* referencia para notas */}
            {esNota(tipo) && (
              <select value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)} className={input + ' bg-white'}>
                <option value="">Sin comprobante de referencia</option>
                {referencias.map((r) => (
                  <option key={r.id} value={r.id}>
                    {TIPOS[r.tipo]} {String(r.punto_venta).padStart(4, '0')}-{String(r.numero).padStart(8, '0')} · {pesos(r.total)}
                  </option>
                ))}
              </select>
            )}

            {/* renglones */}
            {llevaItems(tipo) && !(ventaInicial && ['FA', 'FB', 'FC'].includes(tipo) && !items.length) && (
              <div className="space-y-2">
                <div className="relative">
                  <input
                    value={buscaProducto}
                    onChange={(e) => setBuscaProducto(e.target.value)}
                    placeholder="Agregar producto del catálogo (nombre o SKU)…"
                    className={input}
                  />
                  {sugProductos.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-48 overflow-y-auto">
                      {sugProductos.map((p) => (
                        <button
                          key={p.sku}
                          onClick={() => {
                            setItems((xs) => [...xs, { sku: p.sku, descripcion: p.nombre, cantidad: 1, precioUnitario: p.precio ?? 0, alicuota: p.alicuotaIva ?? 21 }]);
                            setBuscaProducto('');
                            setSugProductos([]);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-black hover:bg-[#F0EBE2] border-b border-black/5 last:border-0"
                        >
                          {p.nombre} <span className="text-xs text-black/40">{p.sku} · {p.precio ? pesos(p.precio) : 'sin precio'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setItems((xs) => [...xs, { descripcion: '', cantidad: 1, precioUnitario: 0, alicuota: 21 }])}
                  className="text-xs text-[#B82D25] hover:underline"
                >
                  + renglón libre (sin producto)
                </button>
                {items.map((i, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_64px_96px_72px_28px] gap-2 items-center">
                    <input
                      value={i.descripcion}
                      onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, descripcion: e.target.value } : x)))}
                      placeholder="Descripción"
                      className="rounded-lg border border-black/15 px-2 py-1.5 text-sm text-black"
                    />
                    <input
                      type="number"
                      value={i.cantidad}
                      onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, cantidad: Number(e.target.value) } : x)))}
                      className="rounded-lg border border-black/15 px-2 py-1.5 text-sm text-black text-right"
                    />
                    <input
                      type="number"
                      value={i.precioUnitario}
                      onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, precioUnitario: Number(e.target.value) } : x)))}
                      className="rounded-lg border border-black/15 px-2 py-1.5 text-sm text-black text-right"
                    />
                    <select
                      value={i.alicuota}
                      onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, alicuota: Number(e.target.value) } : x)))}
                      className="rounded-lg border border-black/15 px-1 py-1.5 text-xs text-black bg-white"
                    >
                      <option value={21}>21 %</option>
                      <option value={10.5}>10,5 %</option>
                      <option value={0}>Exento</option>
                    </select>
                    <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/40 hover:text-[#B82D25]">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* importe libre */}
            {(importeLibre(tipo) && !items.length) && (
              <div className="grid grid-cols-2 gap-3">
                <input value={importe} onChange={(e) => setImporte(e.target.value)} type="number" placeholder="Importe $" className={input} />
                <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto (interés, anticipo, seña…)" className={input} />
              </div>
            )}

            {/* remito */}
            {tipo === 'REM' && (
              <div className="grid grid-cols-2 gap-3 items-center">
                <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={input + ' bg-white'}>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>Sale de {s.nombre}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-black">
                  <input type="checkbox" checked={moverStock} onChange={(e) => setMoverStock(e.target.checked)} className="accent-[#B82D25]" />
                  Descontar stock al emitir
                </label>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-black/10 pt-3">
              <p className="text-sm text-black">
                Total: <strong className="text-lg">{pesos(total)}</strong>
                {tipo.endsWith('A') && total > 0 && <span className="text-xs text-black/40 ml-2">(IVA discriminado en el comprobante)</span>}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
                <button
                  onClick={emitir}
                  disabled={cargando || total <= 0 && tipo !== 'REM'}
                  className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
                >
                  {cargando ? 'Emitiendo…' : `Emitir ${TIPOS[tipo]}`}
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Sucursal = { id: string; nombre: string };
type Transferencia = {
  id: string;
  estado: string;
  creado_en: string;
  origen: { nombre: string } | null;
  destino: { nombre: string } | null;
  items: { cantidad: number; producto: { sku: string; nombre: string } | null }[];
};

type Modo = null | 'ajuste' | 'merma' | 'transferencia';

// buscador de producto con sugerencias (usa el catálogo público)
function BuscadorProducto({ onElegir }: { onElegir: (p: any) => void }) {
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState<any[]>([]);

  useEffect(() => {
    if (texto.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/buscar-producto?q=${encodeURIComponent(texto)}`);
      if (res.ok) setSugerencias((await res.json()).items ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [texto]);

  return (
    <div className="relative">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar producto por nombre o SKU…"
        className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
      />
      {sugerencias.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-56 overflow-y-auto">
          {sugerencias.map((p) => (
            <button
              key={p.sku}
              onClick={() => {
                onElegir(p);
                setTexto('');
                setSugerencias([]);
              }}
              className="w-full text-left px-3 py-2 text-sm text-black hover:bg-[#F0EBE2] border-b border-black/5 last:border-0"
            >
              <span className="font-medium">{p.nombre}</span>
              <span className="text-xs text-black/40 ml-2">{p.sku} · stock {Math.round(p.stockTotal)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccionesStock({
  sucursales,
  transferencias,
}: {
  sucursales: Sucursal[];
  transferencias: Transferencia[];
}) {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>(null);
  const [producto, setProducto] = useState<any>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [destinoId, setDestinoId] = useState(sucursales[1]?.id ?? '');
  const [items, setItems] = useState<{ sku: string; nombre: string; cantidad: number }[]>([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const abrir = (m: Modo) => {
    setModo(m);
    setProducto(null);
    setCantidad('');
    setMotivo('');
    setItems([]);
    setError('');
  };

  const ejecutar = async () => {
    setCargando(true);
    setError('');
    try {
      let cuerpo: any;
      if (modo === 'transferencia') {
        if (!items.length) {
          setError('Agregá al menos un producto');
          return;
        }
        cuerpo = { accion: 'transferencia', origenId: sucursalId, destinoId, items };
      } else {
        if (!producto || !Number(cantidad)) {
          setError('Elegí producto y cantidad');
          return;
        }
        cuerpo = {
          accion: modo,
          sku: producto.sku,
          sucursalId,
          cantidad: Number(cantidad),
          motivo: motivo || (modo === 'merma' ? 'Merma registrada desde el panel' : 'Ajuste manual desde el panel'),
        };
      }
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      if (!res.ok) {
        setError((await res.json()).message ?? 'No se pudo registrar');
        return;
      }
      setModo(null);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const recibir = async (id: string) => {
    await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'recibir', transferenciaId: id }),
    });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* acciones principales */}
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          onClick={() => abrir('ajuste')}
          className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm"
        >
          + Ajustar stock
        </button>
        <button
          onClick={() => abrir('merma')}
          className="rounded-full bg-black text-white text-sm font-medium px-5 py-2.5 hover:bg-black/80 shadow-sm"
        >
          Registrar merma
        </button>
        <button
          onClick={() => abrir('transferencia')}
          className="rounded-full bg-white text-black border border-black/15 text-sm font-medium px-5 py-2.5 hover:border-black/40 shadow-sm"
        >
          Transferir entre sucursales
        </button>
      </div>

      {/* transferencias en curso */}
      {transferencias.length > 0 && (
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
            Transferencias en curso
          </h2>
          {transferencias.map((t) => (
            <div key={t.id} className="px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between gap-3">
              <div className="text-sm text-black">
                <p className="font-medium">
                  {t.origen?.nombre} → {t.destino?.nombre}
                  <span className="ml-2 text-[11px] rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">
                    {t.estado === 'pendiente' ? 'En camino' : t.estado}
                  </span>
                </p>
                <p className="text-xs text-black/50 mt-0.5">
                  {t.items.map((i) => `${i.producto?.nombre} × ${Math.round(i.cantidad)}`).join(' · ')}
                </p>
              </div>
              <button
                onClick={() => recibir(t.id)}
                className="rounded-full bg-emerald-600 text-white text-xs font-medium px-4 py-2 hover:bg-emerald-700 whitespace-nowrap"
              >
                Recibir ✓
              </button>
            </div>
          ))}
        </section>
      )}

      {/* modal */}
      {modo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl">
            <div>
              <h2 className="font-semibold text-black text-lg">
                {modo === 'ajuste' ? 'Ajustar stock' : modo === 'merma' ? 'Registrar merma' : 'Transferencia entre sucursales'}
              </h2>
              <p className="text-xs text-black/45 mt-0.5">
                {modo === 'ajuste'
                  ? 'Corrige el stock con un movimiento auditado (positivo suma, negativo resta).'
                  : modo === 'merma'
                    ? 'Rotura, vencimiento o pérdida: descuenta stock y queda en el historial.'
                    : 'La mercadería sale de origen ya; el stock entra a destino cuando la reciben.'}
              </p>
            </div>

            {modo === 'transferencia' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-black/50">Origen</label>
                    <select
                      value={sucursalId}
                      onChange={(e) => setSucursalId(e.target.value)}
                      className="w-full mt-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
                    >
                      {sucursales.map((s) => (
                        <option key={s.id} value={s.id}>{s.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-black/50">Destino</label>
                    <select
                      value={destinoId}
                      onChange={(e) => setDestinoId(e.target.value)}
                      className="w-full mt-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
                    >
                      {sucursales.filter((s) => s.id !== sucursalId).map((s) => (
                        <option key={s.id} value={s.id}>{s.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <BuscadorProducto
                  onElegir={(p) => setItems((xs) => [...xs.filter((x) => x.sku !== p.sku), { sku: p.sku, nombre: p.nombre, cantidad: 1 }])}
                />
                {items.map((i, idx) => (
                  <div key={i.sku} className="flex items-center gap-2 text-sm text-black">
                    <span className="flex-1 truncate">{i.nombre}</span>
                    <input
                      type="number"
                      value={i.cantidad}
                      onChange={(e) =>
                        setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, cantidad: Number(e.target.value) } : x)))
                      }
                      className="w-20 rounded-lg border border-black/15 px-2 py-1.5 text-sm text-right"
                    />
                    <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/40 hover:text-[#B82D25]">✕</button>
                  </div>
                ))}
              </>
            ) : (
              <>
                {producto ? (
                  <div className="flex items-center justify-between rounded-lg bg-[#F0EBE2]/70 px-3 py-2.5 text-sm text-black">
                    <span className="truncate">{producto.nombre} <span className="text-black/40 text-xs">({producto.sku})</span></span>
                    <button onClick={() => setProducto(null)} className="text-black/40 hover:text-[#B82D25] ml-2">✕</button>
                  </div>
                ) : (
                  <BuscadorProducto onElegir={setProducto} />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-black/50">Sucursal</label>
                    <select
                      value={sucursalId}
                      onChange={(e) => setSucursalId(e.target.value)}
                      className="w-full mt-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
                    >
                      {sucursales.map((s) => (
                        <option key={s.id} value={s.id}>{s.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-black/50">
                      {modo === 'merma' ? 'Cantidad perdida' : 'Cantidad (+ suma / − resta)'}
                    </label>
                    <input
                      value={cantidad}
                      onChange={(e) => setCantidad(e.target.value)}
                      type="number"
                      className="w-full mt-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                    />
                  </div>
                </div>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={modo === 'merma' ? 'Motivo (rotura, vencido…)' : 'Motivo del ajuste (conteo, corrección…)'}
                  className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                />
              </>
            )}

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setModo(null)} className="text-sm text-black/60 px-4 py-2 hover:text-black">
                Cancelar
              </button>
              <button
                onClick={ejecutar}
                disabled={cargando}
                className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
              >
                {cargando ? 'Registrando…' : modo === 'transferencia' ? 'Enviar transferencia' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

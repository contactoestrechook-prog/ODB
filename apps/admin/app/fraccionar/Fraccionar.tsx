'use client';

import { useEffect, useMemo, useState } from 'react';

// Fraccionamiento (caso huevos). Tres instancias: la mercadería ENTRA al pozo
// madre en unidades (por la factura del proveedor); acá las chicas ARMAN las
// presentaciones (docena, media docena, maple) y el sistema mueve el stock del
// pozo al fraccionado; la caja después VENDE lo armado como cualquier producto.
type Fraccion = { id: string; sku: string; nombre: string; unidades: number; stock: Record<string, number> };
type Grupo = { madre: { id: string; sku: string; nombre: string; stock: Record<string, number> }; fracciones: Fraccion[] };

export function Fraccionar() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [sucursal, setSucursal] = useState<string>('');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    const res = await fetch('/api/fraccionar');
    const d = await res.json();
    if (res.ok) {
      setGrupos(d.grupos ?? []);
      setSucursales(d.sucursales ?? []);
      setSucursal((s) => s || d.sucursales?.[0]?.id || '');
    } else setError(d.message ?? 'No se pudo cargar');
  };
  useEffect(() => { cargar(); }, []);

  const mover = async (destinoId: string, signo: 1 | -1) => {
    const cantidad = Math.abs(parseInt(cantidades[destinoId] ?? '', 10));
    if (!cantidad) { setError('Poné cuántas unidades armaste'); return; }
    setOcupado(destinoId); setError(null); setAviso(null);
    const res = await fetch('/api/fraccionar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinoId, cantidad: cantidad * signo, sucursalId: sucursal }),
    });
    const d = await res.json();
    setOcupado(null);
    if (!res.ok) { setError(d.message ?? 'No se pudo fraccionar'); return; }
    setAviso(signo > 0
      ? `Listo: ${cantidad} × ${d.fraccion} armadas (quedan ${Number(d.stock_madre).toLocaleString('es-AR')} unidades en el pozo).`
      : `Listo: ${cantidad} × ${d.fraccion} vuelven al pozo (ahora tiene ${Number(d.stock_madre).toLocaleString('es-AR')} unidades).`);
    setCantidades((c) => ({ ...c, [destinoId]: '' }));
    cargar();
  };

  const stockEn = (stock: Record<string, number>) => Number(stock?.[sucursal] ?? 0);
  const haySucursales = useMemo(() => sucursales.length > 0, [sucursales]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#141414]">Fraccionar</h1>
          <p className="text-sm text-neutral-600">
            La mercadería entra al pozo por la factura; acá se anota lo que se arma (docenas, maples) y la caja vende lo armado.
          </p>
        </div>
        {haySucursales && (
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white text-sm">
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
      </div>

      {aviso && <div className="bg-green-50 border border-green-200 text-green-900 rounded-lg px-4 py-3 text-sm">{aviso}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-900 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {grupos.length === 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-600">
          No hay productos fraccionables configurados. Se configuran en la ficha del producto (fracción de + unidades).
        </div>
      )}

      {grupos.map((g) => (
        <div key={g.madre.id} className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <div className="bg-[#141414] text-[#F0EBE2] px-5 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">{g.madre.nombre}</div>
              <div className="text-xs opacity-70">{g.madre.sku} · el pozo se carga con la factura del proveedor</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[#C9A96E]">{stockEn(g.madre.stock).toLocaleString('es-AR')}</div>
              <div className="text-xs opacity-70">unidades en el pozo</div>
            </div>
          </div>
          <div className="divide-y divide-neutral-100">
            {g.fracciones.map((f) => (
              <div key={f.id} className="px-5 py-4 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-[#141414]">{f.nombre}</div>
                  <div className="text-xs text-neutral-500">{f.sku} · lleva {f.unidades} unidades c/u</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{stockEn(f.stock).toLocaleString('es-AR')}</div>
                  <div className="text-xs text-neutral-500">armadas</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} inputMode="numeric" placeholder="Cant."
                    value={cantidades[f.id] ?? ''}
                    onChange={(e) => setCantidades((c) => ({ ...c, [f.id]: e.target.value }))}
                    className="w-20 border border-neutral-300 rounded-lg px-2 py-2 text-sm text-center"
                  />
                  <button
                    onClick={() => mover(f.id, 1)}
                    disabled={ocupado === f.id || !sucursal}
                    className="bg-[#141414] text-[#F0EBE2] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40">
                    {ocupado === f.id ? '…' : 'Armar'}
                  </button>
                  <button
                    onClick={() => mover(f.id, -1)}
                    disabled={ocupado === f.id || !sucursal}
                    title="Volver fracciones al pozo (se rompió el envase, se armó de más)"
                    className="border border-neutral-300 text-neutral-700 rounded-lg px-3 py-2 text-sm disabled:opacity-40">
                    Deshacer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

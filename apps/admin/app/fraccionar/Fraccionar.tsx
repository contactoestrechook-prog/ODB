'use client';

import { useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, Entrada, Selector, Tarjeta, Vacio } from '../ui/kit';

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
    <div className="space-y-4 sm:space-y-6">
      {/* el título "Fraccionar" ya lo pone la cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-tinta/70">
          La mercadería entra al pozo por la factura; acá se anota lo que se arma (docenas, maples) y la caja vende lo armado.
        </p>
        {haySucursales && (
          <Selector
            value={sucursal}
            onChange={(e) => setSucursal(e.target.value)}
            aria-label="Sucursal"
            className="shrink-0 sm:w-56"
            opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
          />
        )}
      </div>

      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {grupos.length === 0 && (
        <Vacio
          titulo="No hay productos fraccionables configurados."
          texto="Se configuran en la ficha del producto (fracción de + unidades)."
        />
      )}

      {grupos.map((g) => (
        <Tarjeta key={g.madre.id} relleno={false} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-tinta px-4 py-3 text-crema sm:px-5">
            <div className="min-w-0">
              <div className="break-words font-semibold">{g.madre.nombre}</div>
              <div className="text-xs text-white/70">{g.madre.sku} · el pozo se carga con la factura del proveedor</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="importe text-2xl font-bold text-dorado">{stockEn(g.madre.stock).toLocaleString('es-AR')}</div>
              <div className="text-xs text-white/70">unidades en el pozo</div>
            </div>
          </div>
          <div className="divide-y divide-black/[0.06]">
            {g.fracciones.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1 basis-40">
                  <div className="break-words font-semibold text-tinta">{f.nombre}</div>
                  <div className="text-xs text-tinta/60">{f.sku} · lleva {f.unidades} unidades c/u</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="importe font-semibold text-tinta">{stockEn(f.stock).toLocaleString('es-AR')}</div>
                  <div className="text-xs text-tinta/60">armadas</div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <div className="w-24 shrink-0">
                    <Entrada
                      type="number" min={1} inputMode="numeric" placeholder="Cant."
                      aria-label={`Cantidad de ${f.nombre}`}
                      value={cantidades[f.id] ?? ''}
                      onChange={(e) => setCantidades((c) => ({ ...c, [f.id]: e.target.value }))}
                      className="text-center"
                    />
                  </div>
                  <Boton
                    onClick={() => mover(f.id, 1)}
                    disabled={ocupado === f.id || !sucursal}
                    className="flex-1 sm:flex-none"
                  >
                    {ocupado === f.id ? '…' : 'Armar'}
                  </Boton>
                  <Boton
                    variante="secundario"
                    onClick={() => mover(f.id, -1)}
                    disabled={ocupado === f.id || !sucursal}
                    title="Volver fracciones al pozo (se rompió el envase, se armó de más)"
                  >
                    Deshacer
                  </Boton>
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}

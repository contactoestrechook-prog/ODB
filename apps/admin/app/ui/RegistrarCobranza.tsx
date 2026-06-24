'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

type Factura = { id: string; etiqueta: string; emitidoEn: string; total: number; saldo: number };
type Medio = {
  medio: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'deposito' | 'retencion' | 'nota_credito';
  importe: string;
  referencia?: string;
  cheque?: { numero?: string; banco?: string; titular?: string; fechaCobro?: string; diferido?: boolean };
};

const MEDIOS: [Medio['medio'], string][] = [
  ['efectivo', 'Efectivo'],
  ['transferencia', 'Transferencia'],
  ['cheque', 'Cheque'],
  ['tarjeta', 'Tarjeta'],
  ['deposito', 'Depósito'],
  ['retencion', 'Retención'],
];

export function RegistrarCobranza({ clienteId, nombre, saldo }: { clienteId: string; nombre: string; saldo: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [imput, setImput] = useState<Record<string, string>>({}); // facturaId → importe
  const [medios, setMedios] = useState<Medio[]>([{ medio: 'efectivo', importe: '' }]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [obs, setObs] = useState('');

  useEffect(() => {
    if (!abierto) return;
    setCargando(true);
    setError('');
    fetch(`/api/recibos?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((d) => setFacturas(Array.isArray(d) ? d : []))
      .catch(() => setError('No se pudieron cargar las facturas'))
      .finally(() => setCargando(false));
  }, [abierto, clienteId]);

  const totalImput = useMemo(
    () => r2(Object.values(imput).reduce((s, v) => s + (Number(v) || 0), 0)),
    [imput],
  );
  const totalMedios = useMemo(
    () => r2(medios.reduce((s, m) => s + (Number(m.importe) || 0), 0)),
    [medios],
  );
  const balanceado = Math.abs(totalImput - totalMedios) < 0.01;

  const toggleFactura = (f: Factura) => {
    setImput((prev) => {
      const next = { ...prev };
      if (next[f.id] != null) delete next[f.id];
      else next[f.id] = String(f.saldo);
      return next;
    });
  };
  const saldarTodo = () => {
    const next: Record<string, string> = {};
    facturas.forEach((f) => (next[f.id] = String(f.saldo)));
    setImput(next);
  };
  const igualarMedio = () => {
    // pone el primer medio en el total imputado (atajo para el caso 1 medio)
    setMedios((m) => m.map((x, i) => (i === 0 ? { ...x, importe: String(totalImput) } : x)));
  };

  const setMedio = (i: number, patch: Partial<Medio>) =>
    setMedios((m) => m.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const setCheque = (i: number, patch: Partial<NonNullable<Medio['cheque']>>) =>
    setMedios((m) => m.map((x, idx) => (idx === i ? { ...x, cheque: { ...x.cheque, ...patch } } : x)));

  const emitir = async () => {
    setError('');
    const imputaciones = Object.entries(imput)
      .map(([facturaId, v]) => ({ facturaId, importe: Number(v) || 0 }))
      .filter((x) => x.importe > 0);
    if (!imputaciones.length) return setError('Imputá el cobro a al menos una factura');
    if (!balanceado) return setError(`Los medios (${pesos(totalMedios)}) no coinciden con lo imputado (${pesos(totalImput)})`);
    const mediosDto = medios
      .filter((m) => Number(m.importe) > 0)
      .map((m) => ({
        medio: m.medio,
        importe: Number(m.importe),
        referencia: m.referencia || undefined,
        cheque: m.medio === 'cheque' ? m.cheque : undefined,
      }));
    if (mediosDto.some((m) => m.medio === 'cheque' && !m.cheque?.numero))
      return setError('Cada cheque necesita número');

    setGuardando(true);
    try {
      const res = await fetch('/api/recibos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, imputaciones, medios: mediosDto, observaciones: obs || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'No se pudo emitir el recibo');
      setAbierto(false);
      setImput({});
      setMedios([{ medio: 'efectivo', importe: '' }]);
      setObs('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#9e251e]"
      >
        Registrar cobranza
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-[#F7F4EE] rounded-2xl w-full max-w-2xl my-8 shadow-xl">
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between sticky top-0 bg-[#F7F4EE] rounded-t-2xl">
              <div>
                <h2 className="font-semibold text-black">Cobranza · {nombre}</h2>
                <p className="text-xs text-black/45">saldo deudor {pesos(saldo)}</p>
              </div>
              <button onClick={() => setAbierto(false)} className="text-black/40 hover:text-black text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-5">
              {/* FACTURAS ABIERTAS */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-black">Facturas a cancelar</h3>
                  {facturas.length > 0 && (
                    <button onClick={saldarTodo} className="text-xs text-[#B82D25] hover:underline">Saldar todo</button>
                  )}
                </div>
                {cargando && <p className="text-sm text-black/40 py-3">Cargando facturas…</p>}
                {!cargando && facturas.length === 0 && (
                  <p className="text-sm text-black/40 py-3">Este cliente no tiene facturas abiertas en cuenta corriente.</p>
                )}
                <div className="space-y-1.5">
                  {facturas.map((f) => {
                    const sel = imput[f.id] != null;
                    return (
                      <div key={f.id} className={`rounded-lg border px-3 py-2 flex items-center gap-3 ${sel ? 'border-[#B82D25] bg-white' : 'border-black/10 bg-white/60'}`}>
                        <input type="checkbox" checked={sel} onChange={() => toggleFactura(f)} className="accent-[#B82D25]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black truncate">{f.etiqueta}</p>
                          <p className="text-[11px] text-black/45">
                            {new Date(f.emitidoEn).toLocaleDateString('es-AR')} · saldo {pesos(f.saldo)}
                          </p>
                        </div>
                        {sel && (
                          <div className="flex items-center gap-1">
                            <span className="text-black/40 text-sm">$</span>
                            <input
                              type="number" inputMode="decimal" value={imput[f.id]}
                              onChange={(e) => setImput((p) => ({ ...p, [f.id]: e.target.value }))}
                              max={f.saldo}
                              className="w-28 rounded-md border border-black/15 px-2 py-1 text-sm text-right"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* MEDIOS DE PAGO */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-black">Medios de pago</h3>
                  <div className="flex gap-3">
                    {totalImput > 0 && <button onClick={igualarMedio} className="text-xs text-black/50 hover:underline">Igualar 1º medio</button>}
                    <button onClick={() => setMedios((m) => [...m, { medio: 'efectivo', importe: '' }])} className="text-xs text-[#B82D25] hover:underline">+ Agregar</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {medios.map((m, i) => (
                    <div key={i} className="rounded-lg bg-white border border-black/10 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={m.medio}
                          onChange={(e) => setMedio(i, { medio: e.target.value as Medio['medio'] })}
                          className="rounded-md border border-black/15 px-2 py-1.5 text-sm bg-white"
                        >
                          {MEDIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-black/40 text-sm">$</span>
                          <input
                            type="number" inputMode="decimal" placeholder="importe" value={m.importe}
                            onChange={(e) => setMedio(i, { importe: e.target.value })}
                            className="w-full rounded-md border border-black/15 px-2 py-1.5 text-sm text-right"
                          />
                        </div>
                        {m.medio !== 'cheque' && (
                          <input
                            placeholder="ref. (opcional)" value={m.referencia ?? ''}
                            onChange={(e) => setMedio(i, { referencia: e.target.value })}
                            className="w-32 rounded-md border border-black/15 px-2 py-1.5 text-sm"
                          />
                        )}
                        {medios.length > 1 && (
                          <button onClick={() => setMedios((arr) => arr.filter((_, idx) => idx !== i))} className="text-black/30 hover:text-[#B82D25] text-lg leading-none px-1">×</button>
                        )}
                      </div>
                      {m.medio === 'cheque' && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input placeholder="N° cheque" value={m.cheque?.numero ?? ''} onChange={(e) => setCheque(i, { numero: e.target.value })} className="rounded-md border border-black/15 px-2 py-1.5 text-sm" />
                          <input placeholder="Banco" value={m.cheque?.banco ?? ''} onChange={(e) => setCheque(i, { banco: e.target.value })} className="rounded-md border border-black/15 px-2 py-1.5 text-sm" />
                          <input placeholder="Librador" value={m.cheque?.titular ?? ''} onChange={(e) => setCheque(i, { titular: e.target.value })} className="rounded-md border border-black/15 px-2 py-1.5 text-sm" />
                          <label className="flex items-center gap-1.5 text-xs text-black/60">
                            <input type="date" value={m.cheque?.fechaCobro ?? ''} onChange={(e) => setCheque(i, { fechaCobro: e.target.value, diferido: !!e.target.value })} className="rounded-md border border-black/15 px-2 py-1.5 text-sm w-full" />
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <input
                placeholder="Observaciones (opcional)" value={obs} onChange={(e) => setObs(e.target.value)}
                className="w-full rounded-md border border-black/15 px-3 py-2 text-sm bg-white"
              />

              {error && <p className="text-sm text-[#B82D25] bg-[#B82D25]/5 rounded-lg px-3 py-2">{error}</p>}
            </div>

            {/* FOOTER */}
            <div className="px-5 py-4 border-t border-black/10 flex items-center justify-between gap-4 sticky bottom-0 bg-[#F7F4EE] rounded-b-2xl">
              <div className="text-sm">
                <span className="text-black/50">Imputado </span><span className="font-semibold text-black">{pesos(totalImput)}</span>
                <span className="text-black/30 mx-2">·</span>
                <span className="text-black/50">Medios </span>
                <span className={`font-semibold ${balanceado ? 'text-emerald-700' : 'text-[#B82D25]'}`}>{pesos(totalMedios)}</span>
                {!balanceado && totalImput > 0 && (
                  <span className="text-[11px] text-[#B82D25] ml-2">faltan {pesos(totalImput - totalMedios)}</span>
                )}
              </div>
              <button
                onClick={emitir}
                disabled={guardando || totalImput <= 0 || !balanceado}
                className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-5 py-2 disabled:opacity-40 hover:bg-[#9e251e]"
              >
                {guardando ? 'Emitiendo…' : 'Emitir recibo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

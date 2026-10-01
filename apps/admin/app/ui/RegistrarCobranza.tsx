'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Cargando, Entrada, FOCO, IconoCerrar, Modal, Selector, unir } from './kit';
import { fecha, pesos } from '../lib/formato';

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
    if (!balanceado) return setError(`Los medios (${pesos(totalMedios || 0)}) no coinciden con lo imputado (${pesos(totalImput || 0)})`);
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
      <Boton onClick={() => setAbierto(true)}>
        Registrar cobranza
      </Boton>

      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={`Cobranza · ${nombre}`}
        descripcion={`saldo deudor ${pesos(saldo || 0)}`}
        ancho="ancho"
        bloquearCierre={guardando}
        cerrarAlTocarAfuera={false}
        pie={
          <>
            {error && <Aviso tono="error" className="min-w-full">{error}</Aviso>}
            <div className="min-w-full text-sm sm:mr-auto sm:min-w-0">
              <span className="text-tinta/60">Imputado </span><span className="importe font-semibold text-tinta">{pesos(totalImput || 0)}</span>
              <span className="mx-2 text-tinta/40">·</span>
              <span className="text-tinta/60">Medios </span>
              <span className={unir('importe font-semibold', balanceado ? 'text-ok' : 'text-marca-hondo')}>{pesos(totalMedios || 0)}</span>
              {!balanceado && totalImput > 0 && (
                <span className="importe ml-2 text-xs text-marca-hondo">faltan {pesos(totalImput - totalMedios || 0)}</span>
              )}
            </div>
            <Boton onClick={emitir} cargando={guardando} disabled={guardando || totalImput <= 0 || !balanceado}>
              {guardando ? 'Emitiendo…' : 'Emitir recibo'}
            </Boton>
          </>
        }
      >
        <div className="space-y-5">
          {/* FACTURAS ABIERTAS */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-tinta">Facturas a cancelar</h3>
              {facturas.length > 0 && (
                <Boton variante="fantasma" tamano="chico" onClick={saldarTodo}>Saldar todo</Boton>
              )}
            </div>
            {cargando && <Cargando texto="Cargando facturas…" className="py-3" />}
            {!cargando && facturas.length === 0 && (
              <p className="py-3 text-sm text-tinta/60">Este cliente no tiene facturas abiertas en cuenta corriente.</p>
            )}
            <div className="space-y-1.5">
              {facturas.map((f) => {
                const sel = imput[f.id] != null;
                return (
                  <div
                    key={f.id}
                    className={unir(
                      'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2',
                      sel ? 'border-marca bg-white' : 'border-black/[0.06] bg-crema-claro',
                    )}
                  >
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                      <input type="checkbox" checked={sel} onChange={() => toggleFactura(f)} className="size-5 shrink-0 accent-marca" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm text-tinta">{f.etiqueta}</span>
                        <span className="block text-xs text-tinta/60">
                          {fecha(f.emitidoEn, 'completa')} · saldo {pesos(f.saldo || 0)}
                        </span>
                      </span>
                    </label>
                    {sel && (
                      <Entrada
                        type="number" inputMode="decimal" value={imput[f.id]}
                        onChange={(e) => setImput((p) => ({ ...p, [f.id]: e.target.value }))}
                        max={f.saldo}
                        prefijo="$"
                        aria-label={`Importe a imputar a ${f.etiqueta}`}
                        className="w-full text-right sm:w-36"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* MEDIOS DE PAGO */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-tinta">Medios de pago</h3>
              <div className="flex flex-wrap gap-2">
                {totalImput > 0 && <Boton variante="fantasma" tamano="chico" onClick={igualarMedio}>Igualar 1º medio</Boton>}
                <Boton variante="fantasma" tamano="chico" onClick={() => setMedios((m) => [...m, { medio: 'efectivo', importe: '' }])}>+ Agregar</Boton>
              </div>
            </div>
            <div className="space-y-2">
              {medios.map((m, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-black/[0.06] bg-crema-claro p-2.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,10rem)_auto]">
                    <Selector
                      value={m.medio}
                      onChange={(e) => setMedio(i, { medio: e.target.value as Medio['medio'] })}
                      aria-label="Medio de pago"
                      className="col-span-2 sm:col-span-1"
                    >
                      {MEDIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                    <Entrada
                      type="number" inputMode="decimal" placeholder="importe" value={m.importe}
                      onChange={(e) => setMedio(i, { importe: e.target.value })}
                      prefijo="$"
                      aria-label="Importe"
                      className="text-right"
                    />
                    {/* la ✕ va al lado del importe en el celular y al final en escritorio */}
                    {medios.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setMedios((arr) => arr.filter((_, idx) => idx !== i))}
                        aria-label="Quitar el medio de pago"
                        className={unir('grid size-11 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo sm:order-last', FOCO)}
                      >
                        <IconoCerrar className="size-5" />
                      </button>
                    )}
                    {m.medio !== 'cheque' && (
                      <Entrada
                        placeholder="ref. (opcional)" value={m.referencia ?? ''}
                        onChange={(e) => setMedio(i, { referencia: e.target.value })}
                        aria-label="Referencia"
                        className="col-span-2 sm:col-span-1"
                      />
                    )}
                  </div>
                  {m.medio === 'cheque' && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Entrada placeholder="N° cheque" value={m.cheque?.numero ?? ''} onChange={(e) => setCheque(i, { numero: e.target.value })} aria-label="Número de cheque" />
                      <Entrada placeholder="Banco" value={m.cheque?.banco ?? ''} onChange={(e) => setCheque(i, { banco: e.target.value })} aria-label="Banco" />
                      <Entrada placeholder="Librador" value={m.cheque?.titular ?? ''} onChange={(e) => setCheque(i, { titular: e.target.value })} aria-label="Librador" />
                      <Entrada type="date" value={m.cheque?.fechaCobro ?? ''} onChange={(e) => setCheque(i, { fechaCobro: e.target.value, diferido: !!e.target.value })} aria-label="Fecha de cobro" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <Entrada
            placeholder="Observaciones (opcional)" value={obs} onChange={(e) => setObs(e.target.value)}
            aria-label="Observaciones"
          />
        </div>
      </Modal>
    </>
  );
}

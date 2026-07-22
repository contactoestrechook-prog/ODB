'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const TIPO_LABEL: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', NCA: 'Nota crédito A', NCB: 'Nota crédito B', NDA: 'Nota débito A', NDB: 'Nota débito B',
};

export function ArcaWorkspace({ estado, contador, pendientes }: { estado: any; contador: any; pendientes: any }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [mes, setMes] = useState<string>(contador?.mes ?? new Date().toISOString().slice(0, 7));
  const [datos, setDatos] = useState<any>(contador);

  const cambiarMes = async (nuevo: string) => {
    setMes(nuevo);
    setCargando(true);
    try {
      const res = await fetch(`/api/arca?recurso=contador&mes=${encodeURIComponent(nuevo)}`);
      if (res.ok) setDatos(await res.json());
    } finally {
      setCargando(false);
    }
  };

  const emitir = async () => {
    setCargando(true);
    setAviso('');
    try {
      const res = await fetch('/api/arca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'emitir' }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      setAviso(`Emitidos ${d.emitidos} comprobante(s) con CAE${d.errores ? ` · ${d.errores} con error (mirá el detalle abajo)` : ''}.`);
      router.refresh();
      await cambiarMes(mes);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo emitir');
    } finally {
      setCargando(false);
    }
  };

  const descargarCsv = () => {
    const filas = datos?.comprobantes ?? [];
    const enc = ['Fecha', 'Tipo', 'Comprobante', 'Doc', 'Nro Doc', 'Receptor', 'Sucursal', 'Neto Gravado', 'IVA', 'Total', 'CAE', 'Vto CAE'];
    const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const cuerpo = filas.map((c: any) =>
      [c.fecha, TIPO_LABEL[c.tipo] ?? c.tipo, c.numero, c.docTipo, c.docNro, c.receptor, c.sucursal,
        c.neto.toFixed(2).replace('.', ','), c.iva.toFixed(2).replace('.', ','), c.total.toFixed(2).replace('.', ','), c.cae, c.caeVencimiento ?? '']
        .map(esc).join(';'),
    );
    const r = datos?.resumen ?? {};
    const csv = [
      `Comprobantes electrónicos ${datos?.emisor?.razonSocial ?? ''} - CUIT ${datos?.emisor?.cuit ?? ''} - Punto de venta ${String(datos?.emisor?.puntoVenta ?? '').padStart(4, '0')} - Período ${mes}`,
      '',
      enc.map(esc).join(';'),
      ...cuerpo,
      '',
      `TOTALES;;;;;;;${(r.neto ?? 0).toFixed(2).replace('.', ',')};${(r.ivaDebito ?? 0).toFixed(2).replace('.', ',')};${(r.total ?? 0).toFixed(2).replace('.', ',')};;`,
    ].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `comprobantes-arca-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const r = datos?.resumen ?? {};
  const cola = pendientes?.comprobantes ?? [];

  return (
    <div className="space-y-5">
      {/* estado de la conexión */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/60">
          {estado?.configurado ? (
            <>
              Facturación electrónica <span className="font-medium text-black">{datos?.emisor?.razonSocial}</span> · CUIT {datos?.emisor?.cuit} · Punto de venta {String(datos?.emisor?.puntoVenta ?? '').padStart(4, '0')}
              <span className="ml-2 rounded-full bg-emerald-100 text-emerald-800 text-[11px] px-2 py-0.5 align-middle">
                conectado a ARCA
              </span>
            </>
          ) : (
            <span className="text-[#B82D25]">ARCA sin configurar (falta el certificado en el servidor)</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => cambiarMes(e.target.value)} className="rounded-lg border border-black/15 px-3 py-2 text-sm bg-white" />
          <button onClick={descargarCsv} disabled={!datos?.comprobantes?.length} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 hover:border-[#B82D25] disabled:opacity-40">
            Descargar CSV para el contador
          </button>
        </div>
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-black/70">{aviso}</p>}

      {/* resumen del mes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Comprobantes', r.comprobantes ?? 0],
          ['Neto gravado', pesos(r.neto)],
          ['IVA débito fiscal', pesos(r.ivaDebito), 'text-[#932A1F]'],
          ['Total facturado', pesos(r.total)],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}</p>
          </div>
        ))}
      </div>

      {(r.porTipo ?? []).length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {r.porTipo.map((t: any) => (
            <div key={t.tipo} className="rounded-xl bg-white p-4 border border-black/[0.04] flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">{TIPO_LABEL[t.tipo] ?? t.tipo}</p>
                <p className="text-xs text-black/45">{t.cantidad} · IVA {pesos(t.iva)}</p>
              </div>
              <p className="font-semibold text-black">{pesos(t.total)}</p>
            </div>
          ))}
        </div>
      )}

      {/* cola pendiente */}
      <section className="rounded-xl bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <h2 className="font-medium text-black text-sm">Pendientes de CAE ({cola.length})</h2>
          {cola.length > 0 && (
            <button onClick={emitir} disabled={cargando || !estado?.configurado} className="rounded-full bg-black text-white text-xs font-medium px-4 py-1.5 hover:bg-black/80 disabled:opacity-50">
              {cargando ? 'Emitiendo…' : 'Emitir todos'}
            </button>
          )}
        </div>
        {cola.length === 0 ? (
          <p className="px-4 py-6 text-center text-emerald-700 text-sm">✓ Todo facturado. No hay comprobantes pendientes.</p>
        ) : (
          <table className="w-full text-sm text-black">
            <tbody>
              {cola.map((c: any) => (
                <tr key={c.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-2.5 text-xs">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
                  <td className="px-4 py-2.5 text-xs text-black/55">{new Date(c.creado_en).toLocaleDateString('es-AR')}</td>
                  <td className="px-4 py-2.5 text-right">{pesos(c.venta?.total)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {c.estado === 'error'
                      ? <span className="text-[#B82D25]" title={c.error_detalle}>⚠ {String(c.error_detalle ?? 'error').slice(0, 60)}</span>
                      : <span className="text-black/45">pendiente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* comprobantes emitidos del mes */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
          Comprobantes con CAE — {mes} ({(datos?.comprobantes ?? []).length})
        </h2>
        {(datos?.comprobantes ?? []).length === 0 ? (
          <p className="px-4 py-10 text-center text-black/40 text-sm">
            Sin comprobantes electrónicos este mes todavía. Cuando la caja facture, aparecen acá y en el CSV.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-black min-w-[46rem]">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Comprobante</th>
                <th className="px-4 py-2 font-medium">Receptor</th>
                <th className="px-4 py-2 font-medium text-right">Neto</th>
                <th className="px-4 py-2 font-medium text-right">IVA</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium">CAE</th>
              </tr></thead>
              <tbody>
                {(datos?.comprobantes ?? []).map((c: any) => (
                  <tr key={c.numero + c.tipo} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2 text-xs text-black/55 whitespace-nowrap">{c.fecha}</td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap">{TIPO_LABEL[c.tipo] ?? c.tipo} {c.numero}</td>
                    <td className="px-4 py-2 text-xs max-w-40 truncate">{c.receptor}{c.docNro ? ` (${c.docTipo} ${c.docNro})` : ''}</td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(c.neto)}</td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-[#932A1F]">{pesos(c.iva)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{pesos(c.total)}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-black/55">{c.cae}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-black/45 px-1">
        El CSV incluye numeración completa, receptor, neto gravado, IVA débito, total y CAE de cada comprobante del período:
        listo para el libro IVA ventas del contador. Los importes usan coma decimal (formato Excel argentino).
      </p>
    </div>
  );
}

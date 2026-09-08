'use client';

import { useEffect, useState } from 'react';

// Planilla de cierre de una sesión de caja. Con la caja ABIERTA dice cómo va
// (qué tendría que haber en el cajón); CERRADA, cómo terminó: ventas, cada
// medio de pago, el arqueo de efectivo y los movimientos. Se imprime tal cual.
const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export type ResumenCierreDatos = {
  sesion: { id: string; caja: string | null; sucursal: string | null; cajero: string | null; abiertaEn: string; cerradaEn: string | null; cerrada: boolean };
  ventas: { cantidad: number; total: number; anuladas: number };
  medios: { clave: string; medio: string; etiqueta: string; monto: number; pagos: number }[];
  cobrado: number;
  efectivo: { base: number; ventas: number; ingresos: number; egresos: number; esperado: number; contado: number | null; diferencia: number | null };
  movimientos: { tipo: string; monto: number; motivo: string; creadoEn: string; usuario: string | null }[];
};

// La planilla se imprime en una ventana propia: la pantalla de caja oculta todo
// al imprimir (solo deja pasar el ticket térmico) y así sale siempre, limpia.
function imprimirPlanilla(d: ResumenCierreDatos) {
  const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const dif = d.efectivo.diferencia;
  const filaDif = d.sesion.cerrada
    ? `<tr><td>Contado</td><td class="n">${pesos(d.efectivo.contado)}</td></tr>
       <tr class="dif"><td>${dif === 0 ? 'Cerró justo' : (dif ?? 0) < 0 ? 'Faltó efectivo' : 'Sobró efectivo'}</td><td class="n">${dif === 0 ? '' : ((dif ?? 0) > 0 ? '+' : '') + pesos(dif)}</td></tr>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cierre de caja</title>
<style>
  body{font-family:-apple-system,system-ui,Segoe UI,sans-serif;color:#141414;margin:24px;font-size:13px}
  h1{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#666;margin:0}
  h2{font-size:18px;margin:2px 0 0} .sub{color:#666;margin:2px 0 14px}
  table{width:100%;border-collapse:collapse;margin-bottom:14px} td,th{padding:5px 6px;border-top:1px solid #e5e5e5;text-align:left}
  th{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#666;background:#f5f1ea;border:0}
  .n{text-align:right;font-variant-numeric:tabular-nums} .tot td{font-weight:700;border-top:2px solid #141414}
  .dif td{font-weight:700} .small{color:#888;font-size:11px}
  @media print{body{margin:10mm}}
</style></head><body>
<h1>${d.sesion.cerrada ? 'Cierre de caja' : 'Cómo va la caja'}</h1>
<h2>${esc(d.sesion.caja ?? 'Caja')}${d.sesion.sucursal ? ' · ' + esc(d.sesion.sucursal) : ''}</h2>
<p class="sub">${esc(d.sesion.cajero ?? '—')} · abierta ${hora(d.sesion.abiertaEn)}${d.sesion.cerrada ? ' · cerrada ' + hora(d.sesion.cerradaEn) : ''}</p>
<table><tr><th>Ventas</th><th class="n">Total</th></tr>
<tr><td>${d.ventas.cantidad} venta(s)${d.ventas.anuladas ? ' · ' + d.ventas.anuladas + ' anulada(s)' : ''}</td><td class="n">${pesos(d.ventas.total)}</td></tr></table>
<table><tr><th>Cobrado por medio</th><th class="n">Cobros</th><th class="n">Monto</th></tr>
${d.medios.map((m) => `<tr><td>${esc(m.etiqueta)}</td><td class="n">${m.pagos}</td><td class="n">${pesos(m.monto)}</td></tr>`).join('')}
<tr class="tot"><td>Total cobrado</td><td></td><td class="n">${pesos(d.cobrado)}</td></tr></table>
<table><tr><th>Arqueo de efectivo</th><th class="n"></th></tr>
<tr><td>Base inicial</td><td class="n">${pesos(d.efectivo.base)}</td></tr>
<tr><td>+ Ventas en efectivo</td><td class="n">${pesos(d.efectivo.ventas)}</td></tr>
${d.efectivo.ingresos ? `<tr><td>+ Ingresos de caja</td><td class="n">${pesos(d.efectivo.ingresos)}</td></tr>` : ''}
${d.efectivo.egresos ? `<tr><td>− Retiros de caja</td><td class="n">${pesos(d.efectivo.egresos)}</td></tr>` : ''}
<tr class="tot"><td>${d.sesion.cerrada ? 'Tenía que haber' : 'Tiene que haber en el cajón'}</td><td class="n">${pesos(d.efectivo.esperado)}</td></tr>
${filaDif}</table>
${d.movimientos.length ? `<table><tr><th>Movimientos de caja</th><th></th><th class="n"></th></tr>${d.movimientos.map((m) => `<tr><td class="small">${hora(m.creadoEn)}</td><td>${esc(m.motivo)}${m.usuario ? ' · ' + esc(m.usuario) : ''}</td><td class="n">${m.tipo === 'egreso' ? '−' : '+'}${pesos(m.monto)}</td></tr>`).join('')}</table>` : ''}
<p class="small">Impreso ${new Date().toLocaleString('es-AR')}</p>
<script>window.onload = function(){ window.print(); }</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

export function ResumenCierre({ sesionId, recargar = 0, imprimible = true }: { sesionId: string; recargar?: number; imprimible?: boolean }) {
  const [d, setD] = useState<ResumenCierreDatos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    fetch(`/api/caja?recurso=sesion-resumen&sesionId=${encodeURIComponent(sesionId)}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.message ?? 'No se pudo cargar el cierre'); return j; })
      .then((j) => { if (vivo) setD(j); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar el cierre'); });
    return () => { vivo = false; };
  }, [sesionId, recargar]);

  if (error) return <p className="rounded-lg bg-[#B82D25]/10 px-3 py-2 text-sm text-[#932A1F]">{error}</p>;
  if (!d) return <p className="py-6 text-center text-sm text-black/40">Armando el cierre…</p>;

  const dif = d.efectivo.diferencia;
  const filas: [string, string, string?][] = [
    ['Base inicial', pesos(d.efectivo.base)],
    ['+ Ventas en efectivo', pesos(d.efectivo.ventas)],
    ...(d.efectivo.ingresos ? [['+ Ingresos de caja', pesos(d.efectivo.ingresos)] as [string, string]] : []),
    ...(d.efectivo.egresos ? [['− Retiros de caja', pesos(d.efectivo.egresos)] as [string, string]] : []),
  ];

  return (
    <div id="cierre-caja-print" className="space-y-4 text-[#141414]">
      <style>{`@media print { body * { visibility: hidden !important; } #cierre-caja-print, #cierre-caja-print * { visibility: visible !important; } #cierre-caja-print { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; } .no-print { display: none !important; } }`}</style>

      {/* cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/45">{d.sesion.cerrada ? 'Cierre de caja' : 'Cómo va la caja'}</p>
          <p className="text-lg font-semibold leading-tight">{d.sesion.caja ?? 'Caja'}{d.sesion.sucursal ? <span className="font-normal text-black/50"> · {d.sesion.sucursal}</span> : null}</p>
          <p className="text-xs text-black/55">{d.sesion.cajero ?? '—'} · abierta {hora(d.sesion.abiertaEn)}{d.sesion.cerrada ? ` · cerrada ${hora(d.sesion.cerradaEn)}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/45">Ventas</p>
          <p className="text-2xl font-bold tabular-nums leading-tight">{pesos(d.ventas.total)}</p>
          <p className="text-xs text-black/55">{d.ventas.cantidad} venta{d.ventas.cantidad === 1 ? '' : 's'}{d.ventas.anuladas ? ` · ${d.ventas.anuladas} anulada(s)` : ''}</p>
        </div>
      </div>

      {/* cómo terminó cada medio */}
      <section className="rounded-xl border border-black/10 overflow-hidden">
        <div className="flex items-baseline justify-between bg-[#F0EBE2]/70 px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/55">Cobrado por medio</p>
          <p className="text-xs text-black/50">{pesos(d.cobrado)} en total</p>
        </div>
        {d.medios.length === 0 ? (
          <p className="px-3 py-3 text-sm text-black/45">Todavía no hay cobros en esta caja.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {d.medios.map((m) => (
                <tr key={m.clave} className="border-t border-black/5">
                  <td className="px-3 py-1.5">{m.etiqueta}<span className="ml-2 text-[11px] text-black/40">{m.pagos} cobro{m.pagos === 1 ? '' : 's'}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{pesos(m.monto)}</td>
                  <td className="w-16 px-3 py-1.5 text-right text-[11px] tabular-nums text-black/40">{d.cobrado > 0 ? Math.round((m.monto / d.cobrado) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* arqueo de efectivo */}
      <section className="rounded-xl border border-black/10 overflow-hidden">
        <p className="bg-[#F0EBE2]/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-black/55">Arqueo de efectivo</p>
        <div className="px-3 py-2 text-sm">
          {filas.map(([k, v]) => (
            <p key={k} className="flex justify-between py-0.5"><span className="text-black/60">{k}</span><span className="tabular-nums">{v}</span></p>
          ))}
          <p className="mt-1 flex justify-between border-t border-black/10 pt-1.5 font-semibold"><span>{d.sesion.cerrada ? 'Tenía que haber' : 'Tiene que haber en el cajón'}</span><span className="tabular-nums">{pesos(d.efectivo.esperado)}</span></p>
          {d.sesion.cerrada && (
            <>
              <p className="flex justify-between py-0.5"><span className="text-black/60">Contado</span><span className="tabular-nums">{pesos(d.efectivo.contado)}</span></p>
              <p className={'mt-1 flex justify-between rounded-lg px-2 py-1.5 font-bold ' + (dif === 0 ? 'bg-emerald-50 text-emerald-800' : (dif ?? 0) < 0 ? 'bg-[#B82D25]/10 text-[#932A1F]' : 'bg-amber-50 text-amber-900')}>
                <span>{dif === 0 ? 'Cerró justo ✓' : (dif ?? 0) < 0 ? 'Faltó efectivo' : 'Sobró efectivo'}</span>
                <span className="tabular-nums">{dif === 0 ? '' : ((dif ?? 0) > 0 ? '+' : '') + pesos(dif)}</span>
              </p>
            </>
          )}
        </div>
      </section>

      {/* movimientos */}
      {d.movimientos.length > 0 && (
        <section className="rounded-xl border border-black/10 overflow-hidden">
          <p className="bg-[#F0EBE2]/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-black/55">Movimientos de caja</p>
          <table className="w-full text-xs">
            <tbody>
              {d.movimientos.map((m, i) => (
                <tr key={i} className="border-t border-black/5">
                  <td className="px-3 py-1 text-black/45 whitespace-nowrap">{hora(m.creadoEn)}</td>
                  <td className="px-3 py-1">{m.motivo}{m.usuario ? <span className="text-black/40"> · {m.usuario}</span> : null}</td>
                  <td className={'px-3 py-1 text-right tabular-nums font-medium ' + (m.tipo === 'egreso' ? 'text-[#932A1F]' : 'text-emerald-800')}>{m.tipo === 'egreso' ? '−' : '+'}{pesos(m.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {imprimible && (
        <div className="no-print flex justify-end">
          <button type="button" onClick={() => imprimirPlanilla(d)} className="rounded-full border border-black/20 px-4 py-1.5 text-xs font-medium text-black/70 hover:border-black hover:text-black">🖨 Imprimir cierre</button>
        </div>
      )}
    </div>
  );
}

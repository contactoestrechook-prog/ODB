'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, IconoOk, ROTULO, unir } from './kit';
import { fechaHora, pesos } from '../lib/formato';

// Planilla de cierre de una sesión de caja. Con la caja ABIERTA dice cómo va
// (qué tendría que haber en el cajón); CERRADA, cómo terminó: ventas, cada
// medio de pago, el arqueo de efectivo y los movimientos. Se imprime tal cual.

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
<p class="sub">${esc(d.sesion.cajero ?? '—')} · abierta ${fechaHora(d.sesion.abiertaEn)}${d.sesion.cerrada ? ' · cerrada ' + fechaHora(d.sesion.cerradaEn) : ''}</p>
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
${d.movimientos.length ? `<table><tr><th>Movimientos de caja</th><th></th><th class="n"></th></tr>${d.movimientos.map((m) => `<tr><td class="small">${fechaHora(m.creadoEn)}</td><td>${esc(m.motivo)}${m.usuario ? ' · ' + esc(m.usuario) : ''}</td><td class="n">${m.tipo === 'egreso' ? '−' : '+'}${pesos(m.monto)}</td></tr>`).join('')}</table>` : ''}
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

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!d) return <Cargando bloque texto="Armando el cierre…" className="py-6" />;

  const dif = d.efectivo.diferencia;
  const filas: [string, string, string?][] = [
    ['Base inicial', pesos(d.efectivo.base)],
    ['+ Ventas en efectivo', pesos(d.efectivo.ventas)],
    ...(d.efectivo.ingresos ? [['+ Ingresos de caja', pesos(d.efectivo.ingresos)] as [string, string]] : []),
    ...(d.efectivo.egresos ? [['− Retiros de caja', pesos(d.efectivo.egresos)] as [string, string]] : []),
  ];
  const cabeceraSeccion = 'bg-crema/70 px-3 py-1.5';

  return (
    <div id="cierre-caja-print" className="min-w-0 space-y-4 text-tinta">
      <style>{`@media print { body * { visibility: hidden !important; } #cierre-caja-print, #cierre-caja-print * { visibility: visible !important; } #cierre-caja-print { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; } .no-print { display: none !important; } }`}</style>

      {/* cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className={ROTULO}>{d.sesion.cerrada ? 'Cierre de caja' : 'Cómo va la caja'}</p>
          <p className="break-words text-lg font-semibold leading-tight">{d.sesion.caja ?? 'Caja'}{d.sesion.sucursal ? <span className="font-normal text-tinta/60"> · {d.sesion.sucursal}</span> : null}</p>
          <p className="text-xs text-tinta/70">{d.sesion.cajero ?? '—'} · abierta {fechaHora(d.sesion.abiertaEn)}{d.sesion.cerrada ? ` · cerrada ${fechaHora(d.sesion.cerradaEn)}` : ''}</p>
        </div>
        <div className="text-right">
          <p className={ROTULO}>Ventas</p>
          <p className="importe text-2xl font-bold leading-tight">{pesos(d.ventas.total)}</p>
          <p className="text-xs text-tinta/70">{d.ventas.cantidad} venta{d.ventas.cantidad === 1 ? '' : 's'}{d.ventas.anuladas ? ` · ${d.ventas.anuladas} anulada(s)` : ''}</p>
        </div>
      </div>

      {/* cómo terminó cada medio */}
      <section className="overflow-hidden rounded-xl border border-black/[0.06]">
        <div className={unir('flex flex-wrap items-baseline justify-between gap-x-3', cabeceraSeccion)}>
          <p className={ROTULO}>Cobrado por medio</p>
          <p className="importe text-xs text-tinta/70">{pesos(d.cobrado)} en total</p>
        </div>
        {d.medios.length === 0 ? (
          <p className="px-3 py-3 text-sm text-tinta/60">Todavía no hay cobros en esta caja.</p>
        ) : (
          <ul className="text-sm">
            {d.medios.map((m) => (
              <li key={m.clave} className="flex items-baseline gap-3 border-t border-black/[0.06] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="break-words">{m.etiqueta}</span>
                  <span className="ml-2 whitespace-nowrap text-xs text-tinta/60">{m.pagos} cobro{m.pagos === 1 ? '' : 's'}</span>
                </div>
                <span className="importe shrink-0 font-medium">{pesos(m.monto)}</span>
                <span className="importe w-10 shrink-0 text-right text-xs text-tinta/60">{d.cobrado > 0 ? Math.round((m.monto / d.cobrado) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* arqueo de efectivo */}
      <section className="overflow-hidden rounded-xl border border-black/[0.06]">
        <p className={unir(ROTULO, cabeceraSeccion)}>Arqueo de efectivo</p>
        <div className="px-3 py-2 text-sm">
          {filas.map(([k, v]) => (
            <p key={k} className="flex justify-between gap-3 py-0.5"><span className="min-w-0 text-tinta/70">{k}</span><span className="importe shrink-0">{v}</span></p>
          ))}
          <p className="mt-1 flex justify-between gap-3 border-t border-black/[0.06] pt-1.5 font-semibold"><span className="min-w-0">{d.sesion.cerrada ? 'Tenía que haber' : 'Tiene que haber en el cajón'}</span><span className="importe shrink-0">{pesos(d.efectivo.esperado)}</span></p>
          {d.sesion.cerrada && (
            <>
              <p className="flex justify-between gap-3 py-0.5"><span className="text-tinta/70">Contado</span><span className="importe shrink-0">{pesos(d.efectivo.contado)}</span></p>
              <p className={'mt-1 flex justify-between gap-3 rounded-xl px-2 py-1.5 font-bold ' + (dif === 0 ? 'bg-ok-suave text-ok' : (dif ?? 0) < 0 ? 'bg-marca-suave text-marca-hondo' : 'bg-atencion-suave text-atencion')}>
                <span className="inline-flex min-w-0 items-center gap-1">{dif === 0 ? <>Cerró justo <IconoOk className="size-4 shrink-0" /></> : (dif ?? 0) < 0 ? 'Faltó efectivo' : 'Sobró efectivo'}</span>
                <span className="importe shrink-0">{dif === 0 ? '' : ((dif ?? 0) > 0 ? '+' : '') + pesos(dif)}</span>
              </p>
            </>
          )}
        </div>
      </section>

      {/* movimientos */}
      {d.movimientos.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-black/[0.06]">
          <p className={unir(ROTULO, cabeceraSeccion)}>Movimientos de caja</p>
          <ul className="text-sm">
            {d.movimientos.map((m, i) => (
              <li key={i} className="flex items-baseline gap-3 border-t border-black/[0.06] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words">{m.motivo}{m.usuario ? <span className="text-tinta/60"> · {m.usuario}</span> : null}</p>
                  <p className="importe text-xs text-tinta/60">{fechaHora(m.creadoEn)}</p>
                </div>
                <span className={'importe shrink-0 font-medium ' + (m.tipo === 'egreso' ? 'text-marca-hondo' : 'text-ok')}>{m.tipo === 'egreso' ? '−' : '+'}{pesos(m.monto)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {imprimible && (
        <div className="no-print flex justify-end">
          <Boton variante="secundario" tamano="chico" onClick={() => imprimirPlanilla(d)}>Imprimir cierre</Boton>
        </div>
      )}
    </div>
  );
}

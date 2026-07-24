'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const pesosCortos = (n: number) =>
  n >= 1_000_000 ? '$' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'M' : '$' + Math.round(n / 1000) + 'k';
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');

const TIPO: Record<string, string> = {
  account_money: 'Dinero en cuenta',
  credit_card: 'Tarjeta de crédito',
  debit_card: 'Tarjeta de débito',
  bank_transfer: 'Transferencia',
  ticket: 'Efectivo (Rapipago/PF)',
  prepaid_card: 'Prepaga',
  digital_currency: 'Moneda digital',
};
const TIPO_COLOR: Record<string, string> = {
  account_money: 'bg-sky-500',
  credit_card: 'bg-amber-500',
  debit_card: 'bg-emerald-500',
  bank_transfer: 'bg-violet-500',
  ticket: 'bg-pink-500',
  prepaid_card: 'bg-rose-400',
  digital_currency: 'bg-slate-400',
};

// Identidad de cada empresa en todo el panel
const EMPRESAS: Record<string, { nombre: string; corto: string; color: string; bg: string; chip: string }> = {
  principal: { nombre: 'Sant Thomas · Chinvenguencha SRL', corto: 'Sant Thomas', color: '#B82D25', bg: 'bg-[#B82D25]', chip: 'bg-[#B82D25]/10 text-[#B82D25]' },
  santa_ines: { nombre: 'Santa Inés · ODB SRL', corto: 'Santa Inés', color: '#0F766E', bg: 'bg-[#0F766E]', chip: 'bg-[#0F766E]/10 text-[#0F766E]' },
};

const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function MercadoPagoWorkspace({ estado, resumen: resumenInicial, pagos: pagosIniciales }: { estado: any; resumen: any; pagos: any[] }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState<string>(''); // '' = las dos
  const [dias, setDias] = useState<number>(30);
  const [resumen, setResumen] = useState<any>(resumenInicial);
  const [pagos, setPagos] = useState<any[]>(pagosIniciales);
  const [modalLink, setModalLink] = useState(false);
  const [link, setLink] = useState<{ url: string; monto: number; concepto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const recargar = async (cuenta: string, d: number) => {
    setCargando(true);
    try {
      const q = cuenta ? `&cuenta=${cuenta}` : '';
      const [rr, rp] = await Promise.all([
        fetch(`/api/mercadopago?recurso=resumen&dias=${d}${q}`),
        fetch(`/api/mercadopago?recurso=pagos&dias=${d}${q}`),
      ]);
      if (rr.ok) setResumen(await rr.json());
      if (rp.ok) setPagos(await rp.json());
    } finally {
      setCargando(false);
    }
  };
  const filtrar = (cuenta: string) => { setFiltro(cuenta); void recargar(cuenta, dias); };
  const cambiarPeriodo = (d: number) => { setDias(d); void recargar(filtro, d); };

  const PERIODOS: [number, string][] = [[1, 'Hoy'], [7, 'Semana'], [15, 'Quincena'], [30, 'Mes']];
  const periodoLabel = (PERIODOS.find(([d]) => d === dias)?.[1] ?? `${dias} días`).toLowerCase();

  const importar = async () => {
    setCargando(true);
    setAviso('');
    try {
      const res = await fetch('/api/mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'importar', dias: 30 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      const detalle = (d.porCuenta ?? []).map((c: any) => `${EMPRESAS[c.cuenta]?.corto ?? c.cuenta}: ${c.importados}`).join(' · ');
      setAviso(`Importados ${d.importados} pagos (${detalle}) · ${d.vinculados} vinculados a ventas · ${d.acreditacionesActualizadas} acreditaciones al día.`);
      router.refresh();
      await recargar(filtro, dias);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo importar');
    } finally {
      setCargando(false);
    }
  };

  const generarLink = async () => {
    setCargando(true);
    setAviso('');
    try {
      const monto = Number((document.getElementById('linkMonto') as HTMLInputElement)?.value || 0);
      const concepto = (document.getElementById('linkConcepto') as HTMLInputElement)?.value || '';
      const res = await fetch('/api/mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'link', monto, concepto }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      setLink(d);
      setCopiado(false);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo crear el link');
    } finally {
      setCargando(false);
    }
  };

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiado(true);
    } catch {}
  };

  if (!estado?.vinculado) {
    return (
      <div className="rounded-xl bg-white p-8 text-center space-y-2">
        <p className="text-lg font-medium text-black">Mercado Pago no está vinculado</p>
        <p className="text-sm text-black/50">Faltan las credenciales en Railway (servicio odb-api).</p>
      </div>
    );
  }

  const porCuenta: any[] = resumen?.porCuenta ?? [];
  const totalCuentas = porCuenta.reduce((s, c) => s + c.bruto, 0) || 1;
  const serie: any[] = resumen?.porDia ?? [];
  const maxDia = Math.max(...serie.map((d) => d.principal + d.santa_ines), 1);

  return (
    <div className="space-y-5">
      {/* estado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[['', 'Las dos'], ['principal', 'Sant Thomas'], ['santa_ines', 'Santa Inés']].map(([id, label]) => {
            const activo = filtro === id;
            const color = id === '' ? '#000000' : EMPRESAS[id]?.color ?? '#000';
            return (
              <button
                key={id}
                onClick={() => filtrar(id)}
                style={activo ? { backgroundColor: color, borderColor: color } : {}}
                className={'rounded-full px-4 py-2 text-sm font-medium border transition ' +
                  (activo ? 'text-white' : 'bg-white text-black border-black/15 hover:border-black/40')}
              >
                {label}
              </button>
            );
          })}
          {cargando && <span className="text-xs text-black/40 ml-1">actualizando…</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setModalLink(true); setLink(null); }} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 hover:border-[#B82D25]">
            Generar link de pago
          </button>
          <button onClick={importar} disabled={cargando} className="rounded-full bg-black text-white text-sm font-medium px-4 py-2 hover:bg-black/80 disabled:opacity-50">
            {cargando ? 'Trayendo…' : 'Importar de Mercado Pago'}
          </button>
        </div>
      </div>

      {/* período: hoy / semana / quincena / mes */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-black/40 mr-1">Período:</span>
        {PERIODOS.map(([d, label]) => (
          <button
            key={d}
            onClick={() => cambiarPeriodo(d)}
            className={'rounded-full px-3.5 py-1.5 text-xs font-medium border ' +
              (dias === d ? 'bg-black text-white border-black' : 'bg-white text-black border-black/15 hover:border-black/40')}
          >
            {label}
          </button>
        ))}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-black/70">{aviso}</p>}

      {/* comparativa entre empresas (solo en vista "las dos") */}
      {!filtro && porCuenta.length > 1 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {porCuenta.map((c) => {
            const e = EMPRESAS[c.cuenta] ?? EMPRESAS.principal;
            const share = Math.round((c.bruto / totalCuentas) * 100);
            const est = (estado.cuentas ?? []).find((x: any) => x.slug === c.cuenta);
            return (
              <div key={c.cuenta} className="rounded-2xl bg-white overflow-hidden border border-black/[0.04]">
                <div className={`${e.bg} px-5 py-3 flex items-center justify-between`}>
                  <p className="text-white font-semibold text-sm">{e.nombre}</p>
                  <span className="rounded-full bg-white/20 text-white text-[11px] px-2 py-0.5">
                    {est?.vinculado ? 'conectada' : 'pendiente'}
                  </span>
                </div>
                <div className="px-5 py-4">
                  <div className="flex items-end justify-between">
                    <p className="text-2xl font-bold text-black leading-none">{pesos(c.bruto)}</p>
                    <p className="text-xs text-black/45">{c.cantidad.toLocaleString('es-AR')} cobros · {share}%</p>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-black/[0.06]">
                    <div className="h-2 rounded-full" style={{ width: `${share}%`, backgroundColor: e.color }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          [`Cobrado (${periodoLabel})`, pesos(resumen?.bruto), 'border-black', 'text-black', `${resumen?.cobros ?? 0} cobros`],
          ['Comisión MP', pesos(resumen?.comision), 'border-[#932A1F]', 'text-[#932A1F]', `${resumen?.comisionPromedioPct ?? 0} % promedio`],
          ['Neto', pesos(resumen?.neto), 'border-sky-600', 'text-sky-800'],
          ['Ya liberado', pesos(resumen?.liberado), 'border-emerald-600', 'text-emerald-700'],
          ['Por liberar', pesos(resumen?.porLiberar), 'border-amber-500', resumen?.porLiberar > 0 ? 'text-amber-600' : 'text-black'],
        ].map(([l, v, borde, texto, sub]: any) => (
          <div key={l} className={`rounded-xl bg-white p-3.5 border-l-4 ${borde} shadow-sm`}>
            <p className={`text-lg font-bold leading-none ${texto}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1.5">{l}{sub ? ` · ${sub}` : ''}</p>
          </div>
        ))}
      </div>

      {/* cobros por día */}
      {serie.length > 0 && (
        <section className="rounded-xl bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-black text-sm">Cobros por día ({periodoLabel})</h2>
            <div className="flex items-center gap-3 text-[11px] text-black/55">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#B82D25]" /> Sant Thomas</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0F766E]" /> Santa Inés</span>
            </div>
          </div>
          <div className="flex items-end gap-[3px] h-32">
            {serie.map((d) => {
              const total = d.principal + d.santa_ines;
              return (
                <div key={d.fecha} className="flex-1 flex flex-col justify-end gap-[1px] group" title={`${fecha(d.fecha)}: ${pesosCortos(total)} (ST ${pesosCortos(d.principal)} · SI ${pesosCortos(d.santa_ines)})`}>
                  <div className="rounded-t-sm bg-[#0F766E] group-hover:opacity-70" style={{ height: `${Math.max((d.santa_ines / maxDia) * 100, d.santa_ines > 0 ? 2 : 0)}%` }} />
                  <div className="rounded-t-sm bg-[#B82D25] group-hover:opacity-70" style={{ height: `${Math.max((d.principal / maxDia) * 100, d.principal > 0 ? 2 : 0.5)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-black/40">
            <span>hace {dias} días</span>
            <span>hoy</span>
          </div>
        </section>
      )}

      {/* próximas liberaciones */}
      {(resumen?.proximasLiberaciones ?? []).length > 0 && (
        <div className="rounded-xl bg-white p-4">
          <p className="text-sm font-medium text-black mb-2">💰 Próximas liberaciones de dinero</p>
          <div className="flex flex-wrap gap-2">
            {resumen.proximasLiberaciones.map((p: any) => (
              <span key={p.fecha} className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs text-amber-900">
                {fecha(p.fecha)} · <span className="font-bold">{pesos(p.neto)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* desglose por medio */}
      {(resumen?.porTipo ?? []).length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {resumen.porTipo.map((t: any) => (
            <div key={t.tipo} className="rounded-xl bg-white p-4 border border-black/[0.04] shadow-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${TIPO_COLOR[t.tipo] ?? 'bg-black/30'}`} />
                <p className="text-xs font-medium text-black/60">{TIPO[t.tipo] ?? t.tipo}</p>
              </div>
              <p className="text-lg font-bold text-black mt-1.5">{pesos(t.bruto)}</p>
              <p className="text-[11px] text-black/40">{t.cantidad.toLocaleString('es-AR')} cobros</p>
            </div>
          ))}
        </div>
      )}

      {/* listado */}
      <section className="rounded-xl bg-white overflow-hidden shadow-sm">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
          Pagos {filtro ? `de ${EMPRESAS[filtro]?.corto}` : 'de las dos empresas'} ({periodoLabel} · {pagos.length})
        </h2>
        {pagos.length === 0 ? (
          <p className="px-4 py-10 text-center text-black/40 text-sm">Sin pagos en este período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-black min-w-[46rem]">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Medio</th>
                <th className="px-4 py-2 font-medium text-right">Bruto</th>
                <th className="px-4 py-2 font-medium text-right">Comisión</th>
                <th className="px-4 py-2 font-medium text-right">Neto</th>
                <th className="px-4 py-2 font-medium text-right">Liberación</th>
                <th className="px-4 py-2 font-medium text-center">Venta</th>
              </tr></thead>
              <tbody>
                {pagos.map((p) => {
                  const e = EMPRESAS[p.cuenta ?? 'principal'] ?? EMPRESAS.principal;
                  return (
                    <tr key={p.id} className={`border-b border-black/5 last:border-0 ${p.estado !== 'approved' ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2.5 text-xs text-black/55 whitespace-nowrap">{fecha(p.aprobado_en)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${e.chip}`}>{e.corto}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${TIPO_COLOR[p.tipo] ?? 'bg-black/30'}`} />
                        {TIPO[p.tipo] ?? p.tipo ?? '—'}{p.cuotas > 1 ? ` · ${p.cuotas} cuotas` : ''}
                        {p.estado !== 'approved' && <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">{p.estado}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{pesos(p.bruto)}</td>
                      <td className="px-4 py-2.5 text-right text-[#932A1F] text-xs tabular-nums">{pesos(p.comision)}</td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">{pesos(p.neto)}</td>
                      <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">
                        {p.liberado
                          ? <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px]">liberado</span>
                          : <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px]">{fecha(p.liberacion_en)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs">{p.venta_id ? <span className="text-emerald-600">✓</span> : <span className="text-black/20">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* modal link de pago */}
      {modalLink && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={() => setModalLink(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-black text-lg">Link de pago</h2>
            {!link ? (
              <>
                <p className="text-xs text-black/45">Generá un link para cobrar a distancia (WhatsApp, teléfono). El pago entra solo al sistema.</p>
                <label className="text-xs text-black/50">Monto</label>
                <input id="linkMonto" type="number" min="1" step="0.01" className={input} autoFocus placeholder="15000" />
                <label className="text-xs text-black/50">Concepto (lo ve el cliente)</label>
                <input id="linkConcepto" type="text" className={input} placeholder="Pedido O.D.B" />
                <div className="flex justify-end gap-3 pt-1">
                  <button onClick={() => setModalLink(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
                  <button onClick={generarLink} disabled={cargando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">
                    {cargando ? '…' : 'Generar'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-black">Link por <span className="font-semibold">{pesos(link.monto)}</span> — {link.concepto}</p>
                <p className="rounded-lg bg-[#F0EBE2] p-3 text-xs text-black/70 break-all">{link.url}</p>
                <div className="flex justify-end gap-3 pt-1">
                  <button onClick={() => setModalLink(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cerrar</button>
                  <button onClick={copiar} className="rounded-full bg-black text-white text-sm font-medium px-6 py-2.5 hover:bg-black/80">
                    {copiado ? '✓ Copiado' : 'Copiar link'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

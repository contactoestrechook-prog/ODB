'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');
const TIPO: Record<string, string> = {
  account_money: 'Dinero en cuenta',
  credit_card: 'Tarjeta de crédito',
  debit_card: 'Tarjeta de débito',
  bank_transfer: 'Transferencia',
  ticket: 'Efectivo (Rapipago/PF)',
  prepaid_card: 'Prepaga',
};
const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';
const CUENTA_LABEL: Record<string, string> = { principal: 'Sant Thomas (Chinvenguencha)', santa_ines: 'Santa Inés' };

export function MercadoPagoWorkspace({ estado, resumen, pagos }: { estado: any; resumen: any; pagos: any[] }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [modalLink, setModalLink] = useState(false);
  const [link, setLink] = useState<{ url: string; monto: number; concepto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

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
      setAviso(`Importados ${d.importados} pagos de Mercado Pago · ${d.vinculados} vinculados a ventas · ${d.acreditacionesActualizadas} acreditaciones actualizadas con números reales.`);
      router.refresh();
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
        <p className="text-sm text-black/50">
          Falta cargar el Access Token en Railway (variable MERCADOPAGO_ACCESS_TOKEN del servicio odb-api).
          {estado?.error ? ` Detalle: ${estado.error}` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* estado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-black/60">
          {(estado.cuentas ?? [{ slug: 'principal', vinculado: true, cuenta: estado.cuenta }]).map((c: any) => (
            <span key={c.slug} className="flex items-center gap-1.5">
              <span className="font-medium text-black">{CUENTA_LABEL[c.slug] ?? c.slug}</span>
              {c.vinculado ? (
                <span className="rounded-full bg-emerald-100 text-emerald-800 text-[11px] px-2 py-0.5" title={c.cuenta}>conectada</span>
              ) : (
                <span className="rounded-full bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5" title={c.error}>pendiente</span>
              )}
            </span>
          ))}
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

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-black/70">{aviso}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          ['Cobrado (30 días)', pesos(resumen?.bruto), '', `${resumen?.cobros ?? 0} cobros`],
          ['Comisión MP', pesos(resumen?.comision), 'text-[#932A1F]', `${resumen?.comisionPromedioPct ?? 0} % promedio`],
          ['Neto', pesos(resumen?.neto), ''],
          ['Ya liberado', pesos(resumen?.liberado), 'text-emerald-700'],
          ['Por liberar', pesos(resumen?.porLiberar), resumen?.porLiberar > 0 ? 'text-[#B82D25]' : ''],
        ].map(([l, v, c, sub]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}{sub ? ` · ${sub}` : ''}</p>
          </div>
        ))}
      </div>

      {/* próximas liberaciones */}
      {(resumen?.proximasLiberaciones ?? []).length > 0 && (
        <div className="rounded-xl bg-white p-4">
          <p className="text-sm font-medium text-black mb-2">Próximas liberaciones de dinero</p>
          <div className="flex flex-wrap gap-2">
            {resumen.proximasLiberaciones.map((p: any) => (
              <span key={p.fecha} className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs text-black">
                {fecha(p.fecha)} · <span className="font-semibold">{pesos(p.neto)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* desglose por tipo */}
      {(resumen?.porTipo ?? []).length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {resumen.porTipo.map((t: any) => (
            <div key={t.tipo} className="rounded-xl bg-white p-4 border border-black/[0.04] flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">{TIPO[t.tipo] ?? t.tipo}</p>
                <p className="text-xs text-black/45">{t.cantidad} cobros</p>
              </div>
              <p className="font-semibold text-black">{pesos(t.bruto)}</p>
            </div>
          ))}
        </div>
      )}

      {/* listado */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
          Pagos de Mercado Pago (últimos 30 días · {pagos.length})
        </h2>
        {pagos.length === 0 ? (
          <p className="px-4 py-10 text-center text-black/40 text-sm">
            Todavía no hay pagos importados. Tocá «Importar de Mercado Pago» para traer el historial real de tu cuenta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-black min-w-[44rem]">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Medio</th>
                <th className="px-4 py-2 font-medium">Detalle</th>
                <th className="px-4 py-2 font-medium text-right">Bruto</th>
                <th className="px-4 py-2 font-medium text-right">Comisión</th>
                <th className="px-4 py-2 font-medium text-right">Neto</th>
                <th className="px-4 py-2 font-medium text-right">Liberación</th>
                <th className="px-4 py-2 font-medium text-center">Venta</th>
              </tr></thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} className={`border-b border-black/5 last:border-0 ${p.estado !== 'approved' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 text-xs text-black/55 whitespace-nowrap">{fecha(p.aprobado_en)}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {TIPO[p.tipo] ?? p.tipo ?? '—'}{p.cuotas > 1 ? ` · ${p.cuotas} cuotas` : ''}
                      {p.estado !== 'approved' && <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px]">{p.estado}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-black/55 max-w-48 truncate">
                      {p.cuenta && p.cuenta !== 'principal' && (
                        <span className="mr-1.5 rounded bg-[#F0EBE2] px-1.5 py-0.5 text-[10px] text-black/60">{CUENTA_LABEL[p.cuenta] ?? p.cuenta}</span>
                      )}
                      {p.descripcion ?? p.referencia_externa ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">{pesos(p.bruto)}</td>
                    <td className="px-4 py-2.5 text-right text-[#932A1F]">{pesos(p.comision)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{pesos(p.neto)}</td>
                    <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">
                      {p.liberado
                        ? <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px]">liberado</span>
                        : fecha(p.liberacion_en)}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">{p.venta_id ? '✓' : <span className="text-black/30">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-black/45 px-1">
        La comisión y la fecha de liberación son las que informa Mercado Pago para cada pago. Al importar, los cobros se
        vinculan solos con las ventas de la caja (mismo monto y horario) y la conciliación se completa con los números reales.
      </p>

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

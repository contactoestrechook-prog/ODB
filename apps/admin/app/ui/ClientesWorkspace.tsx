'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfigCliente } from './ConfigCliente';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const TIPO_ESTILO: Record<string, string> = {
  vip: 'bg-black text-white', mayorista: 'bg-black text-white',
  frecuente: 'bg-[#B82D25] text-white', ocasional: 'bg-[#F0EBE2] text-black', nuevo: 'bg-[#F0EBE2] text-black/60',
};

const TABS = [['todos', 'Todos'], ['segmentos', 'Segmentos'], ['comunidad', 'Comunidad ODB'], ['ctacte', 'Cuentas corrientes'], ['reactivacion', 'Reactivación'], ['difusiones', 'Difusiones WhatsApp']] as const;
const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function ClientesWorkspace({ resumen, segmentos, ticketGeneral, cuentas }: {
  resumen: any; segmentos: any[]; ticketGeneral: number; cuentas: any[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState('todos');
  const [lista, setLista] = useState<any>(null);
  const [filtro, setFiltro] = useState('');
  const [buscar, setBuscar] = useState('');
  const [reactiv, setReactiv] = useState<any>(null);
  const cargarLista = (extra = '') => fetch(`/api/clientes?recurso=lista${extra}`).then((r) => r.json()).then(setLista);

  useEffect(() => {
    if ((tab === 'todos' || tab === 'comunidad') && lista === null) cargarLista(tab === 'comunidad' ? '&filtro=comunidad' : '');
    if (tab === 'reactivacion' && reactiv === null) fetch('/api/clientes?recurso=reactivacion&dias=60').then((r) => r.json()).then(setReactiv);
  }, [tab]);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[['Clientes', resumen?.total ?? 0], ['Comunidad ODB', resumen?.comunidad ?? 0], ['Con cuenta cte.', resumen?.conCtaCte ?? 0], ['Opt-in WhatsApp', resumen?.optInMarketing ?? 0], ['Cumplen este mes', resumen?.cumpleMes ?? 0], ['Ticket prom.', pesos(ticketGeneral)]].map(([l, v]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]"><p className="text-lg font-semibold text-black leading-none">{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>)}
      </div>

      {/* TODOS / COMUNIDAD */}
      {(tab === 'todos' || tab === 'comunidad') && (
        <div className="space-y-3">
          {tab === 'todos' && (
            <form onSubmit={(e) => { e.preventDefault(); setLista(null); cargarLista(`${filtro ? `&filtro=${filtro}` : ''}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`); }} className="flex gap-2 flex-wrap">
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="DNI o nombre…" className="flex-1 min-w-48 rounded-full border border-[#B82D25] bg-white px-4 py-2 text-sm text-black outline-none" />
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black">
                <option value="">Todos</option><option value="comunidad">Comunidad</option><option value="marketing">Con opt-in</option>
              </select>
              <button className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2 hover:bg-[#932A1F]">Filtrar</button>
            </form>
          )}
          <ClienteTabla lista={lista} router={router} />
        </div>
      )}

      {/* SEGMENTOS */}
      {tab === 'segmentos' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {segmentos.map((s) => (
            <div key={s.segmento} className="rounded-xl bg-white p-4 border border-black/[0.04]">
              <p className="text-sm font-medium text-black">{s.etiqueta}</p>
              <p className="text-2xl font-semibold text-black mt-1">{s.clientes}</p>
              <p className="text-[11px] text-black/45">clientes</p>
              <p className="text-xs text-black/60 mt-2">ticket {s.ticketPromedio ? pesos(s.ticketPromedio) : '—'}</p>
            </div>
          ))}
        </div>
      )}

      {/* CUENTAS CORRIENTES */}
      {tab === 'ctacte' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Clientes con cuenta corriente ({cuentas.length})</h2>
          {cuentas.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Sin movimientos de cuenta corriente.</p> : cuentas.map((c) => (
            <Link key={c.cliente?.id} href={`/facturacion/cuentas/${c.cliente?.id}`} className="px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between hover:bg-[#F0EBE2]/40">
              <div className="text-sm text-black"><p className="font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p><p className="text-xs text-black/45">{c.cliente?.dni}</p></div>
              <p className={`font-semibold ${c.saldo > 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>{c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}</p>
            </Link>
          ))}
        </section>
      )}

      {/* REACTIVACIÓN */}
      {tab === 'reactivacion' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Sin comprar hace +60 días</h2>
            {!reactiv ? <p className="px-4 py-6 text-center text-black/40 text-sm">Cargando…</p> : (reactiv.reactivar ?? []).length === 0 ? <p className="px-4 py-6 text-sm text-black/50">Todos compraron hace poco.</p> : (reactiv.reactivar ?? []).slice(0, 30).map((c: any) => (
              <div key={c.id} className="px-4 py-2.5 border-b border-black/5 last:border-0 flex justify-between text-sm">
                <span className="text-black">{c.nombre ?? `DNI ${c.dni}`} <span className="text-xs text-black/40">{c.acepta_marketing ? '· opt-in ✓' : ''}</span></span>
                <span className="text-xs text-black/50">última: {fecha(c.ultimaCompra)}</span>
              </div>
            ))}
          </section>
          <section className="rounded-xl bg-white overflow-hidden h-fit">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">🎂 Cumpleaños del mes</h2>
            {!reactiv ? <p className="px-4 py-6 text-center text-black/40 text-sm">Cargando…</p> : (reactiv.cumple ?? []).length === 0 ? <p className="px-4 py-6 text-sm text-black/50">Sin cumpleaños cargados este mes.</p> : (reactiv.cumple ?? []).map((c: any) => (
              <div key={c.id} className="px-4 py-2.5 border-b border-black/5 last:border-0 flex justify-between text-sm">
                <span className="text-black">{c.nombre ?? `DNI ${c.dni}`}</span>
                <span className="text-xs text-black/50">{fecha(c.fecha_nacimiento)}</span>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* DIFUSIONES */}
      {tab === 'difusiones' && <Difusiones segmentos={segmentos} />}
    </div>
  );
}

function ClienteTabla({ lista, router }: any) {
  const toggleOptIn = async (c: any) => {
    await fetch('/api/cliente-editar', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, aceptaMarketing: !c.acepta_marketing }) });
    router.refresh();
    window.location.reload();
  };
  if (!lista) return <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">Cargando…</p>;
  return (
    <section className="rounded-xl bg-white overflow-hidden">
      <table className="w-full text-sm text-black">
        <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
          <th className="px-4 py-2 font-medium">Cliente</th><th className="px-4 py-2 font-medium">Categoría</th><th className="px-4 py-2 font-medium text-right">Compras</th><th className="px-4 py-2 font-medium text-right">Total</th><th className="px-4 py-2 font-medium text-center">WhatsApp</th><th className="px-4 py-2" />
        </tr></thead>
        <tbody>
          {(lista.items ?? []).map((c: any) => (
            <tr key={c.id} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{c.nombre ?? `DNI ${c.dni}`}</p><p className="text-xs text-black/50">{c.dni}{c.verificado && ' · ✓ Comunidad'}</p></td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TIPO_ESTILO[c.tipo] ?? ''}`}>{c.tipo}</span></td>
              <td className="px-4 py-3 text-right">{c.compras}</td>
              <td className="px-4 py-3 text-right font-medium">{pesos(c.totalGastado)}</td>
              <td className="px-4 py-3 text-center">
                <button onClick={() => toggleOptIn(c)} title={c.telefono ?? 'sin teléfono'} className={`text-xs rounded-full px-2.5 py-1 font-medium ${c.acepta_marketing ? 'bg-emerald-50 text-emerald-700' : 'bg-black/5 text-black/50'}`}>
                  {c.acepta_marketing ? 'opt-in ✓' : 'sin opt-in'}
                </button>
              </td>
              <td className="px-4 py-3 text-right"><ConfigCliente cliente={c} /></td>
            </tr>
          ))}
          {(lista.items ?? []).length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-black/40 text-sm">Sin clientes con ese filtro.</td></tr>}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-black/40">{lista.total ?? 0} clientes</p>
    </section>
  );
}

function Difusiones({ segmentos }: { segmentos: any[] }) {
  const [segmento, setSegmento] = useState('');
  const [soloComunidad, setSoloComunidad] = useState(false);
  const [aud, setAud] = useState<any>(null);
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('Respondé BAJA para no recibir más mensajes.');
  const [contexto, setContexto] = useState('');
  const [hist, setHist] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [gen, setGen] = useState(false);

  const cargarAud = () => fetch(`/api/difusiones?recurso=audiencia&segmento=${segmento}&soloComunidad=${soloComunidad}`).then((r) => r.json()).then(setAud);
  useEffect(() => { cargarAud(); }, [segmento, soloComunidad]);
  useEffect(() => { fetch('/api/difusiones?recurso=listar').then((r) => r.json()).then((d) => setHist(Array.isArray(d) ? d : [])); }, []);

  const redactar = async () => {
    setGen(true);
    try { const r = await fetch('/api/difusiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'redactar', contexto }) }); const d = await r.json(); if (d.mensaje) setMensaje(d.mensaje); }
    finally { setGen(false); }
  };
  const crear = async () => {
    setAviso('');
    const r = await fetch('/api/difusiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'crear', titulo, mensaje, segmento: segmento || undefined, soloComunidad }) });
    const d = await r.json();
    setAviso(d.aviso ?? d.message ?? 'Listo');
    if (r.ok) { setTitulo(''); fetch('/api/difusiones?recurso=listar').then((x) => x.json()).then((h) => setHist(Array.isArray(h) ? h : [])); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#F0EBE2]/70 p-3 text-xs text-black/70 leading-relaxed">
        🛡️ <strong>Difusión responsable:</strong> solo se envía a clientes que dieron <strong>opt-in</strong> y tienen teléfono, vía la API oficial de WhatsApp Business con plantilla aprobada y opción de baja. Así no te penaliza Meta.
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* armar difusión */}
        <section className="rounded-xl bg-white p-5 space-y-3">
          <h2 className="font-medium text-black text-sm">Nueva difusión</h2>
          <div className="grid grid-cols-2 gap-2">
            <select value={segmento} onChange={(e) => setSegmento(e.target.value)} className={input + ' bg-white'}>
              <option value="">Todos los opt-in</option>
              {segmentos.map((s) => <option key={s.segmento} value={s.segmento}>{s.etiqueta}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-black px-1"><input type="checkbox" checked={soloComunidad} onChange={(e) => setSoloComunidad(e.target.checked)} className="accent-[#B82D25]" /> Solo Comunidad</label>
          </div>

          {aud && (
            <div className="rounded-lg bg-[#F0EBE2]/60 p-3 text-xs">
              <p className="text-black"><strong className="text-base">{aud.elegibles}</strong> clientes elegibles (opt-in + teléfono)</p>
              {aud.noContactables > 0 && <p className="text-black/50 mt-0.5">{aud.noContactables} con teléfono pero sin opt-in — no se les envía.</p>}
            </div>
          )}

          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título interno (ej: Finde largo)" className={input} />
          <div className="flex gap-2">
            <input value={contexto} onChange={(e) => setContexto(e.target.value)} placeholder="Contexto para redactar con IA…" className={input} />
            <button onClick={redactar} disabled={gen} className="rounded-full bg-black text-white text-xs font-medium px-3 hover:bg-black/80 disabled:opacity-50 whitespace-nowrap">{gen ? '…' : '✨ Redactar'}</button>
          </div>
          <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={5} className={input} />
          {aviso && <p className="text-xs text-[#932A1F]">{aviso}</p>}
          <button onClick={crear} disabled={!aud?.elegibles} className="w-full rounded-full bg-[#B82D25] text-white text-sm font-medium py-2.5 hover:bg-[#932A1F] disabled:opacity-50">
            {aud?.configurado ? `Enviar a ${aud?.elegibles ?? 0} clientes` : `Guardar difusión (${aud?.elegibles ?? 0} elegibles)`}
          </button>
        </section>

        {/* historial */}
        <section className="rounded-xl bg-white overflow-hidden h-fit">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Difusiones anteriores</h2>
          {hist.length === 0 ? <p className="px-4 py-6 text-sm text-black/50">Todavía no enviaste difusiones.</p> : hist.map((d) => (
            <div key={d.id} className="px-4 py-3 border-b border-black/5 last:border-0">
              <div className="flex justify-between"><p className="font-medium text-black text-sm">{d.titulo}</p>
                <span className={`text-[11px] rounded-full px-2 py-0.5 ${d.estado === 'enviada' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{d.estado}</span></div>
              <p className="text-xs text-black/50 mt-0.5">{d.audiencia} destinatarios · {fecha(d.creado_en)}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');
const EST: Record<string, string> = { armado: 'bg-[#F0EBE2] text-black/60', en_calle: 'bg-black text-white', rendido: 'bg-emerald-100 text-emerald-800' };
const ESTL: Record<string, string> = { armado: 'armado', en_calle: 'en la calle', rendido: 'rendido' };
const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm';

function FlotaMapa() {
  const [flota, setFlota] = useState<any>({ central: null, repartidores: [] });
  const mapRef = useRef<any>(null);
  const markers = useRef<Record<string, any>>({});

  useEffect(() => {
    let cancel = false;
    const ensure = () => new Promise<any>((res) => {
      const w = window as any;
      if (w.L) return res(w.L);
      if (!document.getElementById('leaflet-css')) { const l = document.createElement('link'); l.id = 'leaflet-css'; l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l); }
      let s = document.getElementById('leaflet-js') as HTMLScriptElement | null;
      if (!s) { s = document.createElement('script'); s.id = 'leaflet-js'; s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => res(w.L); document.body.appendChild(s); }
      else s.addEventListener('load', () => res(w.L));
    });
    const refrescar = async (L: any) => {
      const r = await fetch('/api/repartos?recurso=flota', { cache: 'no-store' });
      if (!r.ok || cancel) return;
      const d = await r.json(); if (cancel) return; setFlota(d);
      const map = mapRef.current; if (!map) return;
      if (d.central?.lat && !markers.current.__c) {
        markers.current.__c = L.circleMarker([d.central.lat, d.central.lng], { radius: 9, color: '#111', fillColor: '#111', fillOpacity: 1 }).addTo(map).bindPopup('🏪 ' + (d.central.nombre || 'Central'));
        map.setView([d.central.lat, d.central.lng], 13);
      }
      const pts: any[] = [];
      for (const rp of d.repartidores ?? []) {
        if (rp.lat == null) continue;
        const col = rp.activo ? '#16a34a' : '#9ca3af';
        if (markers.current[rp.id]) markers.current[rp.id].setLatLng([rp.lat, rp.lng]).setStyle({ color: col, fillColor: col });
        else markers.current[rp.id] = L.circleMarker([rp.lat, rp.lng], { radius: 8, color: col, fillColor: col, fillOpacity: 0.9 }).addTo(map);
        markers.current[rp.id].bindPopup(`🛵 ${rp.nombre}${rp.reparto ? ` · ruta #${rp.reparto.numero}` : ''} · hace ${rp.hace_min}′`);
        pts.push([rp.lat, rp.lng]);
      }
      if (pts.length) try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 }); } catch {}
    };
    (async () => {
      const L = await ensure(); if (cancel) return;
      if (!mapRef.current) {
        mapRef.current = L.map('flota-map').setView([-34.857, -58.503], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapRef.current);
      }
      await refrescar(L);
      (mapRef.current as any).__t = setInterval(() => refrescar(L), 10000);
    })();
    return () => { cancel = true; if (mapRef.current) { clearInterval((mapRef.current as any).__t); mapRef.current.remove(); mapRef.current = null; } markers.current = {}; };
  }, []);

  const reps = flota.repartidores ?? [];
  return (
    <section className="rounded-xl bg-white overflow-hidden">
      <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Flota en vivo</h2>
      <div className="grid md:grid-cols-[1fr_240px]">
        <div id="flota-map" style={{ height: 380, zIndex: 0 }} className="bg-[#F0EBE2]" />
        <div className="border-l border-black/5 max-h-[380px] overflow-y-auto">
          {reps.length === 0 ? <p className="p-4 text-sm text-black/40">Ningún repartidor reportando posición. Aparecen acá cuando salen a la calle con la app.</p> : reps.map((rp: any) => (
            <div key={rp.id} className="px-4 py-3 border-b border-black/5 flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${rp.activo ? 'bg-emerald-500' : 'bg-black/25'}`} />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-black truncate">{rp.nombre}</p><p className="text-[11px] text-black/45">{rp.reparto ? `Ruta #${rp.reparto.numero}${rp.reparto.zona ? ' · ' + rp.reparto.zona : ''}` : 'sin ruta'} · hace {rp.hace_min}′</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RepartoWorkspace({ repartos, choferes }: { repartos: any[]; choferes: any[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<any>(null);
  const [det, setDet] = useState<any>(null);
  const [aviso, setAviso] = useState('');

  const post = async (body: any) => {
    setAviso('');
    const r = await fetch('/api/repartos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setAviso(d.message ?? 'Error'); return null; }
    router.refresh();
    return d;
  };
  const abrir = async (id: string) => { const r = await fetch(`/api/repartos?recurso=detalle&id=${id}`); if (r.ok) setDet(await r.json()); };
  const refrescarDet = async () => { if (det) { const r = await fetch(`/api/repartos?recurso=detalle&id=${det.id}`); if (r.ok) setDet(await r.json()); } router.refresh(); };

  const hoy = new Date().toISOString().slice(0, 10);
  const kpis = [
    ['Rutas (7 días)', repartos.length],
    ['En la calle', repartos.filter((r) => r.estado === 'en_calle').length, 'text-black'],
    ['A rendir', repartos.filter((r) => r.estado === 'en_calle').length],
    ['Cobrado hoy', pesos(repartos.filter((r) => r.fecha === hoy).reduce((s, r) => s + Number(r.cobrado || 0), 0)), 'text-emerald-700'],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-7 flex-wrap">{kpis.map(([l, v, c]: any) => <div key={l}><p className={`text-xl font-semibold leading-none ${c || 'text-black'}`}>{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>)}</div>
        <button onClick={() => setModal({ tipo: 'nueva' })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F]">+ Nueva hoja de ruta</button>
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      <FlotaMapa />

      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Hojas de ruta</h2>
        {repartos.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Sin hojas de ruta. Creá la primera.</p> : (
          <div className="divide-y divide-black/5">
            {repartos.map((r) => (
              <button key={r.id} onClick={() => abrir(r.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F0EBE2]/40">
                <div>
                  <p className="font-medium text-black text-sm">Ruta #{r.numero}{r.zona ? ` · ${r.zona}` : ''} <span className={`ml-1 text-[10px] rounded-full px-2 py-0.5 ${EST[r.estado] ?? ''}`}>{ESTL[r.estado] ?? r.estado}</span></p>
                  <p className="text-xs text-black/45">{fecha(r.fecha)} · {r.chofer?.nombre ?? 'sin chofer'} · {r.entregadas}/{r.totalParadas} entregadas</p>
                </div>
                <div className="text-right"><p className="font-semibold text-sm">{pesos(r.cobrado)}</p><p className="text-[11px] text-black/40">de {pesos(r.estimado)}</p></div>
              </button>
            ))}
          </div>
        )}
      </section>

      {modal?.tipo === 'nueva' && <NuevaRuta choferes={choferes} cerrar={() => setModal(null)} post={post} aviso={aviso} />}
      {det && <Detalle det={det} cerrar={() => setDet(null)} post={post} refrescar={refrescarDet} aviso={aviso} />}
    </div>
  );
}

function NuevaRuta({ choferes, cerrar, post, aviso }: any) {
  const [f, setF] = useState<any>({ fecha: new Date().toISOString().slice(0, 10) });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-[1000]">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 shadow-2xl">
        <h2 className="font-semibold text-black text-lg">Nueva hoja de ruta</h2>
        <input type="date" className={input} value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
        <select className={input + ' bg-white'} value={f.choferId ?? ''} onChange={(e) => set('choferId', e.target.value)}>
          <option value="">Chofer…</option>{choferes.map((c: any) => <option key={c.id} value={c.id}>{c.nombre} ({c.rol})</option>)}
        </select>
        <input className={input} placeholder="Zona / ruta (ej. Canning Norte)" value={f.zona ?? ''} onChange={(e) => set('zona', e.target.value)} />
        {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={cerrar} className="text-sm text-black/60 px-4 py-2">Cancelar</button>
          <button onClick={async () => { const d = await post({ accion: 'crear', fecha: f.fecha, choferId: f.choferId, zona: f.zona }); if (d) cerrar(); }} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5">Crear ruta</button>
        </div>
      </div>
    </div>
  );
}

function Detalle({ det, cerrar, post, refrescar, aviso }: any) {
  const [busca, setBusca] = useState(''); const [sug, setSug] = useState<any[]>([]);
  const [zona, setZona] = useState('');
  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => { const r = await fetch(`/api/envases?recurso=buscarCliente&q=${encodeURIComponent(busca)}`); if (r.ok) setSug((await r.json()).slice(0, 6)); }, 250);
    return () => clearTimeout(t);
  }, [busca]);
  const t = det.totales ?? {};
  const accion = async (b: any) => { await post(b); await refrescar(); };
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-[1000]" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-xl p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-black text-lg">Ruta #{det.numero} {det.zona ? `· ${det.zona}` : ''}</h2>
          <span className={`text-[11px] rounded-full px-2 py-0.5 ${EST[det.estado] ?? ''}`}>{ESTL[det.estado] ?? det.estado}</span>
        </div>
        <p className="text-xs text-black/50">{det.chofer?.nombre ?? 'sin chofer'} · {t.entregadas}/{(det.paradas ?? []).length} entregadas · cobrado {pesos(t.cobrado)} de {pesos(t.estimado)}{t.efectivo ? ` · efectivo ${pesos(t.efectivo)}` : ''}</p>

        {det.estado !== 'rendido' && (
          <div className="flex gap-2 flex-wrap">
            {det.estado === 'armado' && <button onClick={() => accion({ accion: 'estado', id: det.id, estado: 'en_calle' })} className="rounded-full bg-black text-white text-xs font-medium px-4 py-1.5">Salir a la calle</button>}
            {det.estado === 'en_calle' && <button onClick={() => accion({ accion: 'estado', id: det.id, estado: 'rendido' })} className="rounded-full bg-emerald-600 text-white text-xs font-medium px-4 py-1.5">Cerrar y rendir</button>}
          </div>
        )}

        {/* agregar paradas (armado) */}
        {det.estado === 'armado' && (
          <div className="rounded-lg border border-black/10 p-3 space-y-2">
            <div className="flex gap-2">
              <input className={input} placeholder="Traer clientes de una zona…" value={zona} onChange={(e) => setZona(e.target.value)} />
              <button onClick={() => accion({ accion: 'traerZona', id: det.id, zona })} disabled={!zona.trim()} className="rounded-lg bg-black text-white text-xs px-3 disabled:opacity-40 whitespace-nowrap">Traer zona</button>
            </div>
            <div className="relative">
              <input className={input} placeholder="…o agregar un cliente puntual" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {sug.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-44 overflow-y-auto">
                {sug.map((c: any) => <button key={c.id} onClick={async () => { setBusca(''); setSug([]); await accion({ accion: 'parada', id: det.id, clienteId: c.id, clienteNombre: c.nombre ?? c.razon_social ?? c.dni }); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">{c.nombre ?? c.razon_social ?? c.dni}</button>)}
              </div>}
            </div>
          </div>
        )}

        <div className="divide-y divide-black/5">
          {(det.paradas ?? []).map((p: any) => (
            <ParadaRow key={p.id} p={p} accion={accion} editable={det.estado === 'en_calle'} />
          ))}
          {(det.paradas ?? []).length === 0 && <p className="py-6 text-center text-black/40 text-sm">Sin paradas. Agregá clientes arriba.</p>}
        </div>
        {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
        <button onClick={cerrar} className="w-full rounded-full bg-[#F0EBE2] text-black/70 text-sm font-medium py-2.5 mt-1">Cerrar</button>
      </div>
    </div>
  );
}

function ParadaRow({ p, accion, editable }: any) {
  const [cobrado, setCobrado] = useState<string>(String(p.cobrado || p.monto || ''));
  const [medio, setMedio] = useState(p.medio_pago || 'efectivo');
  const nombre = p.cliente?.nombre ?? p.cliente?.razon_social ?? p.cliente_nombre ?? p.cliente?.dni ?? 'Cliente';
  const col = p.estado === 'entregado' ? 'text-emerald-700' : ['no_estaba', 'rechazado'].includes(p.estado) ? 'text-black/40' : 'text-black';
  return (
    <div className="py-2.5 flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-[120px]"><p className={`text-sm font-medium ${col}`}>{nombre}</p><p className="text-[11px] text-black/40">{p.cliente?.domicilio ?? ''} {p.estado !== 'pendiente' ? `· ${p.estado}` : ''}</p></div>
      {editable && p.estado === 'pendiente' ? (<>
        <input type="number" value={cobrado} onChange={(e) => setCobrado(e.target.value)} placeholder="$ cobrado" className="w-24 rounded border border-black/15 px-2 py-1 text-right text-sm" />
        <select value={medio} onChange={(e) => setMedio(e.target.value)} className="rounded border border-black/15 px-1.5 py-1 text-xs"><option value="efectivo">efvo</option><option value="transferencia">transf</option><option value="tarjeta">tarj</option></select>
        <button onClick={() => accion({ accion: 'marcar', pid: p.id, estado: 'entregado', cobrado: Number(cobrado) || 0, medioPago: medio })} className="rounded-full bg-emerald-600 text-white text-xs px-3 py-1">Entregado</button>
        <button onClick={() => accion({ accion: 'marcar', pid: p.id, estado: 'no_estaba' })} className="rounded-full bg-[#F0EBE2] text-black/60 text-xs px-3 py-1">No estaba</button>
      </>) : (
        <span className="text-sm font-medium">{pesos(p.cobrado || p.monto)}</span>
      )}
    </div>
  );
}

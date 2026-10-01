'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Aviso,
  Boton,
  Campo,
  Entrada,
  Etiqueta,
  FOCO_ADENTRO,
  Kpi,
  Modal,
  Monto,
  Selector,
  Tarjeta,
  TarjetaCabecera,
  unir,
  type TonoEtiqueta,
} from './kit';
import { fecha as formatoFecha, pesos as formatoPesos } from '../lib/formato';

// Las copias viejas hacían Number(n) || 0: "no hay dato" se veía $0.
const pesos = (n: any) => formatoPesos(n || 0);
const fecha = (iso: string) => formatoFecha(iso, 'corta');
const EST: Record<string, TonoEtiqueta> = { armado: 'neutro', en_calle: 'info', rendido: 'ok' };
const ESTL: Record<string, string> = { armado: 'armado', en_calle: 'en la calle', rendido: 'rendido' };

// Sugerencias de un buscador, en el flujo (dentro de un modal, una lista
// absoluta quedaba cortada por el scroll del cuerpo).
const LISTA_SUGERENCIAS = 'mt-1 max-h-44 overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante';
const SUGERENCIA =
  'block min-h-11 w-full border-b border-black/[0.06] px-3.5 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none';

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
    <Tarjeta relleno={false} className="overflow-hidden">
      <TarjetaCabecera
        titulo={
          <span className="flex items-center gap-2">
            <span className="inline-block size-2 shrink-0 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden="true" /> Flota en vivo
          </span>
        }
      />
      <div className="grid md:grid-cols-[minmax(0,1fr)_15rem]">
        <div id="flota-map" style={{ height: 380, zIndex: 0 }} className="min-w-0 bg-crema" />
        <div className="max-h-[380px] overflow-y-auto border-t border-black/[0.06] md:border-l md:border-t-0">
          {reps.length === 0 ? <p className="p-4 text-sm text-tinta/60">Ningún repartidor reportando posición. Aparecen acá cuando salen a la calle con la app.</p> : reps.map((rp: any) => (
            <div key={rp.id} className="flex items-center gap-2.5 border-b border-black/[0.06] px-4 py-3 last:border-0">
              <span className={`size-2.5 shrink-0 rounded-full ${rp.activo ? 'bg-ok' : 'bg-tinta/25'}`} />
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-tinta">{rp.nombre}</p><p className="text-xs text-tinta/60">{rp.reparto ? `Ruta #${rp.reparto.numero}${rp.reparto.zona ? ' · ' + rp.reparto.zona : ''}` : 'sin ruta'} · hace {rp.hace_min}′</p></div>
            </div>
          ))}
        </div>
      </div>
    </Tarjeta>
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
  const kpis: [string, any, ('neutro' | 'ok')?][] = [
    ['Rutas (7 días)', repartos.length],
    ['En la calle', repartos.filter((r) => r.estado === 'en_calle').length],
    ['A rendir', repartos.filter((r) => r.estado === 'en_calle').length],
    ['Cobrado hoy', pesos(repartos.filter((r) => r.fecha === hoy).reduce((s, r) => s + Number(r.cobrado || 0), 0)), 'ok'],
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex sm:justify-end">
        <Boton onClick={() => setModal({ tipo: 'nueva' })} className="w-full sm:w-auto">+ Nueva hoja de ruta</Boton>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([l, v, tono]) => <Kpi key={l} etiqueta={l} valor={v} tono={tono} />)}
      </div>

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      <FlotaMapa />

      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo="Hojas de ruta" />
        {repartos.length === 0 ? <p className="px-4 py-8 text-center text-sm text-tinta/60">Sin hojas de ruta. Creá la primera.</p> : (
          <div className="divide-y divide-black/[0.06]">
            {repartos.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => abrir(r.id)}
                className={unir('flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-tinta">
                    <span className="min-w-0 break-words">Ruta #{r.numero}{r.zona ? ` · ${r.zona}` : ''}</span>
                    <Etiqueta tono={EST[r.estado] ?? 'neutro'}>{ESTL[r.estado] ?? r.estado}</Etiqueta>
                  </p>
                  <p className="mt-0.5 break-words text-xs text-tinta/60">{fecha(r.fecha)} · {r.chofer?.nombre ?? 'sin chofer'} · {r.entregadas}/{r.totalParadas} entregadas</p>
                </div>
                <div className="shrink-0 text-right"><p className="importe text-sm font-semibold text-tinta">{pesos(r.cobrado)}</p><p className="importe text-xs text-tinta/60">de {pesos(r.estimado)}</p></div>
              </button>
            ))}
          </div>
        )}
      </Tarjeta>

      {modal?.tipo === 'nueva' && <NuevaRuta choferes={choferes} cerrar={() => setModal(null)} post={post} aviso={aviso} />}
      {det && <Detalle det={det} cerrar={() => setDet(null)} post={post} refrescar={refrescarDet} aviso={aviso} />}
    </div>
  );
}

function NuevaRuta({ choferes, cerrar, post, aviso }: any) {
  const [f, setF] = useState<any>({ fecha: new Date().toISOString().slice(0, 10) });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal
      abierto
      onCerrar={cerrar}
      cerrarAlTocarAfuera={false}
      titulo="Nueva hoja de ruta"
      ancho="chico"
      pie={
        <>
          <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
          <Boton onClick={async () => { const d = await post({ accion: 'crear', fecha: f.fecha, choferId: f.choferId, zona: f.zona }); if (d) cerrar(); }}>Crear ruta</Boton>
        </>
      }
    >
      <div className="space-y-3">
        <Campo etiqueta="Fecha">
          <Entrada type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
        </Campo>
        <Campo etiqueta="Chofer">
          <Selector value={f.choferId ?? ''} onChange={(e) => set('choferId', e.target.value)}>
            <option value="">Chofer…</option>{choferes.map((c: any) => <option key={c.id} value={c.id}>{c.nombre} ({c.rol})</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Zona">
          <Entrada placeholder="Zona / ruta (ej. Canning Norte)" value={f.zona ?? ''} onChange={(e) => set('zona', e.target.value)} />
        </Campo>
        {aviso && <Aviso tono="error">{aviso}</Aviso>}
      </div>
    </Modal>
  );
}

function Detalle({ det, cerrar, post, refrescar, aviso }: any) {
  const [busca, setBusca] = useState(''); const [sug, setSug] = useState<any[]>([]);
  const [zona, setZona] = useState('');
  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar?q=${encodeURIComponent(busca)}`); if (r.ok) setSug(((await r.json()).clientes ?? []).slice(0, 6)); }, 250);
    return () => clearTimeout(t);
  }, [busca]);
  const t = det.totales ?? {};
  const accion = async (b: any) => { await post(b); await refrescar(); };
  return (
    <Modal
      abierto
      onCerrar={cerrar}
      titulo={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words">Ruta #{det.numero} {det.zona ? `· ${det.zona}` : ''}</span>
          <Etiqueta tono={EST[det.estado] ?? 'neutro'}>{ESTL[det.estado] ?? det.estado}</Etiqueta>
        </span>
      }
      descripcion={`${det.chofer?.nombre ?? 'sin chofer'} · ${t.entregadas}/${(det.paradas ?? []).length} entregadas · cobrado ${pesos(t.cobrado)} de ${pesos(t.estimado)}${t.efectivo ? ` · efectivo ${pesos(t.efectivo)}` : ''}`}
      pie={<Boton variante="secundario" onClick={cerrar}>Cerrar</Boton>}
    >
      <div className="space-y-3">
        {det.estado !== 'rendido' && (
          <div className="flex flex-wrap gap-2">
            {det.estado === 'armado' && <Boton tamano="chico" onClick={() => accion({ accion: 'estado', id: det.id, estado: 'en_calle' })}>Salir a la calle</Boton>}
            {det.estado === 'en_calle' && <Boton variante="ok" tamano="chico" onClick={() => accion({ accion: 'estado', id: det.id, estado: 'rendido' })}>Cerrar y rendir</Boton>}
          </div>
        )}

        {/* agregar paradas (armado) */}
        {det.estado === 'armado' && (
          <div className="space-y-2 rounded-xl border border-black/[0.06] bg-crema-claro/60 p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Entrada placeholder="Traer clientes de una zona…" aria-label="Traer clientes de una zona" value={zona} onChange={(e) => setZona(e.target.value)} className="sm:flex-1" />
              <Boton variante="secundario" onClick={() => accion({ accion: 'traerZona', id: det.id, zona })} disabled={!zona.trim()} className="shrink-0">Traer zona</Boton>
            </div>
            <div>
              <Entrada placeholder="…o agregar un cliente puntual" aria-label="Agregar un cliente puntual" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {sug.length > 0 && <div className={LISTA_SUGERENCIAS}>
                {sug.map((c: any) => <button key={c.id} type="button" onClick={async () => { setBusca(''); setSug([]); await accion({ accion: 'parada', id: det.id, clienteId: c.id, clienteNombre: c.nombre ?? c.razon_social ?? c.dni }); }} className={SUGERENCIA}>{c.nombre ?? c.razon_social ?? c.dni}</button>)}
              </div>}
            </div>
          </div>
        )}

        <div className="divide-y divide-black/[0.06]">
          {(det.paradas ?? []).map((p: any) => (
            <ParadaRow key={p.id} p={p} accion={accion} editable={det.estado === 'en_calle'} />
          ))}
          {(det.paradas ?? []).length === 0 && <p className="py-6 text-center text-sm text-tinta/60">Sin paradas. Agregá clientes arriba.</p>}
        </div>
        {aviso && <Aviso tono="error">{aviso}</Aviso>}
      </div>
    </Modal>
  );
}

function ParadaRow({ p, accion, editable }: any) {
  const [cobrado, setCobrado] = useState<string>(String(p.cobrado || p.monto || ''));
  const [medio, setMedio] = useState(p.medio_pago || 'efectivo');
  const nombre = p.cliente?.nombre ?? p.cliente?.razon_social ?? p.cliente_nombre ?? p.cliente?.dni ?? 'Cliente';
  const col = p.estado === 'entregado' ? 'text-ok' : ['no_estaba', 'rechazado'].includes(p.estado) ? 'text-tinta/60' : 'text-tinta';
  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <div className={editable && p.estado === 'pendiente' ? 'w-full min-w-0 sm:w-auto sm:flex-1' : 'min-w-0 flex-1'}><p className={`break-words text-sm font-medium ${col}`}>{nombre}</p><p className="break-words text-xs text-tinta/60">{p.cliente?.domicilio ?? ''} {p.estado !== 'pendiente' ? `· ${p.estado}` : ''}</p></div>
      {editable && p.estado === 'pendiente' ? (<>
        <div className="w-28"><Entrada type="number" value={cobrado} onChange={(e) => setCobrado(e.target.value)} placeholder="$ cobrado" aria-label={`Cobrado a ${nombre}`} className="text-right" /></div>
        <Selector value={medio} onChange={(e) => setMedio(e.target.value)} aria-label="Medio de pago" className="w-28"><option value="efectivo">efvo</option><option value="transferencia">transf</option><option value="tarjeta">tarj</option></Selector>
        <Boton tamano="chico" onClick={() => accion({ accion: 'marcar', pid: p.id, estado: 'entregado', cobrado: Number(cobrado) || 0, medioPago: medio })}>Entregado</Boton>
        <Boton variante="secundario" tamano="chico" onClick={() => accion({ accion: 'marcar', pid: p.id, estado: 'no_estaba' })}>No estaba</Boton>
      </>) : (
        <Monto valor={p.cobrado || p.monto || 0} className="shrink-0 text-sm font-medium text-tinta" />
      )}
    </div>
  );
}

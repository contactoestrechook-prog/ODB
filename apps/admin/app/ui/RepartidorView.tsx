'use client';

import { useEffect, useRef, useState } from 'react';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export function RepartidorView() {
  const [entregas, setEntregas] = useState<any[]>([]);
  const [compartiendo, setCompartiendo] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const enCamino = useRef<string[]>([]);

  const cargar = async () => {
    const r = await fetch('/api/repartidor/mis-entregas');
    if (r.ok) { const d = await r.json(); setEntregas(d); enCamino.current = d.filter((e: any) => e.estado === 'en_camino').map((e: any) => e.id); }
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 10000); return () => clearInterval(t); }, []);

  const toggleCompartir = () => {
    if (compartiendo) {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null; setCompartiendo(false); return;
    }
    if (!navigator.geolocation) { setError('Tu navegador no soporta geolocalización.'); return; }
    setError(null);
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const c = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(c);
        // mapa de flota en vivo (a nivel repartidor, haya o no pedido activo)
        fetch('/api/repartos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'posicion', lat: c.lat, lng: c.lng }) }).catch(() => {});
        for (const id of enCamino.current) {
          fetch(`/api/repartidor/pedidos/${id}/ubicacion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).catch(() => {});
        }
      },
      () => setError('No pudimos acceder a tu ubicación.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setCompartiendo(true);
  };

  const avanzar = async (id: string, estado: string) => {
    await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId: id, estado }) });
    cargar();
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className={`rounded-xl p-4 ${compartiendo ? 'bg-green-600 text-white' : 'bg-white'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${compartiendo ? 'text-white' : 'text-black'}`}>{compartiendo ? 'Compartiendo tu ubicación' : 'Compartir mi ubicación'}</p>
            <p className={`text-xs ${compartiendo ? 'text-white/80' : 'text-black/50'}`}>{compartiendo ? (pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'Obteniendo señal…') : 'Activalo cuando salgas a repartir'}</p>
          </div>
          <button onClick={toggleCompartir} className={`rounded-full text-sm font-medium px-4 py-2 ${compartiendo ? 'bg-white text-green-700' : 'bg-[#B82D25] text-white hover:bg-[#932A1F]'}`}>{compartiendo ? 'Detener' : 'Compartir'}</button>
        </div>
      </div>
      {error && <p className="text-sm text-[#932A1F]">{error}</p>}

      {entregas.length === 0 ? (
        <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">No tenés entregas asignadas.</p>
      ) : entregas.map((e) => (
        <div key={e.id} className="rounded-xl bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-black">{e.cliente?.nombre ?? 'Cliente'} <span className="text-black/40 font-normal">· {pesos(e.total)}</span></p>
              <p className="text-xs text-black/55 mt-0.5">{e.destino_direccion ?? 'Sin dirección'}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${e.estado === 'en_camino' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>{e.estado === 'en_camino' ? 'En camino' : 'Listo'}</span>
          </div>
          <div className="flex gap-2 mt-3">
            {e.estado === 'listo' && <button onClick={() => avanzar(e.id, 'en_camino')} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">Salí a entregar</button>}
            {e.estado === 'en_camino' && <button onClick={() => avanzar(e.id, 'entregado')} className="rounded-full bg-black text-white text-sm font-medium px-4 py-2 hover:bg-black/80">Marcar entregado</button>}
            {e.destino_direccion && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.destino_direccion)}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-black/15 text-black text-sm font-medium px-4 py-2 hover:bg-black/[0.03]">Ver en mapa</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

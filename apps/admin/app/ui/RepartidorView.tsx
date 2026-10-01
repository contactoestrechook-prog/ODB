'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Etiqueta, Monto, Tarjeta, Vacio, clasesBoton, unir } from './kit';

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
    <div className="space-y-4">
      <div
        className={unir(
          'rounded-2xl border p-4 shadow-tarjeta sm:p-5',
          compartiendo ? 'border-ok/20 bg-ok-suave' : 'border-black/[0.06] bg-white',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${compartiendo ? 'text-ok' : 'text-tinta'}`}>{compartiendo ? 'Compartiendo tu ubicación' : 'Compartir mi ubicación'}</p>
            <p className="importe text-xs text-tinta/70">{compartiendo ? (pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'Obteniendo señal…') : 'Activalo cuando salgas a repartir'}</p>
          </div>
          <Boton variante={compartiendo ? 'secundario' : 'primario'} onClick={toggleCompartir} className="shrink-0">{compartiendo ? 'Detener' : 'Compartir'}</Boton>
        </div>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      {entregas.length === 0 ? (
        <Vacio titulo="No tenés entregas asignadas." />
      ) : entregas.map((e) => (
        <Tarjeta key={e.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-tinta">{e.cliente?.nombre ?? 'Cliente'} <span className="font-normal text-tinta/60">· <Monto valor={e.total ?? 0} /></span></p>
              <p className="mt-0.5 break-words text-xs text-tinta/70">{e.destino_direccion ?? 'Sin dirección'}</p>
              {e.notas && <p className="mt-0.5 break-words text-xs text-atencion">Indicaciones: {e.notas}</p>}
            </div>
            <Etiqueta tono={e.estado === 'en_camino' ? 'info' : 'ok'} className="shrink-0">{e.estado === 'en_camino' ? 'En camino' : 'Listo'}</Etiqueta>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {e.estado === 'listo' && <Boton onClick={() => avanzar(e.id, 'en_camino')} className="grow sm:grow-0">Salí a entregar</Boton>}
            {e.estado === 'en_camino' && <Boton onClick={() => avanzar(e.id, 'entregado')} className="grow sm:grow-0">Marcar entregado</Boton>}
            {e.destino_direccion && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.destino_direccion)}`} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante: 'secundario', className: 'grow sm:grow-0' })}>Ver en mapa</a>}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Etiqueta, Monto, Tarjeta, Vacio, unir } from './kit';
import { FaltantesAlEntregar, faltaDeStock, type FaltaDeStock } from './FaltantesAlEntregar';
import { DatosDelEnvio, ModalEntregarEnvio, PlacaDelEnvio } from './EnvioPartes';
import type { Envio } from '../lib/envios';

export function RepartidorView() {
  const [falta, setFalta] = useState<FaltaDeStock | null>(null);
  const [errorEntrega, setErrorEntrega] = useState('');
  const [entregas, setEntregas] = useState<Envio[]>([]);
  // al entregar se pregunta cómo pagó (21/10/2026: antes quedaba siempre efectivo)
  const [entregando, setEntregando] = useState<Envio | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
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

  // el medio con que se entregó, para repetirlo si antes hubo que resolver un faltante
  const medioPendiente = useRef<string | undefined>(undefined);
  const avanzar = async (id: string, estado: string, medioPago?: string) => {
    // antes el error no se mostraba: si la entrega fallaba, no pasaba nada a la vista
    setTrabajando(id);
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId: id, estado, ...(medioPago ? { medioPago } : {}) }) }).catch(() => null);
    setTrabajando(null);
    const d = r ? await r.json().catch(() => ({})) : {};
    const fs = r && !r.ok && estado === 'entregado' ? faltaDeStock(id, r.status, d) : null;
    if (fs) { medioPendiente.current = medioPago; setFalta(fs); }
    else if (!r) setErrorEntrega('Sin conexión. Probá de nuevo.');
    else if (!r.ok) setErrorEntrega(d.message ?? 'No se pudo cambiar el pedido.');
    else setErrorEntrega('');
    cargar();
  };

  return (
    <div className="space-y-4">
      {errorEntrega && <Aviso tono="error">{errorEntrega}</Aviso>}
      {falta && (
        <FaltantesAlEntregar
          falta={falta} soloSacar
          onCerrar={() => { setFalta(null); cargar(); }}
          onEntregar={async () => { const id = falta.pedidoId; setFalta(null); await avanzar(id, 'entregado', medioPendiente.current); }}
        />
      )}
      {entregando && (
        <ModalEntregarEnvio
          e={entregando}
          textoBoton="Entregado"
          trabajando={trabajando === entregando.id}
          onCerrar={() => setEntregando(null)}
          onConfirmar={async (medio) => { const e = entregando; setEntregando(null); await avanzar(e.id, 'entregado', medio); }}
        />
      )}
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
        <Vacio titulo="No tenés entregas asignadas." texto="Cuando en Envíos te elijan para llevar un pedido y esté listo, aparece acá con la dirección, el teléfono y qué cobrar." />
      ) : entregas.map((e) => (
        <Tarjeta key={e.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-base font-semibold text-tinta">{e.cliente?.nombre ?? 'Cliente'} <span className="font-normal text-tinta/60">· <Monto valor={e.total ?? 0} /></span></p>
              <p className="importe mt-0.5 text-xs text-tinta/60">{e.codigo}</p>
            </div>
            <Etiqueta tono={e.estado === 'en_camino' ? 'info' : 'ok'} className="shrink-0">{e.estado === 'en_camino' ? 'En camino' : 'Listo'}</Etiqueta>
          </div>
          {/* lo mismo que ve el local en Envíos: a dónde, a quién llamar, qué cobrar y qué lleva */}
          <div className="mt-3 space-y-3">
            <DatosDelEnvio e={e} />
            <PlacaDelEnvio e={e} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {e.estado === 'listo' && <Boton onClick={() => avanzar(e.id, 'en_camino')} cargando={trabajando === e.id} className="grow sm:grow-0">Salí a entregar</Boton>}
            {e.estado === 'en_camino' && <Boton onClick={() => setEntregando(e)} disabled={trabajando === e.id} className="grow sm:grow-0">Marcar entregado</Boton>}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Cargando, Pestanas } from './kit';
import { MantenimientoTablero } from './MantenimientoTablero';

// MANTENIMIENTO CON METOGROUP (Leandro, 26/11/2026: «agregarle también el módulo de
// mantenimiento como tiene Car Cash, con un contexto agéntico totalmente inteligente
// con clave ODB, que le tome el reclamo de lo que no hay, que le pueda responder…»).
// «Hablar con MetoGroup» es la pantalla de MetoGroup (la misma de Car Cash) en un
// marco: contar un problema o pedir una mejora, con el agente que mira el sistema y
// el manual de ODB. «Lo que hizo MetoGroup» es el tablero de siempre.

const ORIGEN = 'https://metogroup-app-v2.netlify.app';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; pase: string }
  | { tipo: 'sin_alta' }
  | { tipo: 'sin_conectar' }
  | { tipo: 'error'; mensaje: string };

async function pedirPase(): Promise<{ pase: string | null; motivo: string | null }> {
  const r = await fetch('/api/mantenimiento-metogroup', { method: 'POST', cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message ?? 'No pude abrir Mantenimiento');
  return { pase: d?.pase ?? null, motivo: d?.motivo ?? null };
}

function HablarConMetoGroup({ onVerTrabajos }: { onVerTrabajos: () => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const marco = useRef<HTMLIFrameElement>(null);

  const abrir = useCallback(async () => {
    setEstado({ tipo: 'cargando' });
    try {
      const { pase, motivo } = await pedirPase();
      if (pase) setEstado({ tipo: 'listo', pase });
      else setEstado({ tipo: motivo === 'sin_conectar' ? 'sin_conectar' : 'sin_alta' });
    } catch (e) {
      setEstado({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No pude abrir Mantenimiento' });
    }
  }, []);

  useEffect(() => { void abrir(); }, [abrir]);

  // el módulo avisa cuando se le vence el pase: se le pasa uno nuevo sin recargar
  useEffect(() => {
    const escucha = async (ev: MessageEvent) => {
      if (ev.origin !== ORIGEN || ev.source !== marco.current?.contentWindow) return;
      if (ev.data?.tipo !== 'mant:pedir-pase') return;
      try {
        const { pase } = await pedirPase();
        if (pase) marco.current?.contentWindow?.postMessage({ tipo: 'mant:pase', pase }, ORIGEN);
      } catch { /* sin conexión: el módulo le dice que vuelva a abrir */ }
    };
    window.addEventListener('message', escucha);
    return () => window.removeEventListener('message', escucha);
  }, []);

  if (estado.tipo === 'cargando') return <Cargando texto="Abriendo Mantenimiento…" />;
  if (estado.tipo === 'sin_alta') {
    return (
      <Aviso tono="info" accion={<Boton variante="secundario" tamano="chico" onClick={onVerTrabajos}>Ver lo que hizo MetoGroup</Boton>}>
        Todavía no estás habilitado para contarle problemas o pedirle mejoras a MetoGroup desde acá. Pedíselo a MetoGroup y te habilitan.
      </Aviso>
    );
  }
  if (estado.tipo === 'sin_conectar') {
    return <Aviso tono="atencion">Mantenimiento todavía no está conectado con MetoGroup. Avisanos y lo dejamos andando.</Aviso>;
  }
  if (estado.tipo === 'error') {
    return (
      <Aviso tono="error" accion={<Boton variante="secundario" tamano="chico" onClick={() => void abrir()}>Probar de nuevo</Boton>}>
        {estado.mensaje}. Revisá la conexión.
      </Aviso>
    );
  }
  return (
    <div className="-mx-4 overflow-hidden border-y border-black/[0.06] bg-white sm:mx-0 sm:rounded-2xl sm:border">
      <iframe
        ref={marco}
        title="Mantenimiento · MetoGroup"
        src={`${ORIGEN}/mant#p=${encodeURIComponent(estado.pase)}`}
        referrerPolicy="no-referrer"
        allow="microphone"
        className="block h-[calc(100dvh-210px)] min-h-[560px] w-full border-0"
      />
    </div>
  );
}

export function MantenimientoPantalla() {
  const [vista, setVista] = useState<'hablar' | 'trabajos'>('hablar');
  return (
    <div className="space-y-4">
      <Pestanas
        etiquetaAccesible="Mantenimiento"
        valor={vista}
        onCambiar={setVista}
        opciones={[
          { valor: 'hablar', etiqueta: 'Hablar con MetoGroup' },
          { valor: 'trabajos', etiqueta: 'Lo que hizo MetoGroup' },
        ]}
      />
      {vista === 'hablar' ? <HablarConMetoGroup onVerTrabajos={() => setVista('trabajos')} /> : <MantenimientoTablero />}
    </div>
  );
}

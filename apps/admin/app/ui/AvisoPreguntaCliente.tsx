'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { esDeMiSucursal } from '../lib/aviso-caja';
import { esRutaDeAcceso, llevaFlotantes } from '../lib/rutas';
import { haceCuanto } from '../lib/pedidos';
import { alCambiarAudio, audioActivo, prepararAudio } from '../lib/alarma-pedido';
import { useAlarmaHastaQueSeAtienda } from '../lib/usar-alarma';
import { Boton, Entrada, FOCO, unir } from './kit';

// LA PREGUNTA DE UN CLIENTE SUENA EN LA CAJA (Leandro, 21/11/2026: «que no suene más en
// administración, que no avise más administración, que no se apague el bot y que siempre
// suene a caja, con sonido, con mucho sonido»). Lo que el bot no sabe (si el roquefort se
// fracciona, si hay 12 Paty) aparece en la caja de la sucursal de los pedidos, en cualquier
// pantalla, con la alarma de los pedidos al máximo (regla con candado, ver lib/alarma-pedido.ts).
// No se puede callar: se va cuando alguien la contesta ahí mismo (le llega al cliente por
// WhatsApp) o toca «Ya no hace falta».

type Mensaje = { de: 'cliente' | 'persona' | 'bot'; texto: string };
type Pregunta = {
  id: string; linea: string; telefono: string; nombre: string; lineaTexto: string | null;
  tema: string | null; consulta: string; direccion: string | null;
  creadoEn: string; insistioEn: string | null; botActivo: boolean; adjunto: string | null; charla: Mensaje[];
};
type Estado = { id: string; fase: 'mandando' | 'cerrando' | 'listo' | 'error'; texto?: string };

const CADA_MS = 8_000;
const CLAVE_AVISADAS = 'odb_preguntas_avisadas';
const QUIEN: Record<Mensaje['de'], string> = { cliente: 'Cliente', bot: 'Bot', persona: 'Casa' };

const leer = (): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_AVISADAS) ?? '{}') ?? {}; } catch { return {}; }
};
const guardar = (v: Record<string, number>) => {
  try { sessionStorage.setItem(CLAVE_AVISADAS, JSON.stringify(v)); } catch { /* modo privado */ }
};


export function AvisoPreguntaCliente({ sucursalId }: { sucursalId?: string | null }) {
  const ruta = usePathname();
  const [lista, setLista] = useState<Pregunta[]>([]);
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [verCharla, setVerCharla] = useState(false);
  const [sinSonido, setSinSonido] = useState(false);
  const [, setReloj] = useState(0);
  const apagado = useRef(false);
  const tituloOriginal = useRef<string | null>(null);
  const estadoRef = useRef<Estado | null>(null);
  useEffect(() => { estadoRef.current = estado; }, [estado]);

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      const r = await fetch('/api/consultas-cliente', { cache: 'no-store' });
      if (r.status === 403) { apagado.current = true; setLista([]); return; }
      if (!r.ok) return;
      const d = await r.json();
      if (!Array.isArray(d?.consultas)) return;
      const mias: Pregunta[] = esDeMiSucursal({ sucursal_id: d.sucursalId ?? null }, sucursalId) ? d.consultas : [];
      const avisadas = leer();
      const nuevas = mias.filter((p) => !avisadas[`${p.id}|${p.insistioEn ?? ''}`]);
      if (nuevas.length) {
        for (const p of nuevas) avisadas[`${p.id}|${p.insistioEn ?? ''}`] = Date.now();
        guardar(avisadas);
        try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* sin vibración */ }
        if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
          const p = nuevas[0];
          try {
            new Notification(p.insistioEn ? `${p.nombre} insiste` : `Pregunta de ${p.nombre}`, { body: p.consulta.slice(0, 160), tag: `pregunta-${p.id}`, icon: '/icon-192.png' });
          } catch { /* algunos navegadores no la dejan crear desde la página */ }
        }
      }
      // la que se está contestando no se va de la pantalla hasta mostrar cómo terminó
      setLista((antes) => {
        const enCurso = antes.filter((p) => estadoRef.current?.id === p.id && !mias.some((m) => m.id === p.id));
        return [...enCurso, ...mias];
      });
    } catch { /* sin red: la próxima vuelta */ }
  }, [sucursalId]);

  useEffect(() => {
    prepararAudio();
    // el estado del audio vive afuera de React (como en AvisoPedidoNuevo): se lee al montar
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSinSonido(!audioActivo());
    const dejarDeOir = alCambiarAudio(() => setSinSonido(!audioActivo()));
    const despertar = () => prepararAudio();
    window.addEventListener('pointerdown', despertar);
    window.addEventListener('keydown', despertar);
    mirar();
    const t = setInterval(mirar, CADA_MS);
    const r = setInterval(() => setReloj((n) => n + 1), 30_000);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t); clearInterval(r); dejarDeOir();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('pointerdown', despertar);
      window.removeEventListener('keydown', despertar);
    };
  }, [mirar]);

  const visible = llevaFlotantes(ruta);
  const p = lista[0];
  const pendientes = lista.filter((x) => !(estado?.id === x.id && estado.fase === 'listo'));

  // con el panel en otra pestaña, el título avisa
  useEffect(() => {
    if (tituloOriginal.current === null) tituloOriginal.current = document.title.replace(/^\(\d+\) Pregunta de un cliente · /, '');
    const base = tituloOriginal.current ?? 'O.D.B';
    document.title = pendientes.length ? `(${pendientes.length}) Pregunta de un cliente · ${base}` : base;
  }, [pendientes.length]);

  // la alarma: al máximo y sin parar mientras haya una sin contestar
  useAlarmaHastaQueSeAtienda(pendientes.length > 0 && !esRutaDeAcceso(ruta));

  if (!visible || !p) return null;

  async function enviar(accion: 'responder' | 'cerrar', x: Pregunta) {
    if (estado && (estado.fase === 'mandando' || estado.fase === 'cerrando')) return;
    setEstado({ id: x.id, fase: accion === 'responder' ? 'mandando' : 'cerrando' });
    try {
      const r = await fetch('/api/consultas-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accion === 'responder' ? { accion, id: x.id, texto } : { accion, id: x.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEstado({ id: x.id, fase: 'error', texto: d?.message ?? 'No se pudo. Probá de nuevo.' }); return; }
      // «Ya la contestó otra persona» también saca la pregunta: no queda nada por hacer
      const terminada = d?.ok || /otra persona|anotada en su charla|no le llegó nada/i.test(String(d?.texto ?? ''));
      if (!terminada) { setEstado({ id: x.id, fase: 'error', texto: d?.texto ?? 'No se pudo. Probá de nuevo.' }); return; }
      setEstado({ id: x.id, fase: 'listo', texto: d?.texto });
      setTexto(''); setVerCharla(false);
      setTimeout(() => {
        setLista((l) => l.filter((y) => y.id !== x.id));
        setEstado((e) => (e?.id === x.id ? null : e));
      }, 2_500);
    } catch {
      setEstado({ id: x.id, fase: 'error', texto: 'Sin conexión. Probá de nuevo.' });
    }
  }

  const delEstado = estado?.id === p.id ? estado : null;
  const ocupado = delEstado?.fase === 'mandando' || delEstado?.fase === 'cerrando';
  const resto = lista.length - 1;

  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      <section aria-label={`Pregunta de ${p.nombre}`}
        className="animate-entra-aviso overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none">
        {/* la franja roja: se lee de lejos, como «Llegó un pedido» */}
        <div className="flex items-center justify-between gap-2 bg-marca px-4 py-2 text-white">
          <p className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
            <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-full bg-white" />
            </span>
            <span className="truncate">{p.insistioEn ? 'El cliente insiste' : 'Pregunta de un cliente'}</span>
          </p>
          <span className="importe shrink-0 text-xs font-bold">{haceCuanto(p.creadoEn)}</span>
        </div>

        <div className="space-y-2 px-4 py-3">
          <p className="min-w-0 break-words text-sm text-tinta">
            <b className="font-semibold">{p.nombre}</b>
            {p.lineaTexto && <span className="text-tinta/60"> · {p.lineaTexto.replace(/^WhatsApp: /, '')}</span>}
          </p>
          <p className="whitespace-pre-line break-words rounded-xl bg-crema-hondo px-3 py-2 text-sm text-tinta">{p.consulta}</p>
          {p.direccion && <p className="text-xs text-tinta/70">Dirección: {p.direccion}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
            {p.charla.length > 0 && (
              <button type="button" onClick={() => setVerCharla((v) => !v)} aria-expanded={verCharla}
                className={unir('rounded-sm py-1 text-tinta/70 underline-offset-2 hover:text-tinta hover:underline', FOCO)}>
                {verCharla ? 'Esconder la charla' : 'Ver la charla'}
              </button>
            )}
            {p.adjunto && (
              <a href={p.adjunto} target="_blank" rel="noreferrer" className={unir('rounded-sm py-1 text-tinta/70 underline-offset-2 hover:text-tinta hover:underline', FOCO)}>
                Ver lo que mandó
              </a>
            )}
          </div>
          {verCharla && (
            <ol className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-black/[0.06] px-3 py-2 text-xs">
              {p.charla.map((m, i) => (
                <li key={i} className="break-words text-tinta/80"><b className="font-semibold text-tinta">{QUIEN[m.de]}:</b> {m.texto}</li>
              ))}
            </ol>
          )}
          {!p.botActivo && (
            <p className="text-xs text-tinta/70">La charla la está atendiendo una persona: lo que contestes queda anotado en su charla y hay que pasárselo desde RESPONDE.</p>
          )}
        </div>

        {delEstado?.fase === 'listo' ? (
          <p role="status" className="flex items-center gap-2 border-t border-black/[0.06] bg-ok px-4 py-3 text-sm font-semibold text-white">
            <span aria-hidden="true">●</span>{delEstado.texto ?? 'Listo.'}
          </p>
        ) : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); enviar('responder', p); }} className="space-y-2 border-t border-black/[0.06] px-4 py-3">
              <label htmlFor={`respuesta-${p.id}`} className="block text-xs font-semibold text-tinta/70">Tu respuesta le llega al cliente por WhatsApp</label>
              <div className="flex items-center gap-2">
                <Entrada id={`respuesta-${p.id}`} value={texto} maxLength={1000} disabled={ocupado}
                  onChange={(e) => { setTexto(e.target.value); if (delEstado?.fase === 'error') setEstado(null); }}
                  className="min-w-0 flex-1" />
                <Boton type="submit" tamano="chico" disabled={!texto.trim() || ocupado}>
                  {delEstado?.fase === 'mandando' ? '◔ Mandando…' : delEstado?.fase === 'error' && texto.trim() ? 'Volver a intentar' : 'Mandar'}
                </Boton>
              </div>
              {delEstado?.fase === 'error' && (
                <p role="alert" className="flex gap-1.5 text-sm text-marca-hondo"><span aria-hidden="true">■</span>{delEstado.texto}</p>
              )}
            </form>
            <div className="flex items-center justify-end bg-crema-claro px-4 py-1.5 text-xs font-semibold">
              <button type="button" onClick={() => enviar('cerrar', p)} disabled={ocupado}
                className={unir('rounded-sm py-1.5 text-tinta/70 underline-offset-2 hover:text-tinta hover:underline disabled:opacity-50', FOCO)}>
                {delEstado?.fase === 'cerrando' ? '◔ Cerrando…' : 'Ya no hace falta: cerrarla sin escribirle'}
              </button>
            </div>
          </>
        )}
        {sinSonido && (
          <p role="alert" className="bg-marca-suave px-4 py-2 text-xs font-semibold text-marca-hondo">
            No está sonando: tocá cualquier parte de la pantalla una vez para activar la alarma.
          </p>
        )}
        {resto > 0 && (
          <p className="bg-tinta px-4 py-2 text-center text-xs font-semibold text-white">
            {resto === 1 ? 'Y hay otra pregunta esperando' : `Y hay ${resto} preguntas más esperando`}
          </p>
        )}
      </section>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AreaTexto, Boton, FOCO, ROTULO, unir } from '../ui/kit';
import { hora } from '../lib/formato';

// ============================================================
// NOTAS DE UN TICKET (Leandro, 5/11/2026)
//
// «En caja necesitan en cada operación un espacio de notas en donde puedan
// anotar algo o enviar un audio explicando algo.»
//
// Va en el detalle del ticket (Mi turno) y en «Nota» de la última venta, al
// lado de Reimprimir: nunca en el medio del cobro. Se escribe, se graba un
// audio, o las dos cosas, y queda quién y a qué hora. El audio se escucha
// acá mismo y, si el servidor tiene transcripción, también se lee.
// ============================================================

export type NotaTicket = {
  id: string;
  texto: string | null;
  audioUrl: string | null;
  audioSegundos: number | null;
  transcripcion: string | null;
  creadoEn: string;
  usuario: string | null;
};

const TOPE_SEGUNDOS = 180; // igual que la API: 3 minutos

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// El formato que graba cada navegador: Chrome y Edge, webm/opus; Safari, mp4.
function formatoGrabacion(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
}

// ¿Este navegador puede grabar? No cambia mientras la página está abierta.
const sinSuscripcion = () => () => {};
const puedeGrabarAca = () => !!navigator.mediaDevices?.getUserMedia && !!formatoGrabacion();
const enServidor = () => false;

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result ?? '').replace(/^data:[^,]*,/, ''));
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(b);
  });
}

export function NotasTicket({
  ventaId,
  notas,
  onGuardada,
  enfocar = false,
}: {
  ventaId: string;
  notas: NotaTicket[];
  onGuardada: (notas: NotaTicket[]) => void;
  enfocar?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [audio, setAudio] = useState<{ blob: Blob; url: string; segundos: number } | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const grabadorRef = useRef<MediaRecorder | null>(null);
  const relojRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const puedeGrabar = useSyncExternalStore(sinSuscripcion, puedeGrabarAca, enServidor);

  // al cambiar de ticket o cerrar: se suelta el micrófono y la grabación a medias
  useEffect(() => () => {
    if (relojRef.current) clearInterval(relojRef.current);
    const g = grabadorRef.current;
    if (g && g.state !== 'inactive') { g.onstop = null; g.stop(); g.stream.getTracks().forEach((t) => t.stop()); }
  }, [ventaId]);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  async function grabar() {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('No hay permiso para usar el micrófono en esta PC');
      return;
    }
    const tipo = formatoGrabacion();
    const g = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    const partes: Blob[] = [];
    const inicio = Date.now();
    g.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    g.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (relojRef.current) clearInterval(relojRef.current);
      setGrabando(false);
      const blob = new Blob(partes, { type: g.mimeType || tipo || 'audio/webm' });
      const dur = Math.max(1, Math.round((Date.now() - inicio) / 1000));
      if (blob.size < 200) { setError('No se escuchó nada: grabalo de nuevo'); return; }
      setAudio({ blob, url: URL.createObjectURL(blob), segundos: dur });
    };
    grabadorRef.current = g;
    g.start(1000);
    setSegundos(0);
    setGrabando(true);
    relojRef.current = setInterval(() => {
      const s = Math.round((Date.now() - inicio) / 1000);
      setSegundos(s);
      if (s >= TOPE_SEGUNDOS && g.state !== 'inactive') g.stop();
    }, 500);
  }

  function terminar() {
    const g = grabadorRef.current;
    if (g && g.state !== 'inactive') g.stop();
  }

  async function guardar() {
    if (!texto.trim() && !audio) { setError('Escribí algo o grabá un audio'); return; }
    setGuardando(true);
    setError('');
    try {
      const r = await fetch('/api/venta-notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ventaId,
          texto: texto.trim() || undefined,
          ...(audio ? { audioBase64: await aBase64(audio.blob), audioMime: audio.blob.type, audioSegundos: audio.segundos } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo guardar la nota');
      setTexto('');
      setAudio(null);
      onGuardada(Array.isArray(d) ? d : notas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la nota');
    }
    setGuardando(false);
  }

  return (
    <div>
      <p className={ROTULO}>Notas</p>

      {notas.length > 0 && (
        <ul className="mt-1 grid gap-2">
          {notas.map((n) => (
            <li key={n.id} className="rounded-xl bg-crema/60 px-3 py-2">
              <p className="text-xs text-tinta/60">
                {n.usuario ?? 'Sin usuario'} · {hora(n.creadoEn)}
              </p>
              {n.texto && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-tinta">{n.texto}</p>}
              {n.audioUrl && (
                <audio controls preload="none" src={n.audioUrl} className="mt-1 h-10 w-full">
                  <track kind="captions" />
                </audio>
              )}
              {n.audioUrl && n.transcripcion && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-tinta/80">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta/50">Dice · </span>
                  {n.transcripcion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <AreaTexto
        // en el modal de la última venta, el cursor ya queda en la nota
        autoFocus={enfocar}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Nota del ticket"
        rows={2}
        maxLength={1000}
        className="mt-2 min-h-16"
      />

      {audio && !grabando && (
        <div className="mt-2 flex items-center gap-2">
          <audio controls src={audio.url} className="h-10 min-w-0 flex-1">
            <track kind="captions" />
          </audio>
          <button
            type="button"
            onClick={() => setAudio(null)}
            className={unir('min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-marca-hondo hover:bg-marca-suave', FOCO)}
          >
            Borrar audio
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm font-medium text-marca-hondo">{error}</p>}

      <div className="mt-2 flex gap-2 *:flex-1">
        {puedeGrabar && (grabando ? (
          <Boton variante="peligro" onClick={terminar}>
            <span className="mr-1 inline-block size-2.5 animate-pulse rounded-full bg-marca" aria-hidden />
            Terminar {reloj(segundos)}
          </Boton>
        ) : (
          <Boton variante="secundario" onClick={() => void grabar()} disabled={guardando}>
            {audio ? 'Grabar de nuevo' : 'Grabar audio'}
          </Boton>
        ))}
        <Boton onClick={() => void guardar()} cargando={guardando} disabled={grabando || (!texto.trim() && !audio)}>
          {guardando ? 'Guardando…' : 'Guardar nota'}
        </Boton>
      </div>
    </div>
  );
}

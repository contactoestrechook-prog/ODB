'use client';

import { useEffect, useRef, useState } from 'react';
import { FOCO, unir } from './kit';
import { procesarResultados, textoDictado } from '../lib/dictado';

// Botón de dictado por voz (Web Speech API del navegador, en español rioplatense).
// Mientras la persona habla, va llenando el input vía onTexto con el texto
// COMPLETO (lo que ya había en la caja, textoActual, más lo dictado); al
// terminar, si se pasó onFin, lo dispara con ese texto (p.ej. para enviar solo).
// Si el navegador no soporta reconocimiento de voz, no se muestra.
//
// 2/10/2026, «los audios se cortan a los 5 segundos»: antes escuchaba con
// continuous = false (el navegador lo apagaba en la primera pausa) y lo nuevo
// reemplazaba lo dictado. Ahora escucha de corrido hasta que se toque
// «terminar», se reinicia solo si el navegador corta (Chrome de Android y
// Safari lo hacen igual), suma en vez de reemplazar y muestra el tiempo.
const TOPE_MS = 3 * 60_000; // nunca más de 3 minutos con el micrófono abierto
const SILENCIOS_PARA_CORTAR = 2; // dos "no te escuché" seguidos: se apaga

export function BotonMicrofono({
  onTexto,
  onFin,
  textoActual = '',
  titulo = 'Hablar',
}: {
  onTexto: (t: string) => void;
  onFin?: (t: string) => void;
  textoActual?: string;
  titulo?: string;
}) {
  const [soportado, setSoportado] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState('');
  const recRef = useRef<any>(null);
  const baseRef = useRef(''); // lo que había en la caja al tocar el micrófono
  const confirmadoRef = useRef(''); // lo dictado y confirmado (sobrevive a los reinicios)
  const textoRef = useRef(''); // lo último que se mandó a la caja
  const pararRef = useRef(false); // la persona tocó «terminar» (o hubo un error que corta)
  const inicioRef = useRef(0);
  const silenciosRef = useRef(0);
  const relojRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextoRef = useRef(onTexto);
  const onFinRef = useRef(onFin);
  onTextoRef.current = onTexto;
  onFinRef.current = onFin;

  useEffect(() => {
    const hay = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    // Necesita contexto seguro (HTTPS) y el navegador tiene que soportar la API.
    setSoportado(!!hay && (typeof window === 'undefined' || window.isSecureContext !== false));
    // al salir de la pantalla, el micrófono se cierra
    return () => {
      pararRef.current = true;
      if (relojRef.current) clearInterval(relojRef.current);
      try { recRef.current?.abort(); } catch { /* ya estaba cerrado */ }
    };
  }, []);

  const MENSAJE_ERROR: Record<string, string> = {
    'not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'service-not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'no-speech': 'No te escuché, probá de nuevo.',
    'audio-capture': 'No encuentro un micrófono en este dispositivo.',
    network: 'Se cortó la conexión del dictado, probá de nuevo.',
  };

  const terminar = () => {
    setEscuchando(false);
    if (relojRef.current) { clearInterval(relojRef.current); relojRef.current = null; }
    const final = textoRef.current.trim();
    if (onFinRef.current && final && final !== baseRef.current.trim()) onFinRef.current(final);
  };

  // Un reconocimiento. Cuando el navegador lo corta solo (pausa larga, límite
  // propio), onend lo vuelve a arrancar mientras la persona no haya tocado
  // «terminar», sin perder lo ya confirmado.
  const arrancar = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = true;
    recRef.current = rec;
    rec.onresult = (e: any) => {
      silenciosRef.current = 0;
      const { confirmado, parcial } = procesarResultados(confirmadoRef.current, e.results, e.resultIndex ?? 0);
      confirmadoRef.current = confirmado;
      const t = textoDictado(baseRef.current, confirmado, parcial);
      textoRef.current = t;
      onTextoRef.current(t);
    };
    rec.onerror = (e: any) => {
      const tipo = String(e?.error ?? '');
      if (tipo === 'no-speech') { silenciosRef.current++; return; } // onend decide si sigue
      if (tipo === 'aborted') return;
      pararRef.current = true;
      setError(MENSAJE_ERROR[tipo] ?? 'No pude escuchar, probá de nuevo.');
    };
    rec.onend = () => {
      const seguir = !pararRef.current
        && Date.now() - inicioRef.current < TOPE_MS
        && silenciosRef.current < SILENCIOS_PARA_CORTAR;
      if (seguir) {
        try { arrancar(); return; } catch { /* no se pudo reiniciar: se termina */ }
      }
      if (!pararRef.current && silenciosRef.current >= SILENCIOS_PARA_CORTAR && !textoRef.current.trim()) {
        setError(MENSAJE_ERROR['no-speech']);
      }
      terminar();
    };
    rec.start();
  };

  const empezar = async () => {
    setError('');
    // Pedimos el permiso de micrófono explícitamente ANTES de arrancar el
    // reconocimiento: así el error de permiso denegado se ve claro en vez de
    // que el SpeechRecognition falle en silencio.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      setError(MENSAJE_ERROR['not-allowed']);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Este navegador no tiene dictado por voz.'); return; }
    baseRef.current = textoActual ?? '';
    confirmadoRef.current = '';
    textoRef.current = baseRef.current;
    pararRef.current = false;
    silenciosRef.current = 0;
    inicioRef.current = Date.now();
    setSegundos(0);
    try {
      arrancar();
      setEscuchando(true);
      relojRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - inicioRef.current) / 1000);
        setSegundos(s);
        if (s * 1000 >= TOPE_MS) { pararRef.current = true; try { recRef.current?.stop(); } catch { /* */ } }
      }, 1000);
    } catch {
      setEscuchando(false);
      setError('No pude iniciar el dictado, probá de nuevo.');
    }
  };

  const toggle = () => {
    if (escuchando) {
      pararRef.current = true;
      try { recRef.current?.stop(); } catch { terminar(); }
      return;
    }
    empezar();
  };

  if (!soportado) return null;

  const reloj = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

  return (
    <span className="relative inline-flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        title={escuchando ? 'Tocá para terminar' : titulo}
        aria-label={escuchando ? 'Terminar dictado' : titulo}
        className={unir(
          'flex size-11 items-center justify-center rounded-full border transition-colors active:scale-[0.98]',
          escuchando
            ? 'animate-pulse border-marca bg-marca text-white motion-reduce:animate-none'
            : 'border-black/15 bg-white text-tinta hover:border-marca',
          FOCO,
        )}
      >
        {escuchando ? (
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0014 0M12 18v3" />
          </svg>
        )}
      </button>
      {/* que se vea que sigue escuchando aunque uno haga una pausa */}
      {escuchando && (
        <span aria-live="off" className="min-w-[2.5rem] text-xs font-medium tabular-nums text-marca">{reloj}</span>
      )}
      {/* el aviso de error va fijo en la pantalla (debajo de la barra negra en
          el celular, arriba a la derecha en la compu): el micrófono está a veces
          contra el borde izquierdo y a veces contra el derecho, y siempre dentro
          de una caja con overflow-hidden; un globo pegado al botón se salía de
          la pantalla o quedaba cortado */}
      {error && (
        <span
          role="alert"
          className="fixed inset-x-4 top-[calc(var(--alto-barra-movil)+0.5rem)] z-toast rounded-xl bg-tinta px-3 py-2 text-sm text-white shadow-flotante sm:inset-x-auto sm:top-6 sm:right-6 sm:w-80"
        >
          {error}
        </span>
      )}
    </span>
  );
}

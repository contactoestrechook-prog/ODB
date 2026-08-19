'use client';

import { useEffect, useRef, useState } from 'react';

// Botón de dictado por voz (Web Speech API del navegador, en español rioplatense).
// Mientras la persona habla, va llenando el input vía onTexto; al terminar,
// si se pasó onFin, lo dispara con el texto final (p.ej. para enviar solo).
// Si el navegador no soporta reconocimiento de voz, no se muestra.
export function BotonMicrofono({
  onTexto,
  onFin,
  titulo = 'Hablar',
}: {
  onTexto: (t: string) => void;
  onFin?: (t: string) => void;
  titulo?: string;
}) {
  const [soportado, setSoportado] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [error, setError] = useState('');
  const recRef = useRef<any>(null);
  const ultimoRef = useRef('');

  useEffect(() => {
    const hay = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    // Necesita contexto seguro (HTTPS) y el navegador tiene que soportar la API.
    setSoportado(!!hay && (typeof window === 'undefined' || window.isSecureContext !== false));
  }, []);

  const MENSAJE_ERROR: Record<string, string> = {
    'not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'service-not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'no-speech': 'No te escuché, probá de nuevo.',
    'audio-capture': 'No encuentro un micrófono en este dispositivo.',
    network: 'Se cortó la conexión del dictado, probá de nuevo.',
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
    try {
      const rec = new SR();
      rec.lang = 'es-AR';
      rec.interimResults = true;
      rec.continuous = false;
      recRef.current = rec;
      ultimoRef.current = '';
      setEscuchando(true);
      rec.onresult = (e: any) => {
        const t = Array.from(e.results).map((r: any) => r[0].transcript).join(' ');
        ultimoRef.current = t;
        onTexto(t);
      };
      rec.onerror = (e: any) => {
        setEscuchando(false);
        setError(MENSAJE_ERROR[e?.error] ?? 'No pude escuchar, probá de nuevo.');
      };
      rec.onend = () => {
        setEscuchando(false);
        if (onFin && ultimoRef.current.trim()) onFin(ultimoRef.current.trim());
      };
      rec.start();
    } catch {
      setEscuchando(false);
      setError('No pude iniciar el dictado, probá de nuevo.');
    }
  };

  const toggle = () => {
    if (escuchando) { recRef.current?.stop(); return; }
    empezar();
  };

  if (!soportado) return null;

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={toggle}
        title={escuchando ? 'Tocá para terminar' : titulo}
        aria-label={escuchando ? 'Terminar dictado' : titulo}
        className={
          'h-11 w-11 rounded-full flex items-center justify-center border transition ' +
          (escuchando
            ? 'bg-[#B82D25] text-white border-[#B82D25] animate-pulse'
            : 'bg-white text-black border-black/15 hover:border-[#B82D25]')
        }
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0014 0M12 18v3" />
        </svg>
      </button>
      {error && (
        <span className="absolute top-full right-0 mt-1 w-52 rounded-lg bg-black text-white text-[11px] px-2.5 py-1.5 shadow-lg z-10">
          {error}
        </span>
      )}
    </span>
  );
}

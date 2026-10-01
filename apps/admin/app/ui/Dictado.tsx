'use client';

import { useEffect, useRef, useState } from 'react';
import { clasesBoton, unir } from './kit';

// Micrófono para dictar en vez de escribir (aclaraciones a la IA, reportes).
// Usa el reconocimiento de voz del navegador (Chrome, Edge, Safari); si el
// navegador no lo tiene, el botón no aparece y se escribe como siempre.
export function Dictado({ onTexto, className = '' }: { onTexto: (texto: string) => void; className?: string }) {
  const [soporta, setSoporta] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const rec = useRef<any>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSoporta(!!SR);
  }, []);

  const alternar = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (grabando) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = 'es-AR'; r.continuous = true; r.interimResults = false;
    r.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' ';
      if (t.trim()) onTexto(t.trim());
    };
    r.onend = () => setGrabando(false);
    r.onerror = () => setGrabando(false);
    rec.current = r; r.start(); setGrabando(true);
  };

  if (!soporta) return null;
  return (
    <button
      type="button"
      onClick={alternar}
      title={grabando ? 'Detener el dictado' : 'Dictar con el micrófono'}
      className={clasesBoton({
        variante: grabando ? 'primario' : 'secundario',
        tamano: 'chico',
        className: unir(grabando && 'animate-pulse motion-reduce:animate-none', className),
      })}
    >
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM19 11a7 7 0 01-14 0M12 18v3" />
      </svg>
      {grabando ? 'Escuchando… tocá para parar' : 'Dictar'}
    </button>
  );
}

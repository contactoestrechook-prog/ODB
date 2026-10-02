'use client';

import { useEffect, useRef, useState } from 'react';
import { FOCO, unir } from './kit';
import { cambioExterno, cerrarSesion, procesarResultados, textoDictado } from '../lib/dictado';

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
// Si la caja cambia desde afuera mientras dicta (se envió el mensaje, o la
// persona escribió a mano), el dictado termina y la caja queda como la dejaron:
// así nada de lo ya enviado vuelve a aparecer.
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
  const recRef = useRef<any>(null); // el reconocimiento vigente (los anteriores se ignoran)
  const baseRef = useRef(''); // lo que había en la caja al tocar el micrófono
  const previoRef = useRef(''); // lo dictado en sesiones anteriores (antes de un reinicio)
  const sesionRef = useRef(''); // lo confirmado en la sesión actual
  const parcialRef = useRef(''); // lo que se está diciendo y todavía no se confirmó
  const emitidosRef = useRef<string[]>([]); // lo último que el dictado puso en la caja
  const pararRef = useRef(false); // la persona tocó «terminar», o la caja cambió, o hubo un error
  const activoRef = useRef(false); // hay un dictado en curso (incluido el arranque)
  const desmontadoRef = useRef(false);
  const inicioRef = useRef(0);
  const silenciosRef = useRef(0);
  const relojRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextoRef = useRef(onTexto);
  const onFinRef = useRef(onFin);
  onTextoRef.current = onTexto;
  onFinRef.current = onFin;

  const pararReloj = () => {
    if (relojRef.current) { clearInterval(relojRef.current); relojRef.current = null; }
  };

  useEffect(() => {
    const hay = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    // Necesita contexto seguro (HTTPS) y el navegador tiene que soportar la API.
    setSoportado(!!hay && (typeof window === 'undefined' || window.isSecureContext !== false));
    // al salir de la pantalla, el micrófono se cierra
    return () => {
      desmontadoRef.current = true;
      pararRef.current = true;
      pararReloj();
      const rec = recRef.current;
      recRef.current = null;
      try { rec?.abort(); } catch { /* ya estaba cerrado */ }
    };
  }, []);

  const MENSAJE_ERROR: Record<string, string> = {
    'not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'service-not-allowed': 'Sin permiso de micrófono: habilitalo en el candado del navegador y volvé a tocar.',
    'no-speech': 'No te escuché, probá de nuevo.',
    'audio-capture': 'No encuentro un micrófono en este dispositivo.',
    network: 'Se cortó la conexión del dictado, probá de nuevo.',
  };

  const emitioRef = useRef(false);
  const mostrar = () => {
    const t = textoDictado(baseRef.current, previoRef.current, sesionRef.current, parcialRef.current);
    // la base cuenta como "nuestra" solo hasta lo primero dictado: después, si
    // la caja vuelve a quedar vacía es porque se envió el mensaje
    emitidosRef.current = emitioRef.current ? [...emitidosRef.current.slice(-5), t] : [t];
    emitioRef.current = true;
    onTextoRef.current(t);
  };

  const terminar = (avisarFin = true) => {
    activoRef.current = false;
    pararReloj();
    if (!desmontadoRef.current) setEscuchando(false);
    const final = textoDictado(baseRef.current, previoRef.current, sesionRef.current, parcialRef.current).trim();
    if (avisarFin && onFinRef.current && final && final !== baseRef.current.trim()) onFinRef.current(final);
  };

  // Cortar YA, sin esperar lo pendiente: abort() descarta lo que el navegador
  // todavía no entregó (stop() lo entregaría después y volvería a la caja).
  const cortar = () => {
    pararRef.current = true;
    const rec = recRef.current;
    recRef.current = null;
    try { rec?.abort(); } catch { /* */ }
    terminar(false);
  };

  // La caja cambió desde afuera mientras dictaba: se envió (quedó vacía) o la
  // persona escribió a mano. Se corta el dictado y la caja queda como la dejaron.
  useEffect(() => {
    if (!escuchando || !activoRef.current) return;
    if (cambioExterno(textoActual ?? '', emitidosRef.current)) cortar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoActual, escuchando]);

  // Una sesión de reconocimiento. Cuando el navegador la corta solo (pausa
  // larga, límite propio), onend arranca otra mientras la persona no haya
  // tocado «terminar», sin perder lo ya dictado.
  const arrancar = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = true;
    recRef.current = rec;
    sesionRef.current = '';
    parcialRef.current = '';
    rec.onresult = (e: any) => {
      // de un reconocimiento viejo o cortado (cortar() lo saca de recRef). Al
      // tocar «terminar» sí se aceptan las últimas palabras que entrega stop().
      if (rec !== recRef.current) return;
      silenciosRef.current = 0;
      const { sesion, parcial } = procesarResultados(sesionRef.current, e.results, e.resultIndex ?? 0);
      sesionRef.current = sesion;
      parcialRef.current = parcial;
      mostrar();
    };
    rec.onerror = (e: any) => {
      if (rec !== recRef.current) return;
      const tipo = String(e?.error ?? '');
      if (tipo === 'no-speech') { silenciosRef.current++; return; } // onend decide si sigue
      if (tipo === 'aborted') return;
      pararRef.current = true;
      setError(MENSAJE_ERROR[tipo] ?? 'No pude escuchar, probá de nuevo.');
    };
    rec.onend = () => {
      if (rec !== recRef.current) return; // ya hay otro vigente, o se cortó a propósito
      previoRef.current = cerrarSesion(previoRef.current, sesionRef.current, parcialRef.current);
      sesionRef.current = '';
      parcialRef.current = '';
      const seguir = !pararRef.current && !desmontadoRef.current
        && Date.now() - inicioRef.current < TOPE_MS
        && silenciosRef.current < SILENCIOS_PARA_CORTAR;
      if (seguir) {
        try { arrancar(); return; } catch { /* no se pudo reiniciar (p.ej. Safari): se termina */ }
      }
      if (!pararRef.current && silenciosRef.current >= SILENCIOS_PARA_CORTAR && !previoRef.current) {
        setError(MENSAJE_ERROR['no-speech']);
      }
      recRef.current = null;
      terminar();
    };
    rec.start();
  };

  const empezar = async () => {
    if (activoRef.current) return; // un doble toque no arranca dos reconocimientos
    activoRef.current = true;
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
      activoRef.current = false;
      if (!desmontadoRef.current) setError(MENSAJE_ERROR['not-allowed']);
      return;
    }
    if (desmontadoRef.current) { activoRef.current = false; return; } // se cerró la pantalla mientras pedía permiso
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { activoRef.current = false; setError('Este navegador no tiene dictado por voz.'); return; }
    baseRef.current = textoActual ?? '';
    previoRef.current = '';
    emitidosRef.current = [baseRef.current];
    emitioRef.current = false;
    pararRef.current = false;
    silenciosRef.current = 0;
    inicioRef.current = Date.now();
    setSegundos(0);
    try {
      arrancar();
      setEscuchando(true);
      pararReloj();
      relojRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - inicioRef.current) / 1000);
        setSegundos(s);
        if (s * 1000 >= TOPE_MS) { pararRef.current = true; try { recRef.current?.stop(); } catch { /* */ } }
      }, 1000);
    } catch {
      recRef.current = null;
      activoRef.current = false;
      setEscuchando(false);
      setError('No pude iniciar el dictado, probá de nuevo.');
    }
  };

  const toggle = () => {
    if (escuchando) {
      // «terminar»: stop() entrega lo último que dijo y onend cierra
      pararRef.current = true;
      try { recRef.current?.stop(); } catch { recRef.current = null; terminar(); }
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

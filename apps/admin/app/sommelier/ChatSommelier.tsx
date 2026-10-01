'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from '../ui/BotonMicrofono';
import { Boton, Chip, Entrada, Tarjeta, unir } from '../ui/kit';

type Mensaje = { rol: 'usuario' | 'somelier'; texto: string };

const SUGERENCIAS = [
  '¿Qué vino me recomendás para un asado?',
  'Algo rico por menos de $15.000',
  '¿Qué tomo con sushi?',
  'Quiero regalar algo especial',
];

export function ChatSommelier() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      rol: 'somelier',
      texto:
        '¡Hola! Soy el Somelier ODB 🍷 Para dar en la tecla, contame un poco: ¿para qué ocasión o con qué comida lo buscás? ¿Y qué te gusta más, tinto, blanco o algo con burbujas?',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, pensando]);

  async function enviar(textoMensaje: string) {
    const limpio = textoMensaje.trim();
    if (!limpio || pensando) return;
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: limpio }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const res = await fetch('/api/sommelier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: nuevos }),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        {
          rol: 'somelier',
          texto: res.ok
            ? datos.respuesta
            : `(${datos.message ?? 'No pude responder, probá de nuevo'})`,
        },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'somelier', texto: '(Sin conexión con la API)' }]);
    }
    setPensando(false);
  }

  return (
    <Tarjeta relleno={false} className="flex h-[78dvh] min-h-[26rem] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-marca text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3h8l-.6 5.5a3.4 3.4 0 01-6.8 0zM12 12v8M8 21h8" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight text-tinta">Somelier ODB</p>
          <p className="text-xs text-tinta/60">Experto en la cava de O.D.B · respuestas al instante</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {mensajes.map((m, i) => (
          <div key={i} className={'flex ' + (m.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
            <div
              className={unir(
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm sm:max-w-[80%]',
                m.rol === 'usuario' ? 'rounded-br-md bg-tinta text-white' : 'rounded-bl-md bg-crema text-tinta',
              )}
            >
              {m.texto}
            </div>
          </div>
        ))}
        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-crema px-4 py-2.5 text-sm text-tinta/60">
              eligiendo de la cava…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {mensajes.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {SUGERENCIAS.map((s) => (
            <Chip key={s} onClick={() => enviar(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="flex items-center gap-2 border-t border-black/[0.06] p-3"
      >
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntale al somelier… o hablá 🎤"
          aria-label="Pregunta para el somelier"
          className="min-w-0 flex-1"
        />
        <BotonMicrofono onTexto={setTexto} titulo="Hablarle al somelier" />
        <Boton type="submit" disabled={pensando || !texto.trim()} className="shrink-0">
          Enviar
        </Boton>
      </form>
    </Tarjeta>
  );
}

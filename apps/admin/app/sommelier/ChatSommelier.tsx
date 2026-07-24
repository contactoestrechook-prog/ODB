'use client';

import { useEffect, useRef, useState } from 'react';

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
    <div className="rounded-2xl bg-white overflow-hidden flex flex-col" style={{ height: '78vh' }}>
      <div className="bg-black px-5 py-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#B82D25] flex items-center justify-center text-white text-lg">
          🍷
        </div>
        <div>
          <p className="text-white font-medium leading-tight">Somelier ODB</p>
          <p className="text-[#F0EBE2]/60 text-xs">Experto en la cava de O.D.B · respuestas al instante</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mensajes.map((m, i) => (
          <div key={i} className={'flex ' + (m.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
            <div
              className={
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ' +
                (m.rol === 'usuario'
                  ? 'bg-[#B82D25] text-white rounded-br-md'
                  : 'bg-[#F0EBE2] text-black rounded-bl-md')
              }
            >
              {m.texto}
            </div>
          </div>
        ))}
        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-[#F0EBE2] px-4 py-2.5 text-sm text-black/50">
              eligiendo de la cava…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {mensajes.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              onClick={() => enviar(s)}
              className="rounded-full border border-[#B82D25] px-3 py-1.5 text-xs text-[#B82D25] hover:bg-[#B82D25] hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="border-t border-black/10 p-3 flex gap-2"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntale al somelier…"
          className="flex-1 rounded-full border border-black/15 px-4 py-2.5 text-sm text-black outline-none focus:border-[#B82D25]"
        />
        <button
          type="submit"
          disabled={pensando || !texto.trim()}
          className="rounded-full bg-[#B82D25] px-6 text-sm font-medium text-white disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BotonMicrofono } from '../ui/BotonMicrofono';
import { Boton, Chip, Entrada, PlacaRoja, Tarjeta, unir } from '../ui/kit';
import { pesos } from '../lib/formato';

// Un vino recomendado, como lo arma el API (apps/api/src/sommelier/vinos-recomendados.ts):
// precio, promo y efectivo salen de la cava, el porqué es lo que escribió el somelier.
type Vino = {
  sku: string;
  nombre: string;
  precio: number;
  precioEfectivo: number | null;
  promo: { nombre: string; antes: number } | null;
  porque: string;
};

// `texto` es la respuesta entera y es lo que vuelve al somelier como historial.
// Desde el 2/10/2026 los vinos que recomienda se ven en la Placa roja (el
// paquete gráfico de pedidos y listas de precios); del texto se muestran la
// introducción y el cierre, sin los renglones que ya están en la placa.
type Mensaje = { rol: 'usuario' | 'somelier'; texto: string; vinos?: Vino[]; introduccion?: string; cierre?: string };

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
        // al somelier le vuelve la charla como siempre: rol y texto entero
        body: JSON.stringify({ mensajes: nuevos.map(({ rol, texto }) => ({ rol, texto })) }),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        res.ok
          ? {
              rol: 'somelier',
              texto: datos.respuesta,
              vinos: Array.isArray(datos.recomendaciones) ? datos.recomendaciones : undefined,
              introduccion: typeof datos.introduccion === 'string' ? datos.introduccion : undefined,
              cierre: typeof datos.cierre === 'string' ? datos.cierre : undefined,
            }
          : { rol: 'somelier', texto: `(${datos.message ?? 'No pude responder, probá de nuevo'})` },
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
        {mensajes.map((m, i) => {
          const vinos = m.vinos?.length ? m.vinos : null;
          // sin vinos, el texto entero como siempre; con vinos, lo que va antes de la placa
          const arriba = vinos ? (m.introduccion ?? '') : m.texto;
          return (
            <div key={i} className={'flex flex-col ' + (m.rol === 'usuario' ? 'items-end' : 'items-start')}>
              {arriba && <Burbuja rol={m.rol}>{arriba}</Burbuja>}
              {vinos && <PlacaVinos vinos={vinos} className={unir('w-full', arriba && 'mt-2')} />}
              {vinos && m.cierre && (
                <Burbuja rol={m.rol} className="mt-2">
                  {m.cierre}
                </Burbuja>
              )}
            </div>
          );
        })}
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

function Burbuja({ rol, className, children }: { rol: Mensaje['rol']; className?: string; children: ReactNode }) {
  return (
    <div
      className={unir(
        'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm sm:max-w-[80%]',
        rol === 'usuario' ? 'rounded-br-md bg-tinta text-white' : 'rounded-bl-md bg-crema text-tinta',
        className,
      )}
    >
      {children}
    </div>
  );
}

// Los vinos que recomendó, como la lista de precios del bot: el precio a la
// derecha (con el de antes tachado si está en promo), en rojo pagando en
// efectivo o transferencia y en gris la promo y el porqué.
function PlacaVinos({ vinos, className }: { vinos: Vino[]; className?: string }) {
  const efectivo = (v: Vino) => (v.precioEfectivo != null && v.precioEfectivo < v.precio ? v.precioEfectivo : null);
  return (
    <PlacaRoja
      className={className}
      titulo="RECOMENDADOS"
      sub={`${vinos.length} ${vinos.length === 1 ? 'vino' : 'vinos'} de la cava`}
      renglones={vinos.map((v) => {
        const antes = v.promo && v.promo.antes > v.precio ? v.promo.antes : null;
        return {
          clave: v.sku,
          nombre: v.nombre,
          detalle:
            v.promo || v.porque ? (
              <>
                {v.promo && <span className="block font-medium text-tinta/70">Promo «{v.promo.nombre}»</span>}
                {v.porque && <span className="block">{v.porque}</span>}
              </>
            ) : undefined,
          destacado: efectivo(v) != null ? `${pesos(efectivo(v))} en efectivo o transferencia` : undefined,
          importe:
            antes != null ? (
              <>
                <s className="mr-1.5 text-sm font-semibold text-tinta/60">
                  <span className="sr-only">Antes </span>
                  {pesos(antes)}
                </s>
                <span className="sr-only">, ahora </span>
                {pesos(v.precio)}
              </>
            ) : (
              pesos(v.precio)
            ),
        };
      })}
      pie={vinos.some((v) => efectivo(v) != null) ? 'En rojo: pagando en efectivo o transferencia' : undefined}
    />
  );
}

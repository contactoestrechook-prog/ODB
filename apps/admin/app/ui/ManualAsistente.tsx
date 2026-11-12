'use client';

import { useState, type FormEvent } from 'react';
import { AreaTexto, Aviso, Boton, BotonLink, Etiqueta, Girador, ROTULO, Tarjeta, TarjetaCabecera, unir } from './kit';
import { fecha } from '../lib/formato';

// EL MANUAL QUE CONTESTA (Leandro, 10/11/2026: «que sea muy inteligente y si
// lo que están pidiendo no existe en el sistema que lo digan, que tienen que
// hablar con MetoGroup»). Contesta con el manual, el menú de hoy y lo último
// que se publicó; lo que no existe se le pide a MetoGroup con un toque.

type Respuesta = {
  existe: 'si' | 'parcial' | 'no';
  respuesta: string;
  pasos: string[];
  pantalla: string | null;
  seccion: string | null;
};
type Turno = { pregunta: string; r: Respuesta; pedido?: 'mandando' | 'listo' | 'fallo' };

export type Novedad = { hash: string; publicado_en: string; tipo: string; area: string; titulo: string; que_se_hizo: string };

export function PreguntarAlManual({
  nombreDe, tituloDe, onVerSeccion,
}: {
  nombreDe: (href: string) => string | null;
  tituloDe: (id: string) => string | null;
  onVerSeccion: (id: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pensando, setPensando] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function preguntar(e: FormEvent) {
    e.preventDefault();
    const pregunta = texto.trim();
    if (pregunta.length < 3 || pensando) return;
    setPensando(pregunta);
    setFallo(false);
    try {
      const res = await fetch('/api/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'preguntar',
          pregunta,
          historial: turnos.slice(-4).map((t) => ({ pregunta: t.pregunta, respuesta: t.r.respuesta })),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as Respuesta;
      setTurnos((xs) => [...xs, { pregunta, r }]);
      setTexto('');
    } catch {
      setFallo(true);
    } finally {
      setPensando(null);
    }
  }

  async function pedir(i: number) {
    const t = turnos[i];
    setTurnos((xs) => xs.map((x, j) => (j === i ? { ...x, pedido: 'mandando' } : x)));
    try {
      const res = await fetch('/api/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'pedir', pregunta: t.pregunta, respuesta: t.r.respuesta }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setTurnos((xs) => xs.map((x, j) => (j === i ? { ...x, pedido: 'listo' } : x)));
    } catch {
      setTurnos((xs) => xs.map((x, j) => (j === i ? { ...x, pedido: 'fallo' } : x)));
    }
  }

  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera
        titulo="Preguntale al manual"
        sub="Contá qué querés hacer y te digo dónde y cómo. Si el sistema no lo tiene, te lo digo."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {turnos.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="break-words text-sm font-semibold text-tinta">{t.pregunta}</p>
            {t.r.existe === 'no' ? (
              <Aviso
                tono="atencion"
                accion={
                  t.pedido === 'listo' ? null : (
                    <Boton variante="secundario" tamano="chico" onClick={() => pedir(i)} disabled={t.pedido === 'mandando'}>
                      {t.pedido === 'mandando' ? 'Mandando a MetoGroup…' : t.pedido === 'fallo' ? 'No salió. Probá de nuevo' : 'Pedírselo a MetoGroup'}
                    </Boton>
                  )
                }
              >
                <p className="break-words">{t.r.respuesta}</p>
                {t.pedido === 'listo' && <p className="mt-1 font-medium">Listo, le llegó a MetoGroup. Cuando lo vean te avisan por la campanita.</p>}
              </Aviso>
            ) : (
              <div className="space-y-2">
                {t.r.existe === 'parcial' && <Etiqueta tono="atencion">En parte</Etiqueta>}
                <p className="break-words text-sm leading-relaxed text-tinta/80">{t.r.respuesta}</p>
                {t.r.pasos.length > 0 && (
                  <ol className="space-y-1.5">
                    {t.r.pasos.map((p, k) => (
                      <li key={k} className="flex gap-2.5 text-sm leading-relaxed text-tinta/80">
                        <span className="importe mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-crema text-xs font-semibold text-tinta/70">{k + 1}</span>
                        <span className="min-w-0 break-words">{p}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex flex-wrap gap-2">
                  {t.r.pantalla && nombreDe(t.r.pantalla) && (
                    <BotonLink href={t.r.pantalla} variante="secundario" tamano="chico">Ir a {nombreDe(t.r.pantalla)}</BotonLink>
                  )}
                  {t.r.seccion && tituloDe(t.r.seccion) && (
                    <Boton variante="fantasma" tamano="chico" onClick={() => onVerSeccion(t.r.seccion!)}>
                      Ver en el manual: {tituloDe(t.r.seccion)}
                    </Boton>
                  )}
                  {t.r.existe === 'parcial' && t.pedido !== 'listo' && (
                    <Boton variante="fantasma" tamano="chico" onClick={() => pedir(i)} disabled={t.pedido === 'mandando'}>
                      {t.pedido === 'mandando' ? 'Mandando a MetoGroup…' : 'Pedir lo que falta a MetoGroup'}
                    </Boton>
                  )}
                </div>
                {t.pedido === 'listo' && <p className="text-sm font-medium text-ok">Listo, le llegó a MetoGroup. Cuando lo vean te avisan por la campanita.</p>}
              </div>
            )}
          </div>
        ))}

        {pensando && (
          <div className="space-y-2">
            <p className="break-words text-sm font-semibold text-tinta">{pensando}</p>
            <p className="inline-flex items-center gap-2 text-sm text-tinta/60" role="status">
              <Girador className="size-4" />Buscando en el manual y en lo último que se publicó…
            </p>
          </div>
        )}
        {fallo && <Aviso tono="error">No pude preguntar ahora. Probá de nuevo en un momento.</Aviso>}

        <form onSubmit={preguntar} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <AreaTexto
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            placeholder={turnos.length ? 'Seguí preguntando' : 'Escribí tu pregunta'}
            aria-label="Tu pregunta al manual"
            maxLength={600}
          />
          <Boton type="submit" disabled={!!pensando || texto.trim().length < 3}>
            {pensando ? 'Buscando…' : 'Preguntar'}
          </Boton>
        </form>
      </div>
    </Tarjeta>
  );
}

const TIPO: Record<string, string> = { nuevo: 'Nuevo', mejora: 'Mejora', arreglo: 'Arreglo', bug: 'Arreglo', propuesta: 'Nuevo' };

// Lo que se publicó en el último mes, más nuevo arriba: sale solo de cada
// publicación (Mantenimiento), así el manual nunca se queda atrás.
export function LoNuevo({ novedades }: { novedades: Novedad[] }) {
  const [todo, setTodo] = useState(false);
  if (!novedades.length) return null;
  const lista = todo ? novedades : novedades.slice(0, 4);
  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera titulo="Lo nuevo en el sistema" sub={`${novedades.length} cambios en los últimos 30 días`} />
      <ul className="divide-y divide-black/[0.06]">
        {lista.map((n) => (
          <li key={n.hash} className="space-y-1 px-4 py-3 sm:px-5">
            <p className={unir(ROTULO, 'flex flex-wrap gap-x-2')}>
              <span>{fecha(n.publicado_en)}</span><span>·</span><span>{n.area}</span><span>·</span><span>{TIPO[n.tipo] ?? n.tipo}</span>
            </p>
            <p className="break-words text-sm font-semibold text-tinta">{n.titulo}</p>
            <p className={unir('break-words text-sm leading-relaxed text-tinta/70', !todo && 'line-clamp-3')}>{n.que_se_hizo}</p>
          </li>
        ))}
      </ul>
      {novedades.length > 4 && (
        <div className="border-t border-black/[0.06] px-4 py-2 sm:px-5">
          <Boton variante="fantasma" tamano="chico" onClick={() => setTodo((x) => !x)}>
            {todo ? 'Ver menos' : `Ver los ${novedades.length} cambios`}
          </Boton>
        </div>
      )}
    </Tarjeta>
  );
}

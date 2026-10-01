'use client';

import { useMemo, useState } from 'react';
import { AREAS, SECCIONES, type Bloque, type Seccion } from '../manual/contenido';
import { Chips, Entrada, Etiqueta, FOCO_ADENTRO, IconoFlechaAbajo, ROTULO, Tarjeta, unir } from './kit';

// El manual se abre casi siempre con una duda concreta y alguien esperando del
// otro lado del mostrador. Por eso lo primero es el buscador, y lo segundo el
// área de quien entró: nadie lee un manual de arriba a abajo.
function Contenido({ b }: { b: Bloque }) {
  if (b.tipo === 'texto') {
    return <p className="break-words text-sm leading-relaxed text-tinta/70">{b.texto}</p>;
  }
  if (b.tipo === 'pasos') {
    return (
      <div>
        {b.titulo && <p className={unir(ROTULO, 'mb-2')}>{b.titulo}</p>}
        <ol className="space-y-2">
          {b.pasos.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-tinta/80">
              <span className="importe mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-crema text-xs font-semibold text-tinta/70">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{p}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (b.tipo === 'ojo') {
    return (
      <div className="rounded-xl border border-marca/20 bg-marca-suave p-3.5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-marca-hondo">
          {b.titulo ?? 'Tener en cuenta'}
        </p>
        <ul className="space-y-1.5">
          {b.puntos.map((p, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-tinta/80">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-marca" aria-hidden="true" />
              <span className="min-w-0 break-words">{p}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      {b.titulo && <p className={unir(ROTULO, 'mb-2')}>{b.titulo}</p>}
      <div className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06]">
        {b.filas.map(([k, v], i) => (
          <div key={i} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[minmax(0,190px)_1fr] sm:gap-3">
            <span className="min-w-0 break-words text-sm font-medium text-tinta">{k}</span>
            <span className="min-w-0 break-words text-sm leading-relaxed text-tinta/70">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const textoDe = (s: Seccion) =>
  [
    s.titulo, s.bajada, s.area,
    ...s.bloques.flatMap((b) =>
      b.tipo === 'texto' ? [b.texto]
        : b.tipo === 'pasos' ? [b.titulo ?? '', ...b.pasos]
        : b.tipo === 'ojo' ? [b.titulo ?? '', ...b.puntos]
        : [b.titulo ?? '', ...b.filas.flat()]),
  ].join(' ').toLowerCase();

export function Manual({ rol }: { rol: string | null }) {
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const q = busca.trim().toLowerCase();

  const secciones = useMemo(() => {
    let xs = SECCIONES;
    if (q) xs = xs.filter((s) => textoDe(s).includes(q));
    else if (area) xs = xs.filter((s) => s.area === area);
    // sin filtro, primero lo del área de quien entró
    if (!q && !area && rol) {
      const mias = xs.filter((s) => s.roles.includes(rol));
      const resto = xs.filter((s) => !s.roles.includes(rol));
      xs = [...mias, ...resto];
    }
    return xs;
  }, [q, area, rol]);

  const areasConAlgo = AREAS.filter((a) => SECCIONES.some((s) => s.area === a));

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta/60">
        Cómo funciona cada área. Buscá por lo que necesitás resolver: “devolución”, “remarcación”, “arqueo”, “cuenta corriente”.
      </p>

      <Entrada
        type="search"
        value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en el manual"
        aria-label="Buscar en el manual"
      />

      {!q && (
        <Chips
          etiquetaAccesible="Áreas del manual"
          valor={area ?? ''}
          onCambiar={(a) => (a === '' ? setArea(null) : setArea(a === area ? null : a))}
          opciones={[{ valor: '', etiqueta: 'Todo' }, ...areasConAlgo.map((a) => ({ valor: a, etiqueta: a }))]}
        />
      )}

      {q && (
        <p className="text-sm text-tinta/60" role="status">
          {secciones.length === 0
            ? 'Nada con esa búsqueda. Probá con otra palabra.'
            : `${secciones.length} tema${secciones.length === 1 ? '' : 's'} con “${busca.trim()}”.`}
        </p>
      )}

      <div className="space-y-3">
        {secciones.map((s) => {
          const abierto = abierta === s.id || !!q;
          const esMia = !!rol && s.roles.includes(rol);
          return (
            <Tarjeta key={s.id} id={s.id} relleno={false} className="overflow-hidden">
              <button
                onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                aria-expanded={abierto}
                className={unir('flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Etiqueta>{s.area}</Etiqueta>
                    {esMia && <Etiqueta tono="info">tu área</Etiqueta>}
                  </span>
                  <span className="mt-2 block break-words text-base font-semibold text-tinta">{s.titulo}</span>
                  <span className="mt-0.5 block break-words text-sm leading-relaxed text-tinta/60">{s.bajada}</span>
                </span>
                <IconoFlechaAbajo
                  className={unir('mt-1 size-5 shrink-0 text-tinta/40 transition-transform', abierto ? 'rotate-0' : '-rotate-90')}
                />
              </button>
              {abierto && (
                <div className="space-y-4 border-t border-black/[0.06] px-4 py-4 sm:px-5">
                  {s.bloques.map((b, i) => <Contenido key={i} b={b} />)}
                </div>
              )}
            </Tarjeta>
          );
        })}
      </div>

      <p className="pt-2 text-xs leading-relaxed text-tinta/60">
        Si algo del sistema no funciona como dice acá, es un problema del sistema o del manual: avisá y se corrige. Un manual que
        no coincide con la pantalla se deja de leer a la segunda vez.
      </p>
    </div>
  );
}

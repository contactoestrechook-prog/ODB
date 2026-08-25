'use client';

import { useMemo, useState } from 'react';
import { AREAS, SECCIONES, type Bloque, type Seccion } from '../manual/contenido';

// El manual se abre casi siempre con una duda concreta y alguien esperando del
// otro lado del mostrador. Por eso lo primero es el buscador, y lo segundo el
// área de quien entró: nadie lee un manual de arriba a abajo.
function Contenido({ b }: { b: Bloque }) {
  if (b.tipo === 'texto') {
    return <p className="text-[13.5px] leading-relaxed text-black/70">{b.texto}</p>;
  }
  if (b.tipo === 'pasos') {
    return (
      <div>
        {b.titulo && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/40">{b.titulo}</p>}
        <ol className="space-y-1.5">
          {b.pasos.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-black/75">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold text-black/50">
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (b.tipo === 'ojo') {
    return (
      <div className="rounded-xl border border-[#B82D25]/20 bg-[#FDF3F2] p-3.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#B82D25]">
          {b.titulo ?? 'Tener en cuenta'}
        </p>
        <ul className="space-y-1.5">
          {b.puntos.map((p, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-black/75">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#B82D25]" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      {b.titulo && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/40">{b.titulo}</p>}
      <div className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10">
        {b.filas.map(([k, v], i) => (
          <div key={i} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[minmax(0,190px)_1fr] sm:gap-3">
            <span className="text-[13px] font-medium text-black">{k}</span>
            <span className="text-[13px] leading-relaxed text-black/65">{v}</span>
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
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-black">Manual del sistema</h1>
        <p className="text-xs text-black/50">
          Cómo funciona cada área. Buscá por lo que necesitás resolver: “devolución”, “remarcación”, “arqueo”, “cuenta corriente”.
        </p>
      </div>

      <input
        value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en el manual"
        className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base outline-none focus:border-black/30"
      />

      {!q && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setArea(null)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${!area ? 'bg-black text-white' : 'bg-white text-black/60'}`}>
            Todo
          </button>
          {areasConAlgo.map((a) => (
            <button key={a} onClick={() => setArea(a === area ? null : a)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${area === a ? 'bg-black text-white' : 'bg-white text-black/60'}`}>
              {a}
            </button>
          ))}
        </div>
      )}

      {q && (
        <p className="text-xs text-black/45">
          {secciones.length === 0
            ? 'Nada con esa búsqueda. Probá con otra palabra.'
            : `${secciones.length} tema${secciones.length === 1 ? '' : 's'} con “${busca.trim()}”.`}
        </p>
      )}

      <div className="space-y-2.5">
        {secciones.map((s) => {
          const abierto = abierta === s.id || !!q;
          const esMia = !!rol && s.roles.includes(rol);
          return (
            <section key={s.id} id={s.id} className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <button
                onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                className="flex w-full items-start justify-between gap-3 p-4 text-left"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black/50">
                      {s.area}
                    </span>
                    {esMia && (
                      <span className="rounded-full bg-[#B82D25]/10 px-2.5 py-0.5 text-[10px] font-medium text-[#932A1F]">
                        tu área
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-black">{s.titulo}</span>
                  <span className="block text-[12px] leading-relaxed text-black/50">{s.bajada}</span>
                </span>
                <span className={`shrink-0 text-black/25 transition-transform ${abierto ? 'rotate-90' : ''}`}>›</span>
              </button>
              {abierto && (
                <div className="space-y-3.5 border-t border-black/5 px-4 py-4">
                  {s.bloques.map((b, i) => <Contenido key={i} b={b} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="pt-2 text-[11px] leading-relaxed text-black/40">
        Si algo del sistema no funciona como dice acá, es un problema del sistema o del manual: avisá y se corrige. Un manual que
        no coincide con la pantalla se deja de leer a la segunda vez.
      </p>
    </div>
  );
}

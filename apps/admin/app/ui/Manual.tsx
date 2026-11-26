'use client';

import { useMemo, useState } from 'react';
import { AREAS, SECCIONES, type Bloque, type Seccion } from '../manual/contenido';
import { filtrarPorBusqueda } from '../lib/busqueda';
import {
  Boton, BotonLink, Chips, Entrada, Etiqueta, FOCO_ADENTRO, IconoFlechaAbajo, Modal, Pestanas, ROTULO, Tarjeta,
  TarjetaCabecera, unir,
} from './kit';
import { LoNuevo, PreguntarAlManual, type Novedad } from './ManualAsistente';

// El manual se abre casi siempre con una duda concreta y alguien esperando del
// otro lado del mostrador. Por eso lo primero es la pregunta (escrita o
// dictada), y después tres caminos: el día del dueño, el sistema pantalla por
// pantalla (el mismo menú que ve quien entró) y los temas para buscar.
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

export type PantallaManual = { href: string; nombre: string; familia: string | null; bajada: string };
export type GrupoManual = { titulo: string; items: PantallaManual[] };

/** Las secciones que explican una pantalla del menú (con su query exacta, o la ruta sola). */
function seccionesDe(href: string): Seccion[] {
  const exactas = SECCIONES.filter((s) => s.pantallas.includes(href));
  if (exactas.length) return exactas;
  const ruta = href.split('?')[0];
  return SECCIONES.filter((s) => s.pantallas.some((p) => p.split('?')[0] === ruta));
}

// ------------------------------------------------------------ el día del dueño
// Lo que conviene mirar cada día, en el orden en que pasa. Solo aparecen las
// pantallas que esta persona puede abrir.
const DIA_DEL_DUENO: { momento: string; href: string; para: string }[] = [
  { momento: 'A la mañana', href: '/informes', para: 'Cómo cerró ayer, en un parte que llega solo todos los días a las 7.' },
  { momento: 'A la mañana', href: '/aprobaciones', para: 'Lo que espera tu firma: órdenes a proveedores, pagos, cobros y cambios de costo. Sin tu firma no sale.' },
  { momento: 'Durante el día', href: '/pedidos', para: 'Que ningún pedido quede sin tomar ni clavado en «Listos». Podés asignar quién lo arma.' },
  { momento: 'Durante el día', href: '/reportes', para: 'Lo que el equipo marcó con «Esto está mal»: qué se arregló y qué falta.' },
  { momento: 'Durante el día', href: '/caja-dueno', para: 'Tu plata: anotá lo que entra y sale escribiendo o dictando, y mirá cuánto tenés.' },
  { momento: 'Al cierre', href: '/cierres', para: 'Cómo cerró cada caja y si hubo diferencias.' },
  { momento: 'Al cierre', href: '/actividad', para: 'Quién hizo cada cosa hoy: pedidos, compras, caja, stock y cobros.' },
  { momento: 'Cuando quieras', href: '/estadisticas', para: 'El negocio en números: ventas, rubros y sucursales.' },
];

function TuDia({ pantallas, onComoSeUsa }: { pantallas: Map<string, PantallaManual>; onComoSeUsa: (p: PantallaManual) => void }) {
  const pasos = DIA_DEL_DUENO.filter((d) => pantallas.has(d.href));
  if (!pasos.length) return null;
  let momentoAnterior = '';
  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera titulo="Tu día de dueño" sub="Lo que conviene mirar cada día, en orden. Tocá «Abrir» para ir o «Cómo se usa» para leerlo." />
      <ol className="divide-y divide-black/[0.06]">
        {pasos.map((d, i) => {
          const p = pantallas.get(d.href)!;
          const nuevoMomento = d.momento !== momentoAnterior;
          momentoAnterior = d.momento;
          return (
            <li key={d.href} className="flex gap-3 px-4 py-3.5 sm:px-5">
              <span className="importe mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-tinta text-xs font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                {nuevoMomento && <p className={ROTULO}>{d.momento}</p>}
                <p className="break-words text-sm font-semibold text-tinta">{p.nombre}</p>
                <p className="break-words text-sm leading-relaxed text-tinta/70">{d.para}</p>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <BotonLink href={d.href} variante="secundario" tamano="chico">Abrir {p.nombre}</BotonLink>
                  {seccionesDe(d.href).length > 0 && (
                    <Boton variante="fantasma" tamano="chico" onClick={() => onComoSeUsa(p)}>Cómo se usa</Boton>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Tarjeta>
  );
}

// ----------------------------------------------------- pantalla por pantalla
function PantallaPorPantalla({ grupos, onComoSeUsa }: { grupos: GrupoManual[]; onComoSeUsa: (p: PantallaManual) => void }) {
  const [busca, setBusca] = useState('');
  const q = busca.trim().toLowerCase();
  const visibles = useMemo(() => {
    if (!q) return grupos;
    return grupos
      .map((g) => ({
        ...g,
        items: filtrarPorBusqueda(g.items, q, (p) =>
          [p.nombre, p.familia ?? '', p.bajada, g.titulo, ...seccionesDe(p.href).map((s) => `${s.titulo} ${s.bajada}`)].join(' ').toLowerCase()),
      }))
      .filter((g) => g.items.length > 0);
  }, [grupos, q]);
  const total = grupos.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-tinta/60">
        Las {total} pantallas que tenés en el menú, en el mismo orden. Cada una dice para qué sirve; «Cómo se usa» la explica paso a paso.
      </p>
      <Entrada
        type="search"
        value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar una pantalla: «cheques», «stock», «WhatsApp»"
        aria-label="Buscar una pantalla"
      />
      {q && visibles.length === 0 && (
        <p className="text-sm text-tinta/60" role="status">Ninguna pantalla con esa palabra. Probá preguntarle arriba.</p>
      )}
      {visibles.map((g) => (
        <Tarjeta key={g.titulo} relleno={false}>
          <TarjetaCabecera titulo={g.titulo} sub={`${g.items.length} pantalla${g.items.length === 1 ? '' : 's'}`} />
          <ul className="divide-y divide-black/[0.06]">
            {g.items.map((p) => {
              const explicada = seccionesDe(p.href).length > 0;
              return (
                <li key={p.href} className="space-y-1.5 px-4 py-3 sm:px-5">
                  <p className="break-words text-sm font-semibold text-tinta">
                    {p.familia && p.familia !== p.nombre && <span className="font-normal text-tinta/60">{p.familia} › </span>}
                    {p.nombre}
                  </p>
                  {p.bajada && <p className="break-words text-sm leading-relaxed text-tinta/70">{p.bajada}</p>}
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <BotonLink href={p.href} variante="secundario" tamano="chico">Abrir</BotonLink>
                    {explicada && <Boton variante="fantasma" tamano="chico" onClick={() => onComoSeUsa(p)}>Cómo se usa</Boton>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ temas
function Temas({ rol, abierta, setAbierta }: { rol: string | null; abierta: string | null; setAbierta: (id: string | null) => void }) {
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const q = busca.trim().toLowerCase();

  const secciones = useMemo(() => {
    let xs = SECCIONES;
    if (q) xs = filtrarPorBusqueda(xs, q, textoDe);
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
    <div className="space-y-3">
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
            ? 'Nada con esa búsqueda. Probá con otra palabra o preguntale arriba.'
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
    </div>
  );
}

// --------------------------------------------------------------- la página
type Vista = 'dia' | 'pantallas' | 'temas' | 'nuevo';

export function Manual({
  rol, roles = [], nombre = null, esDueno = false, grupos = [], pantallas = {}, novedades = [],
}: {
  rol: string | null;
  roles?: string[];
  nombre?: string | null;
  esDueno?: boolean;
  /** el menú tal como lo ve quien entró */
  grupos?: GrupoManual[];
  /** href → nombre de TODAS las pantallas del menú (para los botones «Ir a…» del asistente) */
  pantallas?: Record<string, string>;
  novedades?: Novedad[];
}) {
  const jefe = esDueno || roles.includes('gerente');
  const [vista, setVista] = useState<Vista>(jefe ? 'dia' : 'pantallas');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [explicando, setExplicando] = useState<{ titulo: string; href: string | null; secciones: Seccion[] } | null>(null);

  const misPantallas = useMemo(() => new Map(grupos.flatMap((g) => g.items.map((p) => [p.href, p] as const))), [grupos]);

  function comoSeUsa(p: PantallaManual) {
    setExplicando({ titulo: p.nombre, href: p.href, secciones: seccionesDe(p.href) });
  }

  // desde una respuesta del asistente: abre esa sección en una ventana
  function verSeccion(id: string) {
    const s = SECCIONES.find((x) => x.id === id);
    if (s) setExplicando({ titulo: s.titulo, href: s.pantallas.find((h) => misPantallas.has(h)) ?? null, secciones: [s] });
  }

  const opciones = [
    ...(jefe ? [{ valor: 'dia' as const, etiqueta: 'Tu día' }] : []),
    { valor: 'pantallas' as const, etiqueta: 'Pantalla por pantalla' },
    { valor: 'temas' as const, etiqueta: 'Temas' },
    ...(novedades.length ? [{ valor: 'nuevo' as const, etiqueta: 'Lo nuevo', cuenta: novedades.length }] : []),
  ];

  return (
    <div className="space-y-4">
      <PreguntarAlManual
        nombre={nombre}
        esDueno={esDueno}
        tieneCajaDueno={misPantallas.has('/caja-dueno')}
        nombreDe={(href) => pantallas[href] ?? null}
        tituloDe={(id) => SECCIONES.find((s) => s.id === id)?.titulo ?? null}
        onVerSeccion={verSeccion}
      />

      <Pestanas etiquetaAccesible="Partes del manual" opciones={opciones} valor={vista} onCambiar={(v) => setVista(v)} />

      {vista === 'dia' && jefe && (
        <TuDia pantallas={misPantallas} onComoSeUsa={comoSeUsa} />
      )}
      {vista === 'pantallas' && <PantallaPorPantalla grupos={grupos} onComoSeUsa={comoSeUsa} />}
      {vista === 'temas' && <Temas rol={rol} abierta={abierta} setAbierta={setAbierta} />}
      {vista === 'nuevo' && <LoNuevo novedades={novedades} abierto />}

      <p className="pt-2 text-xs leading-relaxed text-tinta/60">
        Si algo del sistema no funciona como dice acá, es un problema del sistema o del manual: tocá «Esto está mal» y se corrige. Un manual que
        no coincide con la pantalla se deja de leer a la segunda vez.
      </p>

      <Modal
        abierto={!!explicando}
        onCerrar={() => setExplicando(null)}
        titulo={explicando ? `Cómo se usa: ${explicando.titulo}` : ''}
        descripcion={explicando?.secciones.length === 1 ? explicando.secciones[0].bajada : undefined}
        ancho="ancho"
        pie={
          <>
            <Boton variante="secundario" onClick={() => setExplicando(null)}>← Volver al manual</Boton>
            {explicando?.href && <BotonLink href={explicando.href}>Abrir {pantallas[explicando.href] ?? explicando.titulo}</BotonLink>}
          </>
        }
      >
        <div className="space-y-6">
          {explicando?.secciones.map((s) => (
            <section key={s.id} className="space-y-4">
              {explicando.secciones.length > 1 && (
                <div>
                  <p className="break-words text-base font-semibold text-tinta">{s.titulo}</p>
                  <p className="break-words text-sm text-tinta/60">{s.bajada}</p>
                </div>
              )}
              {s.bloques.map((b, i) => <Contenido key={i} b={b} />)}
            </section>
          ))}
        </div>
      </Modal>
    </div>
  );
}

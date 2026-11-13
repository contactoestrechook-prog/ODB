'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { Boton, Chip, Entrada, Etiqueta, FOCO, Girador, IconoCerrar, PlacaRoja, ROTULO, Selector, Tarjeta, unir } from './kit';
import { pesos } from '../lib/formato';
import {
  ESTILOS, OCASIONES, SIN_FILTROS, TRAMOS_PRECIO,
  enPalabras, estiloDe, interpretar, ordenar, pedidoDeFiltros, rangoPrecio, stockDe, sumarFiltros, textoParaCliente, tramoDe,
  type CavaPanel, type Estilo, type Filtros, type Ocasion, type Orden, type VinoCava, type VinoOrdenado, type VinoRecomendado,
} from '../lib/somelier';

// ============================================================
// SOMELIER ODB (13/11/2026). Leandro: «es una cagada el somelier, ¿no?».
//
// Antes: una ventanita de chat en el medio de la pantalla que veía 80 vinos de
// ~1.430 (los de más stock sumando los dos locales), le hablaba al vendedor
// como si fuera el cliente («¿para qué ocasión?») y no dejaba hacer nada con
// lo que recomendaba.
//
// Ahora, a pantalla completa:
//   1. arriba, la cava del local: cuántos vinos hay, de qué tipo y a qué
//      precio (cada tramo se toca y filtra);
//   2. a la izquierda, el somelier: se le dice lo que pide el cliente («un
//      malbec para el asado, hasta 20 mil») y los filtros se prenden solos; él
//      elige tres entre los que quedaron, con el porqué para decirle al cliente;
//   3. a la derecha, la cava filtrada y ordenada al instante para esa ocasión,
//      con el stock de los dos locales, el precio en efectivo, la ficha, los
//      parecidos y la selección «Para el cliente» que se copia para WhatsApp.
// ============================================================

/** Colores de cada tipo (validados con la skill dataviz sobre la crema; cada tramo lleva su nombre escrito). */
const COLOR: Record<Estilo, string> = {
  tinto: '#8E2A44',
  blanco: '#C9A63C',
  rosado: '#E0849A',
  espumante: '#22865F',
  dulce: '#A0581A',
};

/** Cuántos vinos lee el somelier por consulta (los primeros de la lista para recomendar). */
const CANDIDATOS = 160;
const DE_A = 40;
const GUARDA_LOCAL = 'odb.somelier.sucursal';

type Mensaje = {
  rol: 'usuario' | 'somelier';
  texto: string;
  vinos?: VinoRecomendado[];
  introduccion?: string;
  cierre?: string;
  /** Qué buscaba cuando se preguntó (va de subtítulo de la placa). */
  busca?: string;
  error?: boolean;
};

// La cava se trae una vez y queda un minuto (el servidor la guarda cinco).
let cavaGuardada: { en: number; datos: CavaPanel } | null = null;
async function pedirCava(): Promise<CavaPanel> {
  if (cavaGuardada && Date.now() - cavaGuardada.en < 60_000) return cavaGuardada.datos;
  const r = await fetch('/api/sommelier/cava', { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  const datos = (await r.json()) as CavaPanel;
  cavaGuardada = { en: Date.now(), datos };
  return datos;
}

const miles = (n: number) => n.toLocaleString('es-AR');
const nombreCorto = (n: string) => n.replace(/^Sant\s+/i, 'S. ').replace(/^Santa\s+/i, 'Sta. ');
const Punto = ({ color, className }: { color: string; className?: string }) => (
  <span className={unir('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} aria-hidden="true" />
);

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // sin permiso del portapapeles (http, Safari viejo): el camino de siempre
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Un botón que dice «Copiado» un par de segundos después de copiar. */
function BotonCopiar({ texto, children, variante = 'secundario', className }: { texto: () => string; children: ReactNode; variante?: 'primario' | 'secundario' | 'fantasma'; className?: string }) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'error'>('listo');
  useEffect(() => {
    if (estado === 'listo') return;
    const t = setTimeout(() => setEstado('listo'), 2200);
    return () => clearTimeout(t);
  }, [estado]);
  return (
    <Boton
      type="button"
      tamano="chico"
      variante={variante}
      className={className}
      onClick={async () => setEstado((await copiar(texto())) ? 'copiado' : 'error')}
    >
      {estado === 'copiado' ? 'Copiado: pegalo en el WhatsApp' : estado === 'error' ? 'No pude copiar' : children}
    </Boton>
  );
}

export function SomelierPantalla({ sucursalUsuario }: { sucursalUsuario: string | null }) {
  const [cava, setCava] = useState<CavaPanel | null>(() => cavaGuardada?.datos ?? null);
  const [falloCava, setFalloCava] = useState(false);
  const [intento, setIntento] = useState(0);
  /** null: todavía no se sabe (se decide al llegar la cava); '': los dos locales */
  const [sucursal, setSucursal] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [orden, setOrden] = useState<Orden>('recomendar');
  const [cuantos, setCuantos] = useState(DE_A);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [paraCliente, setParaCliente] = useState<string[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pensando, setPensando] = useState<{ vistos: number } | null>(null);
  const [texto, setTexto] = useState('');
  const [vistaMovil, setVistaMovil] = useState<'somelier' | 'cava'>('somelier');
  const finCharla = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // ---------- la cava ----------
  useEffect(() => {
    let vigente = true;
    pedirCava()
      .then((d) => { if (vigente) { setCava(d); setFalloCava(false); } })
      .catch(() => { if (vigente) setFalloCava(true); });
    return () => { vigente = false; };
  }, [intento]);

  // el local: el último elegido en esta compu, el del usuario o el de más vinos
  useEffect(() => {
    if (!cava || sucursal !== null) return;
    let guardado: string | null = null;
    try { guardado = localStorage.getItem(GUARDA_LOCAL); } catch {}
    const existe = (id: string | null) => id === '' || (!!id && cava.sucursales.some((s) => s.id === id));
    if (existe(guardado)) return setSucursal(guardado!);
    if (existe(sucursalUsuario)) return setSucursal(sucursalUsuario!);
    const cuenta = (id: string) => cava.vinos.filter((v) => (v.stock[id] ?? 0) > 0).length;
    const mayor = [...cava.sucursales].sort((a, b) => cuenta(b.id) - cuenta(a.id))[0];
    setSucursal(mayor?.id ?? '');
  }, [cava, sucursal, sucursalUsuario]);

  const elegirLocal = (id: string) => {
    setSucursal(id);
    setCuantos(DE_A);
    try { localStorage.setItem(GUARDA_LOCAL, id); } catch {}
  };

  const local = sucursal ?? '';
  const nombreLocal = cava?.sucursales.find((s) => s.id === local)?.nombre ?? null;
  const vinos = useMemo(() => cava?.vinos ?? [], [cava]);
  const porSku = useMemo(() => new Map(vinos.map((v) => [v.sku, v])), [vinos]);
  const cepasConocidas = useMemo(() => [...new Set(vinos.map((v) => v.cepa).filter((c): c is string => !!c))], [vinos]);

  // lo que se ve, y lo que lee el somelier (siempre en el orden para recomendar)
  const lista = useMemo(() => ordenar(vinos, filtros, local, orden), [vinos, filtros, local, orden]);
  const paraRecomendar = useMemo(() => (orden === 'recomendar' ? lista : ordenar(vinos, filtros, local, 'recomendar')), [orden, lista, vinos, filtros, local]);

  // lo último que recomendó el somelier: se marca en la cava
  const recomendados = useMemo(() => {
    const ultima = [...mensajes].reverse().find((m) => m.rol === 'somelier' && m.vinos?.length);
    return new Map((ultima?.vinos ?? []).map((v, i) => [v.sku, { puesto: i + 1, porque: v.porque }]));
  }, [mensajes]);
  // los elegidos van arriba, aparte: abajo no se repiten
  const resto = useMemo(() => lista.filter((x) => !recomendados.has(x.vino.sku)), [lista, recomendados]);

  useEffect(() => {
    finCharla.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes, pensando]);

  // ---------- filtros ----------
  const cambiarFiltros = (f: Filtros) => {
    setFiltros(f);
    setCuantos(DE_A);
  };
  const alternarEstilo = (e: Estilo) => {
    const estilos = filtros.estilos.includes(e) ? filtros.estilos.filter((x) => x !== e) : [...filtros.estilos, e];
    // las cepas que quedan sin su tipo se van
    const cepas = filtros.cepas.filter((c) => vinos.some((v) => v.cepa === c && (!estilos.length || estilos.includes(estiloDe(v) as Estilo))));
    cambiarFiltros({ ...filtros, estilos, cepas });
  };
  const alternarTramo = (i: number) => {
    const t = TRAMOS_PRECIO[i];
    const activo = filtros.precioMin === t.min && filtros.precioMax === t.max;
    cambiarFiltros({ ...filtros, precioMin: activo ? null : t.min, precioMax: activo ? null : t.max });
  };
  const parecidos = (v: VinoCava) => {
    const estilo = estiloDe(v);
    // el mismo tipo y un precio parecido; la misma cepa solo si deja para elegir
    const base: Filtros = {
      ...filtros,
      estilos: estilo ? [estilo] : [],
      cepas: v.cepa ? [v.cepa] : [],
      precioMin: Math.round((v.precio * 0.65) / 500) * 500,
      precioMax: Math.round((v.precio * 1.35) / 500) * 500,
      soloPromo: false,
      texto: '',
    };
    const conCepa = ordenar(vinos, base, local, 'recomendar').length;
    cambiarFiltros(conCepa >= 7 ? base : { ...base, cepas: [] });
    setOrden('recomendar');
    setVistaMovil('cava');
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------- el somelier ----------
  async function preguntar(dicho: string, opciones: { entender?: boolean; incluir?: string; base?: Mensaje[] } = {}) {
    const limpio = dicho.trim();
    if (!limpio || pensando || !cava) return;
    // lo que dice el vendedor prende los filtros (y la cava se reordena ya)
    const f = opciones.entender === false ? filtros : sumarFiltros(filtros, interpretar(limpio, cepasConocidas));
    if (f !== filtros) cambiarFiltros(f);
    const candidatos = ordenar(vinos, f, local, 'recomendar').slice(0, CANDIDATOS).map((x) => x.vino.sku);
    if (opciones.incluir && !candidatos.includes(opciones.incluir)) candidatos.unshift(opciones.incluir);
    const busca = enPalabras(f);
    const historial: Mensaje[] = [...(opciones.base ?? mensajes).filter((m) => !m.error), { rol: 'usuario', texto: limpio }];
    setMensajes(historial);
    setTexto('');
    setPensando({ vistos: candidatos.length });
    try {
      const r = await fetch('/api/sommelier/vendedor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: historial.map(({ rol, texto }) => ({ rol, texto })),
          sucursal: local || undefined,
          candidatos,
          busca,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d?.message === 'string' ? d.message : `el servidor respondió ${r.status}`);
      setMensajes((m) => [...m, {
        rol: 'somelier',
        texto: String(d.respuesta ?? ''),
        vinos: Array.isArray(d.recomendaciones) && d.recomendaciones.length ? d.recomendaciones : undefined,
        introduccion: typeof d.introduccion === 'string' ? d.introduccion : undefined,
        cierre: typeof d.cierre === 'string' ? d.cierre : undefined,
        busca,
      }]);
    } catch (e: any) {
      setMensajes((m) => [...m, { rol: 'somelier', texto: e?.message ? `No pude contestar: ${e.message}.` : 'No pude contestar.', error: true }]);
    }
    setPensando(null);
  }

  // la pregunta que no tuvo respuesta vuelve a salir, sin quedar repetida
  const reintentar = () => {
    const sin = mensajes.filter((x) => !x.error);
    const ultimo = sin[sin.length - 1];
    if (!ultimo || ultimo.rol !== 'usuario') return;
    preguntar(ultimo.texto, { entender: false, base: sin.slice(0, -1) });
  };

  const empezarDeNuevo = () => {
    setMensajes([]);
    cambiarFiltros(SIN_FILTROS);
    setOrden('recomendar');
    setAbierto(null);
  };

  const alternarCliente = (sku: string) => setParaCliente((p) => (p.includes(sku) ? p.filter((x) => x !== sku) : [...p, sku]));
  const sumarAlCliente = (skus: string[]) => setParaCliente((p) => [...p, ...skus.filter((s) => !p.includes(s))]);

  const textoSeleccion = () => textoParaCliente(
    paraCliente.map((s) => porSku.get(s)).filter((v): v is VinoCava => !!v).map((v) => ({ ...v, porque: recomendados.get(v.sku)?.porque })),
  );

  // ---------- la pantalla ----------
  if (falloCava && !cava) {
    return (
      <Tarjeta className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-tinta/70">No pude traer la cava. Puede ser la conexión o que el sistema se esté actualizando.</p>
        <Boton variante="secundario" tamano="chico" onClick={() => setIntento((n) => n + 1)}>Volver a intentar</Boton>
      </Tarjeta>
    );
  }

  const enLaCava = cava ? (local ? vinos.filter((v) => (v.stock[local] ?? 0) > 0) : vinos) : [];

  return (
    <div className="space-y-5 sm:space-y-6">
      <LaCava
        cava={cava}
        enLaCava={enLaCava}
        local={local}
        nombreLocal={nombreLocal}
        filtros={filtros}
        onLocal={elegirLocal}
        onEstilo={alternarEstilo}
        onTramo={alternarTramo}
      />

      {/* en el celular: una cosa por vez */}
      <div className="flex gap-2 xl:hidden" aria-label="Ver el somelier o la cava">
        <Chip activo={vistaMovil === 'somelier'} onClick={() => setVistaMovil('somelier')}>El somelier</Chip>
        <Chip activo={vistaMovil === 'cava'} cuenta={cava ? lista.length : undefined} onClick={() => setVistaMovil('cava')}>La cava</Chip>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)] 2xl:gap-6">
        {/* ---------------- el somelier ---------------- */}
        <Tarjeta
          relleno={false}
          className={unir(
            'flex h-[calc(100dvh-9rem)] min-h-[30rem] flex-col overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)]',
            vistaMovil !== 'somelier' && 'max-xl:hidden',
          )}
        >
          <header className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-marca text-white" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="size-[1.1rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3h8l-.6 5.5a3.4 3.4 0 01-6.8 0zM12 12v8M8 21h8" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight text-tinta">El somelier</p>
              <p className="text-xs text-tinta/60">
                {!cava ? 'Abriendo la cava…'
                  : paraRecomendar.length === 0 ? 'Con estos filtros no queda ningún vino para elegir'
                  : paraRecomendar.length <= CANDIDATOS
                    ? <>Elige entre los <span className="importe">{miles(paraRecomendar.length)}</span> {paraRecomendar.length === 1 ? 'vino' : 'vinos'} de la lista{nombreLocal ? `, con stock en ${nombreLocal}` : ''}</>
                    : <>Elige entre los <span className="importe">{miles(CANDIDATOS)}</span> primeros de la lista{nombreLocal ? `, con stock en ${nombreLocal}` : ''}</>}
              </p>
            </div>
            {(mensajes.length > 0 || filtros !== SIN_FILTROS) && (
              <Boton variante="fantasma" tamano="chico" onClick={empezarDeNuevo} title="Borra la charla y los filtros">Otro cliente</Boton>
            )}
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {mensajes.length === 0 && (
              <Bienvenida
                listo={!!cava}
                onEjemplo={(t) => preguntar(t)}
              />
            )}
            {mensajes.map((m, i) => (
              <MensajeCharla
                key={i}
                m={m}
                porSku={porSku}
                local={local}
                sucursales={cava?.sucursales ?? []}
                paraCliente={paraCliente}
                onSumar={sumarAlCliente}
                onOtras={() => preguntar('Dame otras 3 opciones distintas de las que ya me diste.', { entender: false })}
                onReintentar={reintentar}
                onAbrir={(sku) => { setAbierto(sku); setVistaMovil('cava'); }}
              />
            ))}
            {pensando && (
              <div className="flex items-center gap-2 text-sm text-tinta/70">
                <Girador />
                Eligiendo entre {miles(pensando.vistos)} vinos{nombreLocal ? ` de ${nombreLocal}` : ''}…
              </div>
            )}
            <div ref={finCharla} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (texto.trim()) preguntar(texto);
              else preguntar(pedidoDeFiltros(filtros, nombreLocal), { entender: false });
            }}
            className="space-y-2.5 border-t border-black/[0.06] bg-crema-claro/60 p-3"
          >
            <LoQueBusca filtros={filtros} onCambiar={cambiarFiltros} />
            <div className="flex items-center gap-2">
              <Entrada
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Lo que pide el cliente: «un malbec para el asado, hasta 20 mil»"
                aria-label="Lo que pide el cliente"
                className="min-w-0 flex-1"
                disabled={!cava}
              />
              <BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Dictarle al somelier" />
            </div>
            <Boton type="submit" anchoCompleto disabled={!cava || !!pensando} cargando={!!pensando}>
              {texto.trim() ? 'Preguntarle al somelier' : 'Que elija el somelier'}
            </Boton>
          </form>
        </Tarjeta>

        {/* ---------------- la cava ---------------- */}
        <div ref={listaRef} className={unir('min-w-0 scroll-mt-4', vistaMovil !== 'cava' && 'max-xl:hidden')}>
          <Filtrar
            vinos={enLaCava}
            filtros={filtros}
            orden={orden}
            total={lista.length}
            listo={!!cava}
            onFiltros={cambiarFiltros}
            onOrden={(o) => { setOrden(o); setCuantos(DE_A); }}
          />

          {!cava ? (
            <ul className="mt-4 space-y-2" aria-label="Cargando la cava">
              {Array.from({ length: 8 }, (_, k) => <li key={k} className="h-14 animate-pulse rounded-xl bg-crema-hondo/70 motion-reduce:animate-none" />)}
            </ul>
          ) : (
            <>
              {recomendados.size > 0 && (
                <section aria-label="Lo que eligió el somelier" className="mt-4">
                  <p className={unir(ROTULO, 'mb-1.5')}>Eligió el somelier</p>
                  <ul className="overflow-hidden rounded-2xl border border-marca/25 bg-white">
                    {[...recomendados.keys()].map((sku) => {
                      const v = porSku.get(sku);
                      if (!v) return null;
                      return (
                        <FilaVino
                          key={sku}
                          v={v}
                          local={local}
                          sucursales={cava.sucursales}
                          recomendado={recomendados.get(sku)}
                          abierto={abierto === `r-${sku}`}
                          enCliente={paraCliente.includes(sku)}
                          onAbrir={() => setAbierto((a) => (a === `r-${sku}` ? null : `r-${sku}`))}
                          onCliente={() => alternarCliente(sku)}
                          onParecidos={() => parecidos(v)}
                          onPreguntar={() => { setVistaMovil('somelier'); preguntar(`¿Qué me decís del ${v.nombre}? ¿Con qué va y a quién le gusta?`, { entender: false, incluir: v.sku }); }}
                        />
                      );
                    })}
                  </ul>
                </section>
              )}

              {lista.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-black/15 px-5 py-10 text-center">
                  <p className="text-sm text-tinta">Con estos filtros no queda ningún vino{nombreLocal ? ` en ${nombreLocal}` : ''}.</p>
                  <p className="mt-1 text-sm text-tinta/60">Probá sacar alguno o mirar el otro local.</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Boton variante="secundario" tamano="chico" onClick={() => cambiarFiltros(SIN_FILTROS)}>Sacar los filtros</Boton>
                    {local && <Boton variante="secundario" tamano="chico" onClick={() => elegirLocal('')}>Ver los dos locales</Boton>}
                  </div>
                </div>
              ) : (
                <section aria-label="La cava" className="mt-4">
                  {recomendados.size > 0 && <p className={unir(ROTULO, 'mb-1.5')}>El resto de la cava con estos filtros</p>}
                  <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-tarjeta">
                    {resto.slice(0, cuantos).map((x) => (
                      <FilaVino
                        key={x.vino.sku}
                        v={x.vino}
                        local={local}
                        sucursales={cava.sucursales}
                        recomendado={recomendados.get(x.vino.sku)}
                        abierto={abierto === x.vino.sku}
                        enCliente={paraCliente.includes(x.vino.sku)}
                        onAbrir={() => setAbierto((a) => (a === x.vino.sku ? null : x.vino.sku))}
                        onCliente={() => alternarCliente(x.vino.sku)}
                        onParecidos={() => parecidos(x.vino)}
                        onPreguntar={() => { setVistaMovil('somelier'); preguntar(`¿Qué me decís del ${x.vino.nombre}? ¿Con qué va y a quién le gusta?`, { entender: false, incluir: x.vino.sku }); }}
                      />
                    ))}
                  </ul>
                  {resto.length > cuantos && (
                    <div className="mt-3 flex items-center justify-center gap-3 text-sm text-tinta/60">
                      <span className="importe">{miles(cuantos)} de {miles(resto.length)}</span>
                      <Boton variante="secundario" tamano="chico" onClick={() => setCuantos((n) => n + 50)}>Ver 50 más</Boton>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {paraCliente.length > 0 && (
            <div className="sticky bottom-20 z-contenido mt-4 lg:bottom-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-tinta px-4 py-3 text-white shadow-flotante">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Para el cliente: {paraCliente.length} {paraCliente.length === 1 ? 'vino' : 'vinos'}</p>
                  <p className="truncate text-xs text-white/70">{paraCliente.map((s) => porSku.get(s)?.nombre).filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setParaCliente([])} className={unir('min-h-9 rounded-full px-3 text-sm text-white/70 hover:text-white', FOCO)}>Vaciar</button>
                  <BotonCopiar texto={textoSeleccion} variante="primario">Copiar para WhatsApp</BotonCopiar>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Arriba: la cava del local, por tipo y por precio
// ------------------------------------------------------------
function LaCava({ cava, enLaCava, local, nombreLocal, filtros, onLocal, onEstilo, onTramo }: {
  cava: CavaPanel | null;
  enLaCava: VinoCava[];
  local: string;
  nombreLocal: string | null;
  filtros: Filtros;
  onLocal: (id: string) => void;
  onEstilo: (e: Estilo) => void;
  onTramo: (i: number) => void;
}) {
  const [encima, setEncima] = useState<string | null>(null);
  const porEstilo = useMemo(() => {
    const n = Object.fromEntries(ESTILOS.map((e) => [e.valor, 0])) as Record<Estilo, number>;
    for (const v of enLaCava) { const e = estiloDe(v); if (e) n[e]++; }
    return n;
  }, [enLaCava]);
  const porTramo = useMemo(() => {
    const n = TRAMOS_PRECIO.map(() => 0);
    for (const v of enLaCava) { const i = tramoDe(v.precio); if (i >= 0) n[i]++; }
    return n;
  }, [enLaCava]);
  const enPromo = enLaCava.filter((v) => v.promo).length;
  const precios = enLaCava.map((v) => v.precio);
  const topeTramo = Math.max(1, ...porTramo);
  const tramoActivo = TRAMOS_PRECIO.findIndex((t) => filtros.precioMin === t.min && filtros.precioMax === t.max);
  const cifra = 'importe mt-1 block text-3xl font-bold leading-none tracking-tight text-tinta sm:text-4xl';

  return (
    <section aria-label="La cava del local" className={unir('grid gap-x-10 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto] 2xl:gap-x-14', !cava && 'animate-pulse motion-reduce:animate-none')}>
      {/* cuántos hay y en qué local */}
      <div>
        <p className={ROTULO}>{nombreLocal ? `La cava de ${nombreLocal}` : 'La cava de los dos locales'}</p>
        <span className={cifra}>{cava ? miles(enLaCava.length) : '—'}</span>
        <span className="mt-1.5 block text-sm text-tinta/60">
          {cava ? <>vinos y espumantes con stock{enPromo ? <> · <span className="importe">{miles(enPromo)}</span> en promo</> : ''}</> : 'Abriendo la cava…'}
        </span>
        {cava && precios.length > 0 && (
          <span className="mt-0.5 block text-sm text-tinta/60">de <span className="importe">{pesos(Math.min(...precios))}</span> a <span className="importe">{pesos(Math.max(...precios))}</span></span>
        )}
        <div className="mt-3 inline-flex rounded-full bg-crema-hondo p-1" role="radiogroup" aria-label="Local del cliente">
          {[...(cava?.sucursales ?? []), { id: '', nombre: 'Los dos' }].map((s) => (
            <button
              key={s.id || 'los-dos'}
              type="button"
              role="radio"
              aria-checked={local === s.id}
              onClick={() => onLocal(s.id)}
              className={unir(
                'min-h-8 rounded-full px-3.5 text-sm font-medium transition-colors',
                local === s.id ? 'bg-white text-tinta shadow-tarjeta' : 'text-tinta/70 hover:text-tinta',
                FOCO,
              )}
            >
              {s.nombre}
            </button>
          ))}
        </div>
      </div>

      {/* por tipo: una barra partida y, debajo, los nombres con su número
          (en el celular no: ahí el tipo y el precio son filtros de la cava) */}
      <div className="hidden min-w-0 md:block">
        <p className={ROTULO}>Por tipo</p>
        <p className="mt-0.5 hidden text-sm text-tinta/60 sm:block">Tocá un tipo para quedarte con esos.</p>
        <div className="relative mt-3">
          <div className="flex h-8 gap-0.5" onMouseLeave={() => setEncima(null)}>
            {cava ? ESTILOS.map((e) => {
              const n = porEstilo[e.valor];
              if (!n) return null;
              const prendido = !filtros.estilos.length || filtros.estilos.includes(e.valor);
              return (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => onEstilo(e.valor)}
                  onMouseEnter={() => setEncima(e.valor)}
                  onFocus={() => setEncima(e.valor)}
                  onBlur={() => setEncima(null)}
                  aria-pressed={filtros.estilos.includes(e.valor)}
                  aria-label={`${e.plural}: ${miles(n)}`}
                  className={unir('h-full min-w-1.5 transition-[opacity,transform] first:rounded-l-md last:rounded-r-md hover:scale-y-110', prendido ? 'opacity-100' : 'opacity-25 hover:opacity-60', FOCO)}
                  style={{ flexGrow: n, flexBasis: 0, backgroundColor: COLOR[e.valor] }}
                />
              );
            }) : <div className="h-full w-full rounded-md bg-crema-hondo" />}
          </div>
          {encima && cava && (
            <p role="tooltip" className="pointer-events-none absolute -top-9 left-0 z-contenido w-max rounded-xl bg-tinta px-3 py-1.5 text-xs text-white shadow-flotante">
              {ESTILOS.find((e) => e.valor === encima)?.plural}: <span className="importe">{miles(porEstilo[encima as Estilo])}</span> ({Math.round((porEstilo[encima as Estilo] / Math.max(1, enLaCava.length)) * 100)} %)
            </p>
          )}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-1 gap-y-1">
          {ESTILOS.map((e) => {
            const activo = filtros.estilos.includes(e.valor);
            return (
              <li key={e.valor}>
                <button
                  type="button"
                  onClick={() => onEstilo(e.valor)}
                  aria-pressed={activo}
                  className={unir('flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-sm hover:bg-white', activo ? 'bg-white font-semibold text-tinta shadow-tarjeta' : 'text-tinta/70', FOCO)}
                >
                  <Punto color={COLOR[e.valor]} />
                  {e.plural}
                  <span className="importe text-tinta/60">{cava ? miles(porEstilo[e.valor]) : '—'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* por precio: cuántos hay en cada tramo */}
      <div className="hidden md:col-span-2 md:block xl:col-span-1">
        <p className={ROTULO}>Por precio</p>
        <p className="mt-0.5 hidden text-sm text-tinta/60 sm:block">Tocá un tramo para filtrar.</p>
        <div className="mt-2 flex items-end gap-1.5" style={{ height: '5rem' }}>
          {TRAMOS_PRECIO.map((t, i) => {
            const n = porTramo[i];
            const activo = tramoActivo === i;
            return (
              <button
                key={t.nombre}
                type="button"
                onClick={() => onTramo(i)}
                aria-pressed={activo}
                aria-label={`${t.nombre}: ${miles(n)} vinos`}
                className={unir('group flex h-full w-14 flex-col items-center justify-end gap-1 rounded-md 2xl:w-16', FOCO)}
              >
                <span className={unir('importe text-xs', activo ? 'font-bold text-tinta' : 'text-tinta/70')}>{cava ? miles(n) : ''}</span>
                <span
                  className={unir('w-full rounded-t-[4px] transition-colors', tramoActivo < 0 ? 'bg-tinta/70 group-hover:bg-tinta' : activo ? 'bg-tinta' : 'bg-tinta/20 group-hover:bg-tinta/50')}
                  style={{ height: cava ? `${Math.max(4, (n / topeTramo) * 48)}px` : '4px' }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1.5">
          {TRAMOS_PRECIO.map((t, i) => (
            <span key={t.nombre} className={unir('w-14 text-center text-xs leading-tight 2xl:w-16', tramoActivo === i ? 'font-semibold text-tinta' : 'text-tinta/60')}>{t.corto}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Los filtros de la cava: ocasión, tipo, cepa, precio, promo, buscar, orden
// ------------------------------------------------------------
function Filtrar({ vinos, filtros, orden, total, listo, onFiltros, onOrden }: {
  vinos: VinoCava[];
  filtros: Filtros;
  orden: Orden;
  total: number;
  listo: boolean;
  onFiltros: (f: Filtros) => void;
  onOrden: (o: Orden) => void;
}) {
  // las cepas del tipo elegido (o de todo), las que más hay primero
  const cepas = useMemo(() => {
    const n = new Map<string, number>();
    for (const v of vinos) {
      if (!v.cepa) continue;
      const e = estiloDe(v);
      if (filtros.estilos.length && (!e || !filtros.estilos.includes(e))) continue;
      n.set(v.cepa, (n.get(v.cepa) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [vinos, filtros.estilos]);
  const [todasLasCepas, setTodasLasCepas] = useState(false);
  // las elegidas siempre a la vista, aunque no estén entre las primeras
  const verCepas = todasLasCepas ? cepas : cepas.filter(([c], i) => i < 8 || filtros.cepas.includes(c));
  const hayPromo = vinos.some((v) => v.promo);
  const ocasion = (o: Ocasion) => onFiltros({ ...filtros, ocasion: filtros.ocasion === o ? null : o });
  const cepa = (c: string) => onFiltros({ ...filtros, cepas: filtros.cepas.includes(c) ? filtros.cepas.filter((x) => x !== c) : [...filtros.cepas, c] });
  const propio = rangoPrecio(filtros.precioMin, filtros.precioMax);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={ROTULO}>La cava para este cliente</p>
          <p className="mt-0.5 text-sm text-tinta/70">
            {listo ? <><span className="importe font-semibold text-tinta">{miles(total)}</span> {total === 1 ? 'vino' : 'vinos'}{enPalabras(filtros) ? ` · ${enPalabras(filtros)}` : ''}</> : 'Abriendo…'}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Entrada
            type="search"
            value={filtros.texto}
            onChange={(e) => onFiltros({ ...filtros, texto: e.target.value })}
            placeholder="Buscar por nombre o bodega"
            aria-label="Buscar en la cava por nombre o bodega"
            className="min-w-0 basis-full sm:w-64 sm:flex-none sm:basis-auto"
          />
          <Selector
            value={orden}
            onChange={(e) => onOrden(e.target.value as Orden)}
            aria-label="Ordenar la cava"
            opciones={[
              { valor: 'recomendar', etiqueta: 'Para recomendar' },
              { valor: 'barato', etiqueta: 'Más baratos' },
              { valor: 'caro', etiqueta: 'Más caros' },
              { valor: 'stock', etiqueta: 'Más stock' },
            ]}
            className="w-44"
          />
        </div>
      </div>

      <FilaFiltro titulo="Para qué">
        {OCASIONES.map((o) => (
          <Pastilla key={o.valor} activo={filtros.ocasion === o.valor} onClick={() => ocasion(o.valor)}>{o.nombre}</Pastilla>
        ))}
      </FilaFiltro>

      {/* en el celular los gráficos de arriba no están: el tipo y el precio van acá */}
      <div className="space-y-3 md:hidden">
        <FilaFiltro titulo="Tipo">
          {ESTILOS.map((e) => {
            const n = vinos.filter((v) => estiloDe(v) === e.valor).length;
            const activo = filtros.estilos.includes(e.valor);
            return (
              <Pastilla key={e.valor} activo={activo} cuenta={n} onClick={() => onFiltros({ ...filtros, estilos: activo ? filtros.estilos.filter((x) => x !== e.valor) : [...filtros.estilos, e.valor], cepas: [] })}>
                <Punto color={COLOR[e.valor]} className="size-2" />
                {e.plural}
              </Pastilla>
            );
          })}
        </FilaFiltro>
        <FilaFiltro titulo="Precio">
          {TRAMOS_PRECIO.map((t) => {
            const activo = filtros.precioMin === t.min && filtros.precioMax === t.max;
            return (
              <Pastilla key={t.nombre} activo={activo} onClick={() => onFiltros({ ...filtros, precioMin: activo ? null : t.min, precioMax: activo ? null : t.max })}>{t.nombre}</Pastilla>
            );
          })}
        </FilaFiltro>
      </div>

      <FilaFiltro titulo="Cepa">
        {verCepas.map(([c, n]) => (
          <Pastilla key={c} activo={filtros.cepas.includes(c)} cuenta={n} onClick={() => cepa(c)}>{c}</Pastilla>
        ))}
        {cepas.length > 8 && (
          <button type="button" onClick={() => setTodasLasCepas((x) => !x)} className={unir('min-h-8 shrink-0 whitespace-nowrap rounded-full px-2 text-sm text-tinta/70 underline-offset-2 hover:text-tinta hover:underline', FOCO)}>
            {todasLasCepas ? 'Menos' : `Ver ${cepas.length - 8} más`}
          </button>
        )}
      </FilaFiltro>

      {/* el precio se elige en el gráfico de arriba; acá queda el que esté puesto y la promo */}
      {(propio || hayPromo) && (
        <div className="hidden md:block">
        <FilaFiltro titulo="Precio">
          {propio && (
            <Pastilla activo onClick={() => onFiltros({ ...filtros, precioMin: null, precioMax: null })} aria-label={`Sacar el precio: ${propio}`}>
              {propio[0].toUpperCase() + propio.slice(1)}
              <IconoCerrar className="size-3.5" />
            </Pastilla>
          )}
          {hayPromo && <Pastilla activo={filtros.soloPromo} onClick={() => onFiltros({ ...filtros, soloPromo: !filtros.soloPromo })}>Solo en promo</Pastilla>}
        </FilaFiltro>
        </div>
      )}
    </div>
  );
}

/** Una fila de filtros: en el celular, una sola línea que se desliza de costado. */
function FilaFiltro({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 sm:flex sm:items-start sm:gap-3">
      <p className={unir(ROTULO, 'mb-1 sm:mb-0 sm:w-[4.75rem] sm:shrink-0 sm:whitespace-nowrap sm:pt-2')}>{titulo}</p>
      <div className="-mx-4 flex min-w-0 items-start gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">{children}</div>
    </div>
  );
}

/** Un filtro chico (los Chip del kit miden 36 px: acá van muchos juntos). */
function Pastilla({ activo, cuenta, children, className, ...resto }: { activo: boolean; cuenta?: number; children: ReactNode } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      className={unir(
        'inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors',
        activo ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta/80 hover:border-black/25 hover:text-tinta',
        FOCO,
        className,
      )}
      {...resto}
    >
      {children}
      {cuenta != null && <span className={unir('importe text-xs', activo ? 'text-white/70' : 'text-tinta/60')}>{miles(cuenta)}</span>}
    </button>
  );
}

// ------------------------------------------------------------
// Un vino de la cava: el renglón y, al tocarlo, su ficha
// ------------------------------------------------------------
function FilaVino({ v, local, sucursales, recomendado, abierto, enCliente, onAbrir, onCliente, onParecidos, onPreguntar }: {
  v: VinoCava;
  local: string;
  sucursales: { id: string; nombre: string }[];
  recomendado?: { puesto: number; porque: string };
  abierto: boolean;
  enCliente: boolean;
  onAbrir: () => void;
  onCliente: () => void;
  onParecidos: () => void;
  onPreguntar: () => void;
}) {
  const estilo = estiloDe(v);
  const { aca, otro } = stockDe(v, local);
  const nombreAca = sucursales.find((s) => s.id === local)?.nombre;
  const otros = sucursales.filter((s) => s.id !== local && (v.stock[s.id] ?? 0) > 0);
  const efectivo = v.precioEfectivo != null && v.precioEfectivo < v.precio ? v.precioEfectivo : null;
  const linea = [v.bodega, v.cepa ?? (estilo ? ESTILOS.find((e) => e.valor === estilo)?.nombre : v.categoria)].filter(Boolean).join(' · ');

  return (
    <li className={unir(abierto && 'bg-crema-claro/70')}>
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <input
          type="checkbox"
          checked={enCliente}
          onChange={onCliente}
          aria-label={`Sumar ${v.nombre} a lo que se le pasa al cliente`}
          title="Para el cliente"
          className="size-4.5 shrink-0 cursor-pointer accent-marca"
        />
        <button type="button" onClick={onAbrir} aria-expanded={abierto} className={unir('flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left', FOCO)}>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {estilo && <Punto color={COLOR[estilo]} />}
              <span className="truncate text-sm font-semibold text-tinta">{v.nombre}</span>
              {recomendado && <span className="shrink-0 rounded-full bg-marca px-2 text-xs font-semibold leading-5 text-white">Elegido {recomendado.puesto}</span>}
              {v.promo && <Etiqueta tono="ok" className="hidden shrink-0 sm:inline-flex">Promo</Etiqueta>}
            </span>
            <span className="mt-0.5 block truncate text-xs text-tinta/60">
              {linea}
              {recomendado?.porque ? <span className="text-tinta/70"> · {recomendado.porque}</span> : v.descripcion ? <span className="hidden xl:inline"> · {v.descripcion}</span> : null}
            </span>
          </span>
          <span className="hidden w-24 shrink-0 text-right sm:block">
            <span className="importe block text-sm font-semibold text-tinta">{miles(aca)}</span>
            <span className="block truncate text-xs text-tinta/60">
              {local ? (otro > 0 ? `+${miles(otro)} en ${nombreCorto(otros[0]?.nombre ?? 'el otro')}` : `en ${nombreCorto(nombreAca ?? '')}`) : 'en los dos'}
            </span>
          </span>
          <span className="w-28 shrink-0 text-right">
            {v.promo && v.promo.antes > v.precio && <s className="importe mr-1 text-xs text-tinta/60">{pesos(v.promo.antes)}</s>}
            <span className="importe block text-sm font-semibold text-tinta">{pesos(v.precio)}</span>
            {efectivo != null && <span className="importe block text-xs font-medium text-marca-hondo">{pesos(efectivo)} efect.</span>}
          </span>
        </button>
      </div>

      {abierto && (
        <div className="grid gap-4 border-t border-black/[0.06] px-4 py-4 sm:pl-11 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-2 text-sm">
            {recomendado?.porque && <p className="text-tinta"><span className="font-semibold">Por qué lo eligió: </span>{recomendado.porque}</p>}
            {v.descripcion && <p className="text-tinta/80">{v.descripcion}</p>}
            {v.maridaje && <p className="text-tinta/80"><span className="font-semibold text-tinta">Va con: </span>{v.maridaje}</p>}
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-tinta/60">
              {sucursales.map((s) => (
                <div key={s.id}><dt className="inline">{s.nombre}: </dt><dd className="importe inline font-semibold text-tinta">{miles(v.stock[s.id] ?? 0)}</dd></div>
              ))}
              {v.promo && <div><dt className="inline">Promo: </dt><dd className="inline font-semibold text-tinta">{v.promo.nombre}</dd></div>}
              {efectivo != null && <div><dt className="inline">Efectivo o transferencia: </dt><dd className="importe inline font-semibold text-marca-hondo">{pesos(efectivo)}</dd></div>}
              <div><dt className="inline">{v.categoria ?? 'Sin categoría'} · </dt><dd className="inline">{v.sku}</dd></div>
            </dl>
          </div>
          <div className="flex flex-wrap content-start gap-2 lg:w-60 lg:flex-col lg:items-stretch">
            <Boton tamano="chico" variante={enCliente ? 'secundario' : 'primario'} onClick={onCliente}>
              {enCliente ? 'Sacar de «Para el cliente»' : 'Sumar para el cliente'}
            </Boton>
            <BotonCopiar texto={() => textoParaCliente([{ ...v, porque: recomendado?.porque }])}>Copiar para WhatsApp</BotonCopiar>
            <Boton tamano="chico" variante="secundario" onClick={onPreguntar}>Preguntarle al somelier</Boton>
            <Boton tamano="chico" variante="secundario" onClick={onParecidos}>Ver parecidos</Boton>
            <Link href={`/inventario?sku=${encodeURIComponent(v.sku)}`} className={unir('inline-flex min-h-8 items-center justify-center rounded-full px-3 text-sm text-tinta/70 hover:text-tinta hover:underline', FOCO)}>
              Ver en Inventario →
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------
// La charla
// ------------------------------------------------------------
const EJEMPLOS = [
  'Un malbec para el asado, hasta 20 mil',
  'Algo para sushi',
  'Un espumante para regalar',
  'Un blanco fresco hasta 12 mil',
  'Tinto para pastas, que esté en promo',
];

function Bienvenida({ listo, onEjemplo }: { listo: boolean; onEjemplo: (t: string) => void }) {
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-tinta">
        Escribí o dictá lo que pide el cliente, o elegí en la cava<span className="hidden xl:inline"> de la derecha</span> y tocá <span className="font-semibold">Que elija el somelier</span>. Te da tres opciones con el porqué para decírselo.
      </p>
      <p className={ROTULO}>Por ejemplo</p>
      <div className="flex flex-wrap gap-1.5">
        {EJEMPLOS.map((e) => (
          <Chip key={e} disabled={!listo} onClick={() => onEjemplo(e)}>{e}</Chip>
        ))}
      </div>
    </div>
  );
}

function Burbuja({ rol, error, children, className }: { rol: Mensaje['rol']; error?: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={unir(
        'max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
        rol === 'usuario' ? 'self-end rounded-br-md bg-tinta text-white' : error ? 'rounded-bl-md bg-marca-suave text-marca-hondo' : 'rounded-bl-md bg-crema text-tinta',
        className,
      )}
    >
      {children}
    </div>
  );
}

function MensajeCharla({ m, porSku, local, sucursales, paraCliente, onSumar, onOtras, onReintentar, onAbrir }: {
  m: Mensaje;
  porSku: Map<string, VinoCava>;
  local: string;
  sucursales: { id: string; nombre: string }[];
  paraCliente: string[];
  onSumar: (skus: string[]) => void;
  onOtras: () => void;
  onReintentar: () => void;
  onAbrir: (sku: string) => void;
}) {
  if (m.rol === 'usuario') return <div className="flex flex-col"><Burbuja rol="usuario">{m.texto}</Burbuja></div>;
  if (m.error) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Burbuja rol="somelier" error>{m.texto}</Burbuja>
        <Boton variante="secundario" tamano="chico" onClick={onReintentar}>Volver a intentar</Boton>
      </div>
    );
  }
  const vinos = m.vinos ?? [];
  const arriba = vinos.length ? m.introduccion ?? '' : m.texto;
  const todosSumados = vinos.length > 0 && vinos.every((v) => paraCliente.includes(v.sku));
  const nombreAca = sucursales.find((s) => s.id === local)?.nombre;
  return (
    <div className="flex flex-col items-start gap-2">
      {arriba && <Burbuja rol="somelier">{arriba}</Burbuja>}
      {vinos.length > 0 && (
        <PlacaRoja
          className="w-full"
          titulo="Recomendados"
          sub={m.busca || `${vinos.length} de la cava`}
          renglones={vinos.map((v, i) => {
            const c = porSku.get(v.sku);
            const aca = c ? stockDe(c, local).aca : null;
            const efectivo = v.precioEfectivo != null && v.precioEfectivo < v.precio ? v.precioEfectivo : null;
            const antes = v.promo && v.promo.antes > v.precio ? v.promo.antes : null;
            return {
              clave: v.sku,
              cantidad: i + 1,
              nombre: (
                <button type="button" onClick={() => onAbrir(v.sku)} className={unir('text-left hover:underline', FOCO)}>{v.nombre}</button>
              ),
              detalle: (
                <>
                  {v.porque && <span className="block">{v.porque}</span>}
                  <span className="block text-tinta/60">
                    {aca != null ? `${miles(aca)} en ${nombreAca ?? 'los locales'}` : ''}
                    {v.promo ? ` · promo «${v.promo.nombre}»` : ''}
                  </span>
                </>
              ),
              destacado: efectivo != null ? `${pesos(efectivo)} en efectivo o transferencia` : undefined,
              importe: antes != null ? (
                <>
                  <s className="mr-1.5 text-sm font-semibold text-tinta/60"><span className="sr-only">Antes </span>{pesos(antes)}</s>
                  <span className="sr-only">, ahora </span>{pesos(v.precio)}
                </>
              ) : pesos(v.precio),
            };
          })}
          acciones={
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              <BotonCopiar texto={() => textoParaCliente(vinos)} variante="primario">Copiar para WhatsApp</BotonCopiar>
              <Boton tamano="chico" variante="secundario" disabled={todosSumados} onClick={() => onSumar(vinos.map((v) => v.sku))}>
                {todosSumados ? 'Ya están para el cliente' : 'Sumar para el cliente'}
              </Boton>
              <Boton tamano="chico" variante="secundario" onClick={onOtras}>Otras 3</Boton>
            </div>
          }
        />
      )}
      {vinos.length > 0 && m.cierre && <Burbuja rol="somelier">{m.cierre}</Burbuja>}
    </div>
  );
}

/** Lo que busca el cliente, en chips que se sacan de a uno. */
function LoQueBusca({ filtros, onCambiar }: { filtros: Filtros; onCambiar: (f: Filtros) => void }) {
  const partes: { clave: string; texto: string; sacar: () => Filtros }[] = [];
  const o = OCASIONES.find((x) => x.valor === filtros.ocasion);
  if (o) partes.push({ clave: 'ocasion', texto: o.nombre, sacar: () => ({ ...filtros, ocasion: null }) });
  for (const e of filtros.estilos) partes.push({ clave: `e-${e}`, texto: ESTILOS.find((x) => x.valor === e)?.nombre ?? e, sacar: () => ({ ...filtros, estilos: filtros.estilos.filter((x) => x !== e) }) });
  for (const c of filtros.cepas) partes.push({ clave: `c-${c}`, texto: c, sacar: () => ({ ...filtros, cepas: filtros.cepas.filter((x) => x !== c) }) });
  const r = rangoPrecio(filtros.precioMin, filtros.precioMax);
  if (r) partes.push({ clave: 'precio', texto: r[0].toUpperCase() + r.slice(1), sacar: () => ({ ...filtros, precioMin: null, precioMax: null }) });
  if (filtros.soloPromo) partes.push({ clave: 'promo', texto: 'En promo', sacar: () => ({ ...filtros, soloPromo: false }) });
  if (filtros.texto.trim()) partes.push({ clave: 'texto', texto: `«${filtros.texto.trim()}»`, sacar: () => ({ ...filtros, texto: '' }) });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-tinta/70">Busca:</span>
      {partes.length === 0 ? (
        <span className="text-xs text-tinta/60">todavía nada (el somelier elige variado)</span>
      ) : (
        <>
          {partes.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => onCambiar(p.sacar())}
              aria-label={`Sacar «${p.texto}»`}
              className={unir('inline-flex min-h-7 items-center gap-1 rounded-full border border-black/15 bg-white pl-2.5 pr-1.5 text-xs font-medium text-tinta hover:border-black/30', FOCO)}
            >
              {p.texto}
              <IconoCerrar className="size-3.5 text-tinta/60" />
            </button>
          ))}
          <button type="button" onClick={() => onCambiar(SIN_FILTROS)} className={unir('min-h-7 rounded-full px-1.5 text-xs text-tinta/60 hover:text-tinta hover:underline', FOCO)}>
            Limpiar
          </button>
        </>
      )}
    </div>
  );
}

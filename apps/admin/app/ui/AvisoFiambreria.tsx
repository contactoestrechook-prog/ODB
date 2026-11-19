'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cantidadLegible, haceCuanto } from '../lib/pedidos';
import { llevaFlotantes } from '../lib/rutas';
import { alCambiarAudio, audioActivo, esperaDe, nivelDe, prepararAudio, sonarAlarma } from '../lib/alarma-pedido';
import { Boton, FOCO, IconoCerrar, unir } from './kit';
import { pesos } from '../lib/formato';
import { FaltaEnGondola, cantidadDe, type Reemplazo } from './FaltaEnGondola';

// PEDIDO CON FIAMBRERÍA (Leandro, 19/11/2026: «que a las cajas les salga el pop
// up cada vez que hay un pedido, también a fiambrería si es que hay algo de
// fiambrería, así lo preparan»). Al celular de fiambrería le salta la ventana
// de cada pedido abierto que trae Fiambres, Quesos o Chacinados, con SOLO eso
// para preparar, suena y vibra. «Lo preparo» la cierra para toda fiambrería y
// deja el nombre; no toma el pedido entero (el resto lo sigue la caja).
//
// «No hay» (Leandro, 19/11/2026: «sí, sumalo»): cada renglón se corrige si en
// la heladera no hay (queda lo que hay, sale o va otro en su lugar), como en el
// armado. Como lo que falta se descubre al cortar, el pedido que tomaste sigue
// en la ventana, en verde («Lo estás preparando»), sin sonar, hasta «Listo».

type Parte = {
  id: string; codigo: string; creadoEn: string; canal: string; cliente: string | null; envio: string | null; notas: string | null;
  items: { productoId: string | null; cantidad: number; nombre: string; sku: string | null; porPeso: boolean }[]; otros: number;
  /** lo tomé yo («Lo preparo»): no suena, y se corrige hasta «Listo» */
  mio?: boolean;
};

const CADA_MS = 12_000;
const POSPONER_MS = 10 * 60_000;
const CLAVE_POSPUESTOS = 'odb_fiambreria_pospuestos';
const leer = (): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(CLAVE_POSPUESTOS) ?? '{}') ?? {}; } catch { return {}; } };
const guardar = (v: Record<string, number>) => { try { sessionStorage.setItem(CLAVE_POSPUESTOS, JSON.stringify(v)); } catch { /* modo privado */ } };
// «Listo»: el pedido que preparé ya no se muestra en este celular
const CLAVE_LISTOS = 'odb_fiambreria_listos';
const leerListos = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(CLAVE_LISTOS) ?? '{}') ?? {}; } catch { return {}; } };
const guardarListos = (v: Record<string, number>) => {
  // lo de más de dos días se borra solo
  const limpio = Object.fromEntries(Object.entries(v).filter(([, t]) => t > Date.now() - 2 * 86_400_000));
  try { localStorage.setItem(CLAVE_LISTOS, JSON.stringify(limpio)); } catch { /* modo privado */ }
  return limpio;
};

/** Cantidad para leer de lejos: lo pesado en gramos o kilos, lo demás en unidades. */
function cuanto(it: Parte['items'][number]) {
  if (!it.porPeso) return `${cantidadLegible(it.cantidad)} ×`;
  return it.cantidad < 1 ? `${Math.round(it.cantidad * 1000)} g` : `${cantidadLegible(it.cantidad)} kg`;
}

export function AvisoFiambreria() {
  const ruta = usePathname();
  const [partes, setPartes] = useState<Parte[]>([]);
  const [pospuestos, setPospuestos] = useState<Record<string, number>>({});
  const [listos, setListos] = useState<Record<string, number>>({});
  const [falta, setFalta] = useState<{ pedido: Parte; item: Parte['items'][number] } | null>(null);
  const [tomando, setTomando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; ok: boolean } | null>(null);
  const [sinSonido, setSinSonido] = useState(false);
  const [, setReloj] = useState(0);
  const apagado = useRef(false);
  const vistos = useRef<Set<string>>(new Set());

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      const r = await fetch('/api/salon?recurso=fiambreria', { cache: 'no-store' });
      if (r.status === 403) { apagado.current = true; setPartes([]); return; }
      if (!r.ok) return;
      const lista = await r.json();
      if (!Array.isArray(lista)) return;
      // vibra una vez por pedido nuevo (los que ya tomé no)
      const nuevos = (lista as Parte[]).filter((p) => !p.mio && !vistos.current.has(p.id));
      for (const p of lista as Parte[]) vistos.current.add(p.id);
      if (nuevos.length) { try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* sin vibración */ } }
      setPartes(lista as Parte[]);
    } catch { /* sin red: la próxima vuelta */ }
  }, []);

  useEffect(() => {
    setPospuestos(leer());
    setListos(leerListos());
    prepararAudio();
    setSinSonido(!audioActivo());
    const dejarDeOir = alCambiarAudio(() => setSinSonido(!audioActivo()));
    const despertar = () => prepararAudio();
    window.addEventListener('pointerdown', despertar);
    mirar();
    const t = setInterval(mirar, CADA_MS);
    const r = setInterval(() => setReloj((n) => n + 1), 30_000);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t); clearInterval(r); dejarDeOir();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('pointerdown', despertar);
    };
  }, [mirar]);

  const ahora = Date.now();
  const visibles = partes.filter((p) => !(pospuestos[p.id] && pospuestos[p.id] > ahora) && !(p.mio && listos[p.id]));
  // primero lo que nadie tomó (suena); después lo que estoy preparando
  const porTomar = visibles.filter((p) => !p.mio);
  const ordenados = [...porTomar, ...visibles.filter((p) => p.mio)];

  // suena hasta que alguien de fiambrería lo toma, y crece con el tiempo (como la caja)
  const suenaDesde = porTomar.length && llevaFlotantes(ruta) && !falta ? Math.min(...porTomar.map((p) => Date.parse(p.creadoEn))) : null;
  useEffect(() => {
    if (suenaDesde === null) return;
    let t: ReturnType<typeof setTimeout>;
    const tocar = () => {
      const nivel = nivelDe(Date.now() - suenaDesde);
      sonarAlarma(nivel);
      t = setTimeout(tocar, esperaDe(nivel));
    };
    tocar();
    return () => clearTimeout(t);
  }, [suenaDesde]);

  async function preparo(p: Parte) {
    setTomando(p.id);
    try {
      const r = await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'fiambreria-preparo', pedidoId: p.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMensaje({ texto: d?.message ?? 'No se pudo. Probá de nuevo.', ok: false }); return; }
      // lo tomé: queda en la ventana como «Lo estás preparando» (si al cortar falta algo, «No hay»)
      setPartes((xs) => (d?.tomado ? xs.map((x) => (x.id === p.id ? { ...x, mio: true } : x)) : xs.filter((x) => x.id !== p.id)));
      setMensaje(d?.tomado
        ? { texto: `Listo: lo de fiambrería del pedido ${p.codigo} queda a tu nombre.`, ok: true }
        : { texto: `Lo de fiambrería del pedido ${p.codigo} ya lo tomó ${d?.nombre ?? 'otra persona'}.`, ok: false });
      setTimeout(() => setMensaje(null), 5000);
    } catch {
      setMensaje({ texto: 'Sin conexión. Probá de nuevo.', ok: false });
    } finally {
      setTomando(null);
    }
  }

  function terminado(p: Parte) {
    setListos(guardarListos({ ...leerListos(), [p.id]: Date.now() }));
    setMensaje({ texto: `Lo de fiambrería del pedido ${p.codigo} quedó listo.`, ok: true });
    setTimeout(() => setMensaje(null), 4000);
  }

  // «No hay»: queda lo que hay, sale del pedido o va otro en su lugar
  async function corregir(p: Parte, it: Parte['items'][number], d: { hay: number; reemplazo: Reemplazo | null; cantidad: number | null }) {
    const r = await fetch('/api/salon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'fiambreria-falta', pedidoId: p.id, productoId: it.productoId, hay: d.hay, reemplazoId: d.reemplazo?.id ?? null, cantidad: d.reemplazo ? d.cantidad : null }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res?.message ?? 'No se pudo cambiar el pedido');
    setFalta(null);
    const partesTexto = [d.hay > 0 ? `${it.nombre}: quedan ${cantidadDe(d.hay, it.porPeso)}` : `${it.nombre} salió del pedido`];
    if (res?.puso) partesTexto.push(`va ${cantidadDe(Number(res.puso.cantidad), it.porPeso)} de ${res.puso.nombre}`);
    if (res?.totalAntes != null && res?.total != null && Number(res.totalAntes) !== Number(res.total)) partesTexto.push(`total ${pesos(res.totalAntes)} → ${pesos(res.total)}`);
    if (res?.pagado) partesTexto.push('ya estaba pagado: avisale a la caja la diferencia');
    setMensaje({ texto: partesTexto.join(' · '), ok: !res?.pagado });
    setTimeout(() => setMensaje(null), res?.pagado ? 15000 : 7000);
    await mirar();
  }

  function posponer(p: Parte) {
    const v = { ...leer(), [p.id]: Date.now() + POSPONER_MS };
    guardar(v);
    setPospuestos(v);
  }

  // corrigiendo: la ventana se corre (la de «No hay» va por debajo de los avisos)
  if (falta) {
    return (
      <FaltaEnGondola
        item={{ productoId: String(falta.item.productoId), nombre: falta.item.nombre, cantidad: falta.item.cantidad, enCarro: 0, ubicacion: null, porPeso: falta.item.porPeso }}
        onCerrar={() => setFalta(null)}
        onListo={(d) => corregir(falta.pedido, falta.item, d)}
      />
    );
  }

  if (!llevaFlotantes(ruta) || (!visibles.length && !mensaje)) return null;
  const [primero] = ordenados;

  // 19/11/2026, Leandro: «en fiambrería se buguea y no pueden salir de esa
  // pantalla». En el celular la ventana es fija: con muchos renglones y una
  // nota larga quedaba más alta que la pantalla, «Lo preparo» y la cruz
  // caían abajo del borde y no había cómo llegar (lo fijo no se desplaza), y
  // arriba la tapaba la barra del iPhone. Ahora mide como mucho la pantalla:
  // la lista y la nota se desplazan adentro, los botones quedan siempre a la
  // vista y la cruz también está arriba.
  return (
    <div aria-live="polite" className="fixed inset-x-0 top-0 z-aviso flex max-h-[100dvh] flex-col gap-2 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-auto lg:max-h-[calc(100dvh-2rem)] lg:w-[22rem] lg:px-0 lg:pb-0 lg:pt-0">
      {mensaje && (
        <div role="status" className={unir('animate-entra-aviso shrink-0 rounded-2xl px-4 py-3 text-sm shadow-flotante motion-reduce:animate-none', mensaje.ok ? 'bg-ok text-white' : 'bg-tinta text-white')}>
          {mensaje.texto}
        </div>
      )}
      {primero && (
        <section aria-label={`Pedido con fiambrería ${primero.codigo}`} className="animate-entra-aviso flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none">
          <div className={unir('flex shrink-0 items-center justify-between gap-2 py-1 pl-4 pr-1 text-white', primero.mio ? 'bg-ok' : 'bg-marca')}>
            <p className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                {!primero.mio && <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />}
                <span className="relative inline-flex size-2.5 rounded-full bg-white" />
              </span>
              <span className="truncate">{primero.mio ? 'Lo estás preparando' : 'Pedido con fiambrería'}</span>
            </p>
            <span className="flex shrink-0 items-center gap-1">
              <span className="importe text-xs text-white/80">{haceCuanto(primero.creadoEn)}</span>
              <button
                type="button"
                onClick={() => posponer(primero)}
                aria-label={`Esconder y callar el pedido ${primero.codigo} 10 minutos`}
                title="Esconder y callar 10 minutos"
                className={unir('flex size-10 items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white', FOCO)}
              >
                <IconoCerrar className="size-5" />
              </button>
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
            <p className="min-w-0 break-words text-sm text-tinta">
              <span className="importe font-bold">{primero.codigo}</span>
              {primero.cliente && <span> · {primero.cliente}</span>}
            </p>
            <p className="text-sm text-tinta/70">{primero.envio ? `Envío a ${primero.envio}` : 'Retira en el local'}</p>
            <ul className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
              {primero.items.map((it, i) => (
                <li key={it.productoId ?? i} className="flex min-w-0 items-center gap-3 py-1.5">
                  <span className="importe w-16 shrink-0 text-right text-base font-bold text-marca">{cuanto(it)}</span>
                  <span className="min-w-0 flex-1 break-words text-base text-tinta">{it.nombre}</span>
                  {it.productoId && (
                    <button
                      type="button"
                      onClick={() => setFalta({ pedido: primero, item: it })}
                      aria-label={`No hay ${it.nombre}: corregir el pedido`}
                      className={unir('shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-tinta/70 hover:bg-crema-claro hover:text-tinta', FOCO)}
                    >
                      No hay
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {primero.otros > 0 && (
              <p className="text-xs text-tinta/60">{primero.otros === 1 ? 'El pedido trae 1 producto más' : `El pedido trae ${primero.otros} productos más`}: lo arma la caja.</p>
            )}
            {primero.notas && <p className="break-words rounded-xl bg-crema-claro px-3 py-2 text-sm text-tinta">{primero.notas}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.06] px-4 py-3">
            {primero.mio
              ? <Boton variante="ok" onClick={() => terminado(primero)} className="flex-1">Listo, ya está</Boton>
              : <Boton onClick={() => preparo(primero)} cargando={tomando === primero.id} className="flex-1">Lo preparo</Boton>}
            <button
              type="button"
              onClick={() => posponer(primero)}
              aria-label={`Esconder y callar el pedido ${primero.codigo} 10 minutos`}
              title="Esconder y callar 10 minutos"
              className={unir('flex size-10 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-crema-claro hover:text-tinta', FOCO)}
            >
              <IconoCerrar className="size-5" />
            </button>
          </div>
          {sinSonido && (
            <p role="alert" className="shrink-0 bg-marca-suave px-4 py-2 text-xs font-semibold text-marca-hondo">
              No está sonando: tocá cualquier parte de la pantalla una vez para activar la alarma.
            </p>
          )}
          {visibles.length > 1 && (
            <p className="shrink-0 bg-tinta px-4 py-2 text-center text-xs font-semibold text-white">
              {visibles.length === 2 ? 'Y 1 pedido más con fiambrería' : `Y ${visibles.length - 1} pedidos más con fiambrería`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pesos } from '../lib/formato';
import { cantidadLegible, codigoDe, entregaDe, haceCuanto, origenDe, sinTomar, telefonoLegible, type PedidoCola } from '../lib/pedidos';
import { llevaFlotantes } from '../lib/rutas';
import { Boton, Etiqueta, FOCO, IconoCerrar, unir } from './kit';

// LLEGÓ UN PEDIDO (Leandro, 6/10/2026: "necesito ventanas slides emergentes
// avisando que llegó un pedido"). En todas las pantallas del panel, a quien
// puede atender pedidos, aparece una ventana que se desliza con el pedido que
// nadie tomó todavía, con sonido. Queda hasta que alguien toca "Lo tomo" (queda
// su nombre en el pedido) y entonces se va para todos. "Más tarde" la esconde
// 10 minutos en esta pantalla, nada más: el pedido sigue sin tomar y a los 15
// minutos sale el reclamo por WhatsApp a administración.

const CADA_MS = 12_000;
const POSPONER_MS = 10 * 60_000;
// los de más de 48 h no saltan (van con "Sin tomar" en Pedidos); suena solo lo de la última media hora
const VENTANA_MS = 48 * 3600_000;
const SUENA_MS = 30 * 60_000;
const CLAVE_VISTOS = 'odb_pedidos_vistos';
const CLAVE_POSPUESTOS = 'odb_pedidos_pospuestos';

const leer = (clave: string): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem(clave) ?? '{}') ?? {}; } catch { return {}; }
};
const guardar = (clave: string, v: Record<string, number>) => {
  try { sessionStorage.setItem(clave, JSON.stringify(v)); } catch { /* modo privado */ }
};

// Dos notas cortas (no un pitido): se oye en el local sin asustar a nadie. El
// navegador no deja sonar nada hasta que la persona tocó algo en la página; el
// contexto de audio se crea con ese primer toque.
let audio: AudioContext | null = null;
function prepararAudio() {
  if (audio || typeof window === 'undefined') return;
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (Ctx) audio = new Ctx();
}
function sonar() {
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => null);
  const t0 = audio.currentTime + 0.02;
  [[880, 0], [1318.5, 0.2]].forEach(([frec, desde]) => {
    const osc = audio!.createOscillator();
    const vol = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = frec;
    vol.gain.setValueAtTime(0.0001, t0 + desde);
    vol.gain.exponentialRampToValueAtTime(0.22, t0 + desde + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + desde + 0.36);
    osc.connect(vol).connect(audio!.destination);
    osc.start(t0 + desde);
    osc.stop(t0 + desde + 0.4);
  });
}

type Resultado = { id: string; texto: string; tono: 'ok' | 'neutro' };

export function AvisoPedidoNuevo() {
  const ruta = usePathname();
  const [pedidos, setPedidos] = useState<PedidoCola[]>([]);
  const [pospuestos, setPospuestos] = useState<Record<string, number>>({});
  const [tomando, setTomando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permisoNotif, setPermisoNotif] = useState<string>('granted');
  const [, setReloj] = useState(0);
  const apagado = useRef(false);
  const tituloOriginal = useRef<string | null>(null);

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      const r = await fetch('/api/pedidos', { cache: 'no-store' });
      // sin permiso para pedidos (o sin sesión): esta persona no recibe la ventana
      if (r.status === 401 || r.status === 403) { apagado.current = true; setPedidos([]); return; }
      if (!r.ok) return;
      const lista = await r.json();
      if (!Array.isArray(lista)) return;
      const ahora = Date.now();
      const nuevos = (lista as PedidoCola[])
        .filter((p) => sinTomar(p) && ahora - Date.parse(p.creado_en) < VENTANA_MS)
        .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en));
      // suena una vez por pedido (en esta pestaña), y solo si es reciente
      const vistos = leer(CLAVE_VISTOS);
      const recienLlegados = nuevos.filter((p) => !vistos[p.id] && ahora - Date.parse(p.creado_en) < SUENA_MS);
      for (const p of nuevos) vistos[p.id] = vistos[p.id] ?? ahora;
      guardar(CLAVE_VISTOS, vistos);
      if (recienLlegados.length) {
        sonar();
        if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
          const p = recienLlegados[0];
          try {
            new Notification(`Pedido nuevo · ${codigoDe(p)}`, {
              body: `${origenDe(p).label} · ${pesos(Number(p.total) || 0)}${p.clienteNombre ? ` · ${p.clienteNombre}` : ''}`,
              tag: `pedido-${p.id}`,
              icon: '/icon-192.png',
            });
          } catch { /* algunos navegadores no dejan crearla desde la página */ }
        }
      }
      setPedidos(nuevos);
    } catch { /* sin red: la próxima vuelta */ }
  }, []);

  useEffect(() => {
    setPospuestos(leer(CLAVE_POSPUESTOS));
    if ('Notification' in window) setPermisoNotif(Notification.permission);
    const despertar = () => prepararAudio();
    window.addEventListener('pointerdown', despertar, { once: true });
    window.addEventListener('keydown', despertar, { once: true });
    mirar();
    const t = setInterval(mirar, CADA_MS);
    // el "hace N min" y los pospuestos que vencen
    const r = setInterval(() => setReloj((n) => n + 1), 30_000);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t); clearInterval(r);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('pointerdown', despertar);
      window.removeEventListener('keydown', despertar);
    };
  }, [mirar]);

  const ahora = Date.now();
  const visibles = pedidos.filter((p) => !(pospuestos[p.id] && pospuestos[p.id] > ahora));

  // con la pestaña en segundo plano, el título avisa cuántos esperan
  useEffect(() => {
    if (tituloOriginal.current === null) tituloOriginal.current = document.title;
    const base = tituloOriginal.current ?? 'O.D.B';
    document.title = visibles.length ? `(${visibles.length}) Pedido nuevo · ${base}` : base;
  }, [visibles.length]);

  async function tomar(p: PedidoCola) {
    setTomando(p.id); setError(null);
    try {
      const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'tomar', pedidoId: p.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.message ?? 'No se pudo tomar el pedido. Probá de nuevo.'); return; }
      setPedidos((xs) => xs.filter((x) => x.id !== p.id));
      // la pantalla de Pedidos (si está abierta) se actualiza en el momento
      window.dispatchEvent(new CustomEvent('odb-pedidos-cambio'));
      setResultado(d?.tomado
        ? { id: p.id, texto: `Tomaste el pedido ${codigoDe(p)}. Queda a tu nombre.`, tono: 'ok' }
        : { id: p.id, texto: `El pedido ${codigoDe(p)} ya lo tomó ${d?.nombre ?? 'otra persona'}.`, tono: 'neutro' });
      setTimeout(() => setResultado((x) => (x?.id === p.id ? null : x)), 5000);
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setTomando(null);
    }
  }

  function posponer(p: PedidoCola) {
    const v = { ...leer(CLAVE_POSPUESTOS), [p.id]: Date.now() + POSPONER_MS };
    guardar(CLAVE_POSPUESTOS, v);
    setPospuestos(v);
  }

  async function activarNotificaciones() {
    if (!('Notification' in window)) return;
    const r = await Notification.requestPermission().catch(() => 'denied');
    setPermisoNotif(r);
  }

  if (!llevaFlotantes(ruta) || (!visibles.length && !resultado)) return null;
  const [primero, segundo] = visibles;
  // en el celular va una sola ventana (dos tapaban la pantalla entera); en escritorio, dos
  const restoMovil = visibles.length - 1;
  const restoEscritorio = visibles.length - 2;

  return (
    <div
      aria-live="polite"
      className={unir(
        'flotante-ocultable fixed z-aviso flex flex-col gap-2',
        // celular: baja debajo de la barra negra, a lo ancho; escritorio: abajo a la
        // derecha (arriba tapaba los botones de cada pantalla, como "Pedido por WhatsApp")
        'inset-x-0 top-(--alto-barra-movil) px-3 pt-2',
        'lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-auto lg:w-[21rem] lg:px-0 lg:pt-0',
      )}
    >
      {resultado && (
        <div role="status" className={unir('animate-entra-aviso rounded-2xl px-4 py-3 text-sm shadow-flotante motion-reduce:animate-none', resultado.tono === 'ok' ? 'bg-ok text-white' : 'bg-tinta text-white')}>
          {resultado.texto}
        </div>
      )}
      {primero && (
        <TarjetaPedido
          key={primero.id}
          p={primero}
          tomando={tomando === primero.id}
          error={error}
          onTomar={() => tomar(primero)}
          onPosponer={() => posponer(primero)}
          pedirNotif={permisoNotif === 'default' ? activarNotificaciones : undefined}
        />
      )}
      {segundo && (
        <div className="hidden lg:block">
          <TarjetaPedido key={segundo.id} p={segundo} compacta tomando={tomando === segundo.id} onTomar={() => tomar(segundo)} onPosponer={() => posponer(segundo)} />
        </div>
      )}
      {restoMovil > 0 && <MasSinTomar n={restoMovil} className="lg:hidden" />}
      {restoEscritorio > 0 && <MasSinTomar n={restoEscritorio} className="hidden lg:block" />}
    </div>
  );
}

function MasSinTomar({ n, className }: { n: number; className?: string }) {
  return (
    <Link href="/pedidos" className={unir('rounded-2xl bg-tinta px-4 py-2.5 text-center text-sm font-semibold text-white shadow-flotante hover:bg-tinta-2', FOCO, className)}>
      {n === 1 ? 'Y 1 pedido más sin tomar' : `Y ${n} pedidos más sin tomar`} · Ver pedidos
    </Link>
  );
}

function TarjetaPedido({
  p, compacta, tomando, error, onTomar, onPosponer, pedirNotif,
}: {
  p: PedidoCola; compacta?: boolean; tomando: boolean; error?: string | null;
  onTomar: () => void; onPosponer: () => void; pedirNotif?: () => void;
}) {
  const origen = origenDe(p);
  const tel = telefonoLegible(p.clienteTelefono);
  const items = p.items ?? [];
  const minutos = Math.max(0, Math.round((Date.now() - Date.parse(p.creado_en)) / 60000));
  return (
    <section
      aria-label={`Pedido nuevo ${codigoDe(p)}`}
      className="animate-entra-aviso overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none"
    >
      {/* la franja roja de arriba: se lee de lejos */}
      <div className="flex items-center justify-between gap-2 bg-marca px-4 py-2 text-white">
        <p className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-white" />
          </span>
          <span className="truncate">Llegó un pedido</span>
        </p>
        <span className={unir('importe shrink-0 text-xs', minutos >= 15 ? 'font-bold' : 'text-white/80')}>{haceCuanto(p.creado_en)}</span>
      </div>

      <div className="space-y-1.5 px-4 py-3 lg:space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="importe text-base font-bold text-tinta">{codigoDe(p)}</span>
          <Etiqueta tono={origen.tono}>{origen.label}</Etiqueta>
          {p.pagado_en && <Etiqueta tono="ok">Pagado</Etiqueta>}
        </div>
        {!compacta && (
          <>
            <p className="min-w-0 break-words text-sm text-tinta">
              {p.clienteNombre || 'Cliente sin nombre'}
              {tel && <span className="whitespace-nowrap text-tinta/70"> · {tel}</span>}
            </p>
            <p className="min-w-0 break-words text-sm text-tinta/70">{entregaDe(p)}</p>
            {items.length > 0 && (
              <ul className="hidden space-y-0.5 text-sm text-tinta/70 lg:block">
                {items.slice(0, 3).map((it, i) => (
                  <li key={i} className="flex min-w-0 gap-1.5">
                    <span className="importe shrink-0 font-semibold text-marca">{cantidadLegible(it.cantidad)}×</span>
                    <span className="min-w-0 truncate">{it.producto?.nombre ?? 'Producto'}</span>
                  </li>
                ))}
                {items.length > 3 && <li className="text-tinta/60">y {items.length - 3} más</li>}
              </ul>
            )}
          </>
        )}
        <p className="importe text-base font-semibold text-tinta">
          {pesos(Number(p.total) || 0)}
          {items.length > 0 && <span className="ml-2 text-xs font-normal text-tinta/60 lg:hidden">{items.length === 1 ? '1 producto' : `${items.length} productos`}</span>}
        </p>
        {error && <p role="alert" className="text-sm text-marca-hondo">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-4 py-2.5 lg:py-3">
        <Boton tamano="chico" onClick={onTomar} cargando={tomando} className="flex-1">Lo tomo</Boton>
        <Link
          href={`/pedidos?pedido=${p.id}`}
          className={unir('inline-flex min-h-9 items-center justify-center rounded-full border border-black/15 bg-white px-4 text-sm font-semibold text-tinta hover:bg-crema-claro', FOCO)}
        >
          Ver
        </Link>
        <button
          type="button"
          onClick={onPosponer}
          aria-label={`Recordarme el pedido ${codigoDe(p)} en 10 minutos`}
          title="Esconder 10 minutos"
          className={unir('ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-crema-claro hover:text-tinta', FOCO)}
        >
          <IconoCerrar className="size-5" />
        </button>
      </div>
      {pedirNotif && (
        <button type="button" onClick={pedirNotif} className={unir('block w-full bg-crema-claro px-4 py-2 text-left text-xs font-medium text-tinta/70 hover:text-tinta', FOCO)}>
          Avisarme también cuando el panel esté en otra pestaña
        </button>
      )}
    </section>
  );
}

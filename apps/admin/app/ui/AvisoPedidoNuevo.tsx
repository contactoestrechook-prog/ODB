'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pesos } from '../lib/formato';
import { cantidadLegible, codigoDe, entregaDe, haceCuanto, origenDe, sinTomar, telefonoLegible, type PedidoCola } from '../lib/pedidos';
import { esDeMiSucursal, lecturaDeLaCola } from '../lib/aviso-caja';
import { esRutaDeAcceso, llevaFlotantes } from '../lib/rutas';
import { Boton, Etiqueta, FOCO, unir } from './kit';
import { conCodigo } from '../lib/codigo-producto';
import { alCambiarAudio, audioActivo, pedidosQueSuenan, prepararAudio } from '../lib/alarma-pedido';
import { useAlarmaHastaQueSeAtienda } from '../lib/usar-alarma';
import { estaPcImprime, imprimirSiFalta } from '../lib/comanda';

// LLEGÓ UN PEDIDO (Leandro, 6/10/2026: "necesito ventanas slides emergentes
// avisando que llegó un pedido"). En todas las pantallas del panel, a quien
// puede atender pedidos, aparece una ventana que se desliza con el pedido que
// nadie tomó todavía, con sonido. Queda hasta que alguien toca "Lo tomo" (queda
// su nombre en el pedido) y entonces se va para todos. "Más tarde" la esconde
// 10 minutos en esta pantalla, nada más: el pedido sigue sin tomar y a los 15
// minutos sale el reclamo por WhatsApp a administración.
//
// 4/11/2026 (Leandro: "como PedidosYa, con un sonido muy potente"): la alarma
// se repite hasta que alguien lo toma ("Más tarde" la calla 10 minutos en esta
// PC) y crece con el tiempo: baja y espaciada al entrar, fuerte y seguida a los
// 6 minutos (ver lib/alarma-pedido.ts). En las PC marcadas con «Esta PC imprime
// las comandas» sale la comanda apenas entra el pedido (ver lib/comanda.ts).
//
// 21/11/2026 — REGLA CON CANDADO (Leandro: «todos los pop-ups de ODB de pedido hagan
// un ruido escandaloso en todas las máquinas, sin excepción»): la ventana sale y suena
// en TODAS las máquinas con sesión, de cualquier rol y de cualquier sucursal (lee
// /pedidos/sin-tomar, abierta a todos), al máximo desde el primer toque, hasta que
// alguien lo toma. Se fue «Más tarde» (callaba 10 minutos), el tope de 12 horas y el
// silencio en RESPONDE a pantalla completa (ahí no se ve la ventana, pero suena).
// «Lo tomo» queda para quien atiende pedidos en la sucursal del pedido; en las demás
// máquinas la ventana dice quién lo tiene que tomar. Candado: alarma-escandalosa.spec.ts.

const CADA_MS = 12_000;
// la notificación de Windows y la comanda, solo para lo que entró en la última media hora
const RECIENTE_MS = 30 * 60_000;
const CLAVE_VISTOS = 'odb_pedidos_vistos';

const leer = (clave: string): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem(clave) ?? '{}') ?? {}; } catch { return {}; }
};
const guardar = (clave: string, v: Record<string, number>) => {
  try { sessionStorage.setItem(clave, JSON.stringify(v)); } catch { /* modo privado */ }
};

type Resultado = { id: string; texto: string; tono: 'ok' | 'neutro' };

/** Cuántos pedidos tiene abiertos la sucursal: lo lee la Caja para su botón «Pedidos». */
export type CuentaPedidos = { enCurso: number; sinTomar: number };
export const EVENTO_CUENTA = 'odb-pedidos-cuenta';
let ultimaCuenta: CuentaPedidos | null = null;
export const cuentaDePedidos = () => ultimaCuenta;
function publicarCuenta(c: CuentaPedidos) {
  ultimaCuenta = c;
  window.dispatchEvent(new CustomEvent<CuentaPedidos>(EVENTO_CUENTA, { detail: c }));
}

// 13/11/2026 (ODB empieza a recibir los pedidos en las cajas): cada caja ve los
// de SU sucursal (todo lo del bot, la web y la app sale de la central; la otra
// caja sonaba igual) y, si la sesión de la PC venció, la ventana lo dice en vez
// de apagarse en silencio: antes un 401 la apagaba hasta recargar la página.
export function AvisoPedidoNuevo({ sucursalId, puedeTomar }: { sucursalId?: string | null; puedeTomar: boolean }) {
  const ruta = usePathname();
  const [pedidos, setPedidos] = useState<PedidoCola[]>([]);
  const [tomando, setTomando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permisoNotif, setPermisoNotif] = useState<string>('granted');
  const [sinSonido, setSinSonido] = useState(false);
  const [sinSesion, setSinSesion] = useState(false);
  const [, setReloj] = useState(0);
  const apagado = useRef(false);
  const tituloOriginal = useRef<string | null>(null);

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      // 1) LO QUE SUENA: los sin tomar de todas las sucursales, para cualquier rol
      const r = await fetch('/api/pedidos?vista=sin-tomar', { cache: 'no-store' });
      const lectura = lecturaDeLaCola(r.status);
      // sin permiso (no debería pasar: la ruta está abierta a todos): no se apaga en silencio, se reintenta
      if (lectura === 'sin_permiso') return;
      // sin sesión: se avisa y se sigue mirando (vuelve sola al entrar de nuevo)
      if (lectura === 'sin_sesion') { setSinSesion(true); setPedidos([]); return; }
      if (lectura !== 'ok') return;
      const todos = await r.json();
      if (!Array.isArray(todos)) return;
      setSinSesion(false);
      const ahora = Date.now();
      const nuevos = pedidosQueSuenan(todos as PedidoCola[], ahora).sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en));
      // la notificación de Windows: una vez por pedido (en esta pestaña), y solo si es reciente
      const vistos = leer(CLAVE_VISTOS);
      const recienLlegados = nuevos.filter((p) => !vistos[p.id] && ahora - Date.parse(p.creado_en) < RECIENTE_MS);
      for (const p of nuevos) vistos[p.id] = vistos[p.id] ?? ahora;
      guardar(CLAVE_VISTOS, vistos);
      if (recienLlegados.length && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        const p = recienLlegados[0];
        try {
          new Notification(`Pedido nuevo · ${codigoDe(p)}`, {
            body: `${origenDe(p).label} · ${pesos(Number(p.total) || 0)}${p.clienteNombre ? ` · ${p.clienteNombre}` : ''}`,
            tag: `pedido-${p.id}`,
            icon: '/icon-192.png',
          });
        } catch { /* algunos navegadores no dejan crearla desde la página */ }
      }
      setPedidos(nuevos);

      // 2) LA CAJA: la cuenta de su botón «Pedidos» y la comanda (solo quien atiende pedidos)
      if (!puedeTomar) return;
      const rc = await fetch('/api/pedidos', { cache: 'no-store' });
      if (lecturaDeLaCola(rc.status) !== 'ok') return;
      const cola = await rc.json();
      if (!Array.isArray(cola)) return;
      const lista = (cola as PedidoCola[]).filter((p) => esDeMiSucursal(p, sucursalId));
      // la Caja muestra cuántos hay en su botón «Pedidos» (21/11/2026) sin pedir la cola otra vez
      publicarCuenta({ enCurso: lista.length, sinTomar: lista.filter(sinTomar).length });
      // la comanda: en esta PC, si está marcada, una sola vez por pedido aunque
      // haya varias pestañas (también los cargados a mano que ya tienen dueño)
      if (estaPcImprime()) {
        for (const p of lista) {
          if (['recibido', 'pagado'].includes(p.estado) && ahora - Date.parse(p.creado_en) < RECIENTE_MS) {
            await imprimirSiFalta(p).catch(() => false);
          }
        }
      }
    } catch { /* sin red: la próxima vuelta */ }
  }, [sucursalId, puedeTomar]);

  useEffect(() => {
    if ('Notification' in window) setPermisoNotif(Notification.permission);
    // con el acceso directo de las PC con impresora, el audio arranca solo; si
    // no, se despierta con el primer toque o tecla
    prepararAudio();
    setSinSonido(!audioActivo());
    const dejarDeOir = alCambiarAudio(() => setSinSonido(!audioActivo()));
    const despertar = () => prepararAudio();
    window.addEventListener('pointerdown', despertar);
    window.addEventListener('keydown', despertar);
    mirar();
    const t = setInterval(mirar, CADA_MS);
    // el "hace N min"
    const r = setInterval(() => setReloj((n) => n + 1), 30_000);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t); clearInterval(r);
      dejarDeOir();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('pointerdown', despertar);
      window.removeEventListener('keydown', despertar);
    };
  }, [mirar]);

  const visibles = pedidos;

  // con la pestaña en segundo plano, el título avisa cuántos esperan
  useEffect(() => {
    if (tituloOriginal.current === null) tituloOriginal.current = document.title;
    const base = tituloOriginal.current ?? 'O.D.B';
    document.title = sinSesion ? `(!) Sesión vencida · ${base}` : visibles.length ? `(${visibles.length}) Pedido nuevo · ${base}` : base;
  }, [visibles.length, sinSesion]);

  // LA ALARMA: al máximo y sin parar mientras haya uno sin tomar, en cualquier pantalla
  // con sesión (también donde la ventana no se ve, como RESPONDE a pantalla completa)
  const suena = visibles.length > 0 && !esRutaDeAcceso(ruta);
  useAlarmaHastaQueSeAtienda(suena);

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

  async function activarNotificaciones() {
    if (!('Notification' in window)) return;
    const r = await Notification.requestPermission().catch(() => 'denied');
    setPermisoNotif(r);
  }

  if (!llevaFlotantes(ruta) || (!visibles.length && !resultado && !sinSesion)) return null;
  const [primero, segundo] = visibles;
  // en el celular va una sola ventana (dos tapaban la pantalla entera); en escritorio, dos
  const restoMovil = visibles.length - 1;
  const restoEscritorio = visibles.length - 2;

  return (
    // dónde flota lo decide <PilaDeAvisos> (layout): ahí también va «Te toca armar»
    <div aria-live="polite" className="flex flex-col gap-2">
      {sinSesion && <TarjetaSinSesion />}
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
          puedeTomarlo={puedeTomar && esDeMiSucursal(primero, sucursalId)}
          verPedidos={puedeTomar}
          pedirNotif={permisoNotif === 'default' ? activarNotificaciones : undefined}
          sinSonido={suena && sinSonido}
        />
      )}
      {segundo && (
        <div className="hidden lg:block">
          <TarjetaPedido key={segundo.id} p={segundo} compacta tomando={tomando === segundo.id} onTomar={() => tomar(segundo)} puedeTomarlo={puedeTomar && esDeMiSucursal(segundo, sucursalId)} verPedidos={puedeTomar} />
        </div>
      )}
      {restoMovil > 0 && <MasSinTomar n={restoMovil} className="lg:hidden" />}
      {restoEscritorio > 0 && <MasSinTomar n={restoEscritorio} className="hidden lg:block" />}
    </div>
  );
}

// La sesión de esta PC venció: sin entrar de nuevo no llega ningún pedido.
function TarjetaSinSesion() {
  return (
    <section role="alert" aria-label="Sesión vencida" className="animate-entra-aviso overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none">
      <div className="bg-marca px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white">Sesión vencida</div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-tinta">
          Esta PC dejó de recibir los pedidos nuevos: no aparece la ventana ni suena la alarma hasta que vuelvas a entrar.
        </p>
        <a
          href="/login"
          className={unir('inline-flex min-h-9 w-full items-center justify-center rounded-full bg-marca px-4 text-sm font-semibold text-white hover:bg-marca-hondo', FOCO)}
        >
          Entrar de nuevo
        </a>
      </div>
    </section>
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
  p, compacta, tomando, error, onTomar, puedeTomarlo, verPedidos, pedirNotif, sinSonido,
}: {
  p: PedidoCola; compacta?: boolean; tomando: boolean; error?: string | null;
  onTomar: () => void; puedeTomarlo: boolean; verPedidos: boolean; pedirNotif?: () => void; sinSonido?: boolean;
}) {
  // en las máquinas que no lo pueden tomar (otra sucursal, otro rol) suena igual y dice quién lo toma
  const sucursal = (p as any).sucursal?.nombre as string | undefined;
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
                    <span className="min-w-0 truncate">{conCodigo(it.producto?.nombre ?? 'Producto', it.producto)}</span>
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
        {puedeTomarlo
          ? <Boton tamano="chico" onClick={onTomar} cargando={tomando} className="flex-1">Lo tomo</Boton>
          : <p className="min-w-0 flex-1 text-sm font-semibold text-tinta">Lo toma la caja{sucursal ? ` de ${sucursal}` : ''}: suena hasta que lo tomen.</p>}
        {verPedidos && (
          <Link
            href={`/pedidos?pedido=${p.id}`}
            className={unir('inline-flex min-h-9 items-center justify-center rounded-full border border-black/15 bg-white px-4 text-sm font-semibold text-tinta hover:bg-crema-claro', FOCO)}
          >
            Ver
          </Link>
        )}
      </div>
      {sinSonido && (
        <p role="alert" className="bg-marca-suave px-4 py-2 text-xs font-semibold text-marca-hondo">
          No está sonando: tocá cualquier parte de la pantalla una vez para activar la alarma.
        </p>
      )}
      {pedirNotif && (
        <button type="button" onClick={pedirNotif} className={unir('block w-full bg-crema-claro px-4 py-2 text-left text-xs font-medium text-tinta/70 hover:text-tinta', FOCO)}>
          Avisarme también cuando el panel esté en otra pestaña
        </button>
      )}
    </section>
  );
}

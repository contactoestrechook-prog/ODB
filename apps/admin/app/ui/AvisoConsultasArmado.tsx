'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { esDeMiSucursal } from '../lib/aviso-caja';
import { llevaFlotantes } from '../lib/rutas';
import { prepararAudio, sonarAlarma } from '../lib/alarma-pedido';
import { mandarMensaje, marcarVistos } from './CharlaPedido';
import { Boton, Entrada, FOCO, IconoCerrar, unir } from './kit';
import { nombrePropio, type MensajePedido } from './salon/comun';

// LO QUE QUIEN ARMA LE DICE A LA CAJA (Juan Pablo, 20/11/2026: «si tienen que
// devolver un pedido… si le tienen que hacer una consulta a la persona que se
// los asignó, todo eso tiene que estar previsto desde la app»). En cualquier
// pantalla, a la caja de la sucursal le aparece:
//  · la PREGUNTA de quien arma, con la caja para contestarle ahí mismo;
//  · el pedido que DEVOLVIERON («No lo puedo armar»), con el motivo y el botón
//    para dárselo a otra persona.
// Suena una vez por cada novedad. La pregunta se va cuando alguien la contesta o
// la marca vista; la devolución, cuando el pedido tiene armador de nuevo.

type Consulta = {
  pedidoId: string; codigo: string; cliente: string | null; sucursalId: string | null;
  armaId: string | null; armaNombre: string | null; asignadoPor: string | null;
  devuelto: { porId: string | null; porNombre: string | null; motivo: string | null; en: string } | null;
  sinVer: number; mensajes: MensajePedido[];
};

const CADA_MS = 10_000;
const ESCONDER_MS = 10 * 60_000;
const CLAVE_OIDAS = 'odb_consultas_oidas';
const CLAVE_ESCONDIDAS = 'odb_consultas_escondidas';
const leer = (clave: string): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem(clave) ?? '{}') ?? {}; } catch { return {}; }
};
const guardar = (clave: string, v: Record<string, number>) => {
  try { sessionStorage.setItem(clave, JSON.stringify(v)); } catch { /* modo privado */ }
};
const primerNombre = (n?: string | null) => nombrePropio(n).split(' ')[0] || '';
/** Qué novedad es: cambia con cada mensaje nuevo o cada devolución. */
const claveDe = (c: Consulta) => {
  const ultimo = c.mensajes.filter((m) => m.lado === 'armado' && !m.vistoEn).at(-1);
  return `${c.pedidoId}|${ultimo ? `m${ultimo.id}` : `d${c.devuelto?.en ?? ''}`}`;
};

export function AvisoConsultasArmado({ sucursalId, miId }: { sucursalId?: string | null; miId?: string | null }) {
  const ruta = usePathname();
  const [lista, setLista] = useState<Consulta[]>([]);
  const [escondidas, setEscondidas] = useState<Record<string, number>>({});
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const apagado = useRef(false);

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      const r = await fetch('/api/salon?recurso=consultas', { cache: 'no-store' });
      if (r.status === 403) { apagado.current = true; setLista([]); return; }
      if (!r.ok) return;
      const d = await r.json();
      if (!Array.isArray(d)) return;
      const mias = (d as Consulta[])
        .filter((c) => esDeMiSucursal({ sucursal_id: c.sucursalId }, sucursalId))
        // lo que preguntó o devolvió uno mismo no le vuelve como aviso
        .filter((c) => (c.sinVer > 0 && c.armaId !== miId) || (!!c.devuelto && c.devuelto.porId !== miId));
      const oidas = leer(CLAVE_OIDAS);
      const nuevas = mias.filter((c) => !oidas[claveDe(c)]);
      if (nuevas.length) {
        for (const c of nuevas) oidas[claveDe(c)] = Date.now();
        guardar(CLAVE_OIDAS, oidas);
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
        prepararAudio();
        sonarAlarma(0.5);
      }
      setLista(mias);
    } catch { /* sin red: la próxima vuelta */ }
  }, [sucursalId, miId]);

  useEffect(() => {
    setEscondidas(leer(CLAVE_ESCONDIDAS));
    mirar();
    const t = setInterval(mirar, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [mirar]);
  useEffect(() => {
    if (!hecho) return;
    const t = setTimeout(() => setHecho(null), 5000);
    return () => clearTimeout(t);
  }, [hecho]);

  if (!llevaFlotantes(ruta)) return null;
  const ahora = Date.now();
  const visibles = lista.filter((c) => !(escondidas[claveDe(c)] && escondidas[claveDe(c)] > ahora));
  if (!visibles.length && !hecho) return null;
  // primero las preguntas: alguien está parado esperando la respuesta
  const [c, ...resto] = [...visibles].sort((a, b) => Number(b.sinVer > 0) - Number(a.sinVer > 0));

  function esconder(x: Consulta) {
    const v = { ...leer(CLAVE_ESCONDIDAS), [claveDe(x)]: Date.now() + ESCONDER_MS };
    guardar(CLAVE_ESCONDIDAS, v);
    setEscondidas(v);
  }
  async function contestar(x: Consulta) {
    const t = texto.trim();
    if (!t || ocupado) return;
    setOcupado(true); setError(null);
    try {
      await mandarMensaje(x.pedidoId, t);
      setTexto('');
      setLista((l) => l.filter((y) => y.pedidoId !== x.pedidoId || !!y.devuelto));
      setHecho(`Le contestaste a ${primerNombre(x.armaNombre) || 'quien arma'}: le aparece en el armado y le llega por WhatsApp.`);
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }
  async function visto(x: Consulta) {
    await marcarVistos(x.pedidoId);
    setLista((l) => l.filter((y) => y.pedidoId !== x.pedidoId || !!y.devuelto));
  }

  const pregunta = !!c && c.sinVer > 0;
  const sinVer = c ? c.mensajes.filter((m) => m.lado === 'armado' && !m.vistoEn) : [];
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {hecho && <div role="status" className="animate-entra-aviso rounded-2xl bg-ok px-4 py-3 text-sm text-white shadow-flotante motion-reduce:animate-none">{hecho}</div>}
      {c && (
        <section aria-label={pregunta ? `Pregunta del armado del pedido ${c.codigo}` : `Devolvieron el pedido ${c.codigo}`}
          className="animate-entra-aviso overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none">
          <div className={unir('flex items-center justify-between gap-2 px-4 py-2 text-white', pregunta ? 'bg-tinta' : 'bg-marca')}>
            <p className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2.5 rounded-full bg-white" />
              </span>
              <span className="truncate">{pregunta ? 'Pregunta del armado' : 'Devolvieron un pedido'}</span>
            </p>
          </div>
          {pregunta ? (
            <>
              <div className="space-y-1.5 px-4 py-3">
                <p className="importe text-base font-bold text-tinta">{c.codigo}</p>
                <p className="text-sm text-tinta"><b className="font-semibold">{primerNombre(c.armaNombre) || 'Quien lo arma'}</b> pregunta{c.cliente ? <span className="text-tinta/70"> · pedido de {c.cliente}</span> : null}</p>
                {sinVer.slice(-3).map((m) => <p key={m.id} className="rounded-xl bg-crema-hondo px-3 py-2 text-sm text-tinta">«{m.texto}»</p>)}
                {error && <p role="alert" className="text-sm text-marca-hondo">{error}</p>}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); contestar(c); }} className="flex items-center gap-2 border-t border-black/[0.06] px-4 py-2.5">
                <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={600} aria-label={`Tu respuesta para ${primerNombre(c.armaNombre) || 'quien arma'}`} className="min-w-0 flex-1" />
                <Boton type="submit" tamano="chico" cargando={ocupado} disabled={!texto.trim()}>Contestar</Boton>
              </form>
              <div className="flex items-center justify-between gap-2 bg-crema-claro px-4 py-1.5 text-xs font-semibold">
                <Link href={`/pedidos?pedido=${c.pedidoId}`} className={unir('rounded-sm py-1.5 text-tinta/70 underline-offset-2 hover:text-tinta hover:underline', FOCO)}>Ver el pedido</Link>
                <button type="button" onClick={() => visto(c)} className={unir('rounded-sm py-1.5 text-tinta/70 underline-offset-2 hover:text-tinta hover:underline', FOCO)}>Ya se lo dije: sacar el aviso</button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1 px-4 py-3">
                <p className="importe text-base font-bold text-tinta">{c.codigo}</p>
                <p className="text-sm text-tinta"><b className="font-semibold">{primerNombre(c.devuelto?.porNombre) || 'Quien lo armaba'}</b> no lo puede armar{c.cliente ? <span className="text-tinta/70"> · pedido de {c.cliente}</span> : null}</p>
                {c.devuelto?.motivo && <p className="rounded-xl bg-crema-hondo px-3 py-2 text-sm text-tinta">«{c.devuelto.motivo}»</p>}
                <p className="text-xs text-tinta/60">Quedó sin quién lo arme. Lo que ya cargó sigue en el carro.</p>
              </div>
              <div className="flex items-center gap-2 border-t border-black/[0.06] px-4 py-2.5">
                <Link href={`/pedidos?pedido=${c.pedidoId}`}
                  className={unir('inline-flex min-h-9 flex-1 items-center justify-center rounded-full bg-marca px-4 text-sm font-semibold text-white hover:bg-marca-hondo', FOCO)}>
                  Dárselo a otra persona
                </Link>
                <button type="button" onClick={() => esconder(c)} aria-label={`Esconder 10 minutos el aviso del pedido ${c.codigo}`} title="Esconder 10 minutos"
                  className={unir('flex size-9 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-crema-claro hover:text-tinta', FOCO)}>
                  <IconoCerrar className="size-5" />
                </button>
              </div>
            </>
          )}
          {resto.length > 0 && (
            <Link href="/pedidos" className={unir('block bg-tinta px-4 py-2 text-center text-xs font-semibold text-white hover:bg-tinta-2', FOCO)}>
              {resto.length === 1 ? 'Y hay otro aviso del armado' : `Y hay ${resto.length} avisos más del armado`} · Ver pedidos
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

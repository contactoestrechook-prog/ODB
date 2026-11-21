'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { esRutaDeAcceso, llevaFlotantes } from '../lib/rutas';
import { useAlarmaHastaQueSeAtienda } from '../lib/usar-alarma';
import { FOCO, IconoCerrar, unir } from './kit';
import { avance, reloj, useAhora, type PedidoArmar } from './salon/comun';

// TE TOCA ARMAR (Juan Pablo, 20/11/2026, con la foto de la Caja en el celular:
// «estos chicos quieren volver porque entró un pedido y no pueden volver para
// atrás… no sé con qué tienen que tocar para ponerse en modo ver el pedido»).
// A Alexis, que cobra y también arma, le asignaron un pedido estando en la Caja:
// el armado solo se abría en Salón y la Caja no decía nada ni tenía una salida a
// la vista. Juan Pablo terminó pasándolo a «listo» a mano.
//
// Ahora, a quien le asignan un pedido le aparece esta ventana en CUALQUIER
// pantalla (la Caja incluida), vibra y suena una vez, y «Armarlo» lo lleva al
// armado. En Salón y en Depósito no sale: ahí el pedido ya se abre o se muestra.
//
// 21/11/2026 — REGLA CON CANDADO (ver lib/alarma-pedido.ts): suena al máximo y sin parar
// mientras haya un pedido asignado que todavía no abrió; se calla cuando empieza a
// armarlo. Esconder 5 minutos solo vale para el que ya está armando (no suena).

const CADA_MS = 10_000;
const ESCONDER_MS = 5 * 60_000;
const CLAVE_ESCONDIDOS = 'odb_armar_escondidos';
/** De dónde vino: al terminar, el armado le ofrece volver (ver salon/Armar). */
export const CLAVE_VINE_DE = 'odb_armar_vine_de';
const SIN_VENTANA = ['/salon', '/deposito'];

const leer = (clave: string): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem(clave) ?? '{}') ?? {}; } catch { return {}; }
};
const guardar = (clave: string, v: Record<string, number>) => {
  try { sessionStorage.setItem(clave, JSON.stringify(v)); } catch { /* modo privado */ }
};

export function AvisoTeTocaArmar() {
  const ruta = usePathname();
  const [pedidos, setPedidos] = useState<PedidoArmar[]>([]);
  const [escondidos, setEscondidos] = useState<Record<string, number>>({});
  const apagado = useRef(false);
  const ahora = useAhora(1000);

  const mirar = useCallback(async () => {
    if (apagado.current) return;
    try {
      const r = await fetch('/api/salon?recurso=pedidos', { cache: 'no-store' });
      // sin permiso para armar: a esta persona no se le asignan pedidos
      if (r.status === 403) { apagado.current = true; setPedidos([]); return; }
      if (!r.ok) return;
      const d = await r.json();
      if (!Array.isArray(d)) return;
      setPedidos(d);
    } catch { /* sin red: la próxima vuelta */ }
  }, []);

  useEffect(() => {
    setEscondidos(leer(CLAVE_ESCONDIDOS));
    mirar();
    const t = setInterval(mirar, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [mirar]);

  const enSuPantalla = SIN_VENTANA.some((b) => ruta === b || ruta?.startsWith(b + '/'));
  // suena hasta que lo abre (en Salón y Depósito el armado se abre solo y suena ahí)
  useAlarmaHastaQueSeAtienda(!enSuPantalla && !esRutaDeAcceso(ruta) && pedidos.some((p) => !p.primeraCarga));
  if (!llevaFlotantes(ruta) || enSuPantalla) return null;
  // esconder solo vale para el que ya empezó a armar: el que no abrió no se esconde
  const visibles = pedidos.filter((p) => !(p.primeraCarga && escondidos[p.id] && escondidos[p.id] > ahora));
  if (!visibles.length) return null;
  const [p, ...resto] = visibles;
  const a = avance(p);
  const productos = a.productos === 1 ? '1 producto' : `${a.productos} productos`;

  function esconder() {
    const v = { ...leer(CLAVE_ESCONDIDOS), [p.id]: Date.now() + ESCONDER_MS };
    guardar(CLAVE_ESCONDIDOS, v);
    setEscondidos(v);
  }
  function recordarDeDondeVengo() {
    try { sessionStorage.setItem(CLAVE_VINE_DE, ruta ?? ''); } catch { /* modo privado */ }
  }

  return (
    <section aria-live="polite" aria-label={`Te toca armar el pedido ${p.codigo}`}
      className="animate-entra-aviso overflow-hidden rounded-2xl bg-white shadow-flotante ring-1 ring-black/[0.06] motion-reduce:animate-none">
      {/* la franja ciruela: el color de «se está armando» en Pedidos y Salón */}
      <div className="flex items-center justify-between gap-2 bg-dato-3 px-4 py-2 text-white">
        <p className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-white" />
          </span>
          <span className="truncate">Te toca armar</span>
        </p>
        <span className="importe shrink-0 text-xs text-white/85" aria-label="Tiempo desde que te lo asignaron">{reloj(p.asignadoEn, ahora)}</span>
      </div>
      <div className="px-4 py-3">
        <p className="importe text-base font-bold text-tinta">{p.codigo}</p>
        <p className="mt-0.5 min-w-0 break-words text-sm text-tinta">
          {p.cliente ?? 'Cliente sin nombre'}<span className="text-tinta/70"> · {p.canal === 'domicilio' ? 'envío' : 'retira'}</span>
        </p>
        <p className="mt-0.5 text-sm text-tinta/70">
          {productos}{p.primeraCarga ? ` · llevás ${a.completos} de ${a.productos}` : ' · todavía no lo abriste'}
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-black/[0.06] px-4 py-2.5">
        <Link href="/salon" onClick={recordarDeDondeVengo}
          className={unir('inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-dato-3 px-4 text-sm font-semibold text-white hover:bg-[#673D74]', FOCO)}>
          {p.primeraCarga ? 'Seguir armando' : 'Armarlo'}
        </Link>
        {p.primeraCarga && (
          <button type="button" onClick={esconder} aria-label={`Esconder 5 minutos el aviso del pedido ${p.codigo}`} title="Esconder 5 minutos"
            className={unir('flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-crema-claro hover:text-tinta', FOCO)}>
            <IconoCerrar className="size-5" />
          </button>
        )}
      </div>
      {resto.length > 0 && (
        <Link href="/salon" onClick={recordarDeDondeVengo} className={unir('block bg-crema-claro px-4 py-2 text-xs font-semibold text-tinta/70 hover:text-tinta', FOCO)}>
          {resto.length === 1 ? `Y otro más para armar: ${resto[0].codigo}` : `Y ${resto.length} más para armar`}
        </Link>
      )}
    </section>
  );
}

'use client';

// LA PILA DE AVISOS, ESTÉ DONDE ESTÉ (26/11/2026). Juan Pablo estaba haciendo una factura,
// entró una consulta por una leche y no la podía ver ni contestar sin salir de la factura:
// con cualquier ventana abierta (data-modal-abierto) la pila entera se escondía y solo
// quedaba la alarma. Leandro: «quiere que la consulta o pedido salga la solapa, esté donde
// esté en el sistema».
//
// Ahora, con una ventana abierta:
//  · lo que llega (consulta de un cliente, pedido nuevo, lo que pregunta quien arma) se
//    despliega encima, sin cerrar la ventana: se contesta ahí mismo y la factura sigue igual;
//  · «Achicar» lo deja como una solapa roja («Pregunta de Carla · Ver») para seguir con lo que
//    estaba haciendo; tocándola se vuelve a abrir. Si llega algo nuevo, se despliega solo.
// Los avisos nunca se desmontan (solo se esconden): la alarma sigue sonando hasta que alguien
// los atienda, como manda la regla con candado (lib/alarma-pedido.ts).

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FOCO, unir } from './kit';
import { nombreDeAviso, textoDeSolapa } from '../lib/pila-avisos';

const suscribirVentana = (avisar: () => void) => {
  const mo = new MutationObserver(avisar);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-modal-abierto'] });
  return () => mo.disconnect();
};
const hayVentana = () => document.documentElement.dataset.modalAbierto === '1';
const enServidor = () => false;

export function PilaAvisos({ className, children }: { className?: string; children: ReactNode }) {
  const ventana = useSyncExternalStore(suscribirVentana, hayVentana, enServidor);
  const caja = useRef<HTMLDivElement>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [achicada, setAchicada] = useState(false);
  const vistos = useRef<Set<string>>(new Set());

  // qué avisos hay a la vista: los recuadros con nombre que dibuja cada aviso
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const leer = () => {
      const etiquetas = Array.from(el.querySelectorAll('section[aria-label]'))
        .map((s) => s.getAttribute('aria-label') ?? '').filter(Boolean);
      // lo que llega nuevo se despliega solo, aunque se haya achicado lo anterior
      if (etiquetas.some((e) => !vistos.current.has(e))) setAchicada(false);
      vistos.current = new Set(etiquetas);
      setAvisos((antes) => (antes.join('|') === etiquetas.join('|') ? antes : etiquetas));
    };
    const mo = new MutationObserver(leer);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    const primera = requestAnimationFrame(leer);
    return () => { mo.disconnect(); cancelAnimationFrame(primera); };
  }, []);

  const conVentana = ventana && avisos.length > 0;
  const esconder = conVentana && achicada;

  return (
    <div className={className}>
      {conVentana && (achicada ? (
        <button type="button" onClick={() => setAchicada(false)} aria-label={`Ver: ${avisos.map(nombreDeAviso).join(', ')}`}
          className={unir('flex w-full items-center gap-2 rounded-full bg-marca py-2 pl-3 pr-4 text-left text-sm font-semibold text-white shadow-flotante hover:bg-marca-hondo', FOCO)}>
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-white" />
          </span>
          <span className="min-w-0 flex-1 truncate">{textoDeSolapa(avisos)}</span>
          <span className="shrink-0 underline underline-offset-2">Ver</span>
        </button>
      ) : (
        <button type="button" onClick={() => setAchicada(true)}
          className={unir('flex w-full items-center justify-center gap-1.5 rounded-xl bg-tinta px-3 py-2 text-xs font-semibold text-white shadow-flotante hover:bg-tinta-2', FOCO)}>
          <span aria-hidden="true">↘</span> Achicar y seguir con lo que estabas haciendo
        </button>
      ))}
      {/* siempre montados: escondidos o no, siguen mirando y sonando */}
      <div ref={caja} className={unir('flex flex-col gap-2', esconder && 'hidden')}>
        {children}
      </div>
    </div>
  );
}

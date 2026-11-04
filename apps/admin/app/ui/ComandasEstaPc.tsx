'use client';

import { useEffect, useState } from 'react';
import { probarAlarma } from '../lib/alarma-pedido';
import { alCambiarEstaPc, estaPcImprime, imprimirComanda, marcarEstaPc, pedidoDePrueba } from '../lib/comanda';
import { FOCO, unir } from './kit';

// «ESTA PC IMPRIME LAS COMANDAS» (Leandro, 4/11/2026). Se prende una vez en
// cada PC que tiene impresora (depósito, caja): queda guardado en esa PC, no en
// el usuario, así no importa quién esté logueado. Ver lib/comanda.ts.

const enlace = unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO);

export function ComandasEstaPc() {
  // null hasta leer la PC: así no parpadea "apagado" en las que están prendidas
  const [si, setSi] = useState<boolean | null>(null);
  useEffect(() => {
    const leer = () => setSi(estaPcImprime());
    leer();
    return alCambiarEstaPc(leer);
  }, []);
  if (si === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={si}
        onClick={() => marcarEstaPc(!si)}
        className={unir('inline-flex min-h-9 items-center gap-2.5 rounded-full font-semibold text-tinta', FOCO)}
      >
        <span aria-hidden="true" className={unir('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', si ? 'bg-ok' : 'bg-black/15')}>
          <span className={unir('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none', si ? 'translate-x-[1.375rem]' : 'translate-x-0.5')} />
        </span>
        Esta PC imprime las comandas
      </button>
      {si ? (
        <p className="min-w-0 text-xs text-tinta/70">
          Cada pedido que entra sale por la impresora de esta PC.{' '}
          <button type="button" className={enlace} onClick={() => imprimirComanda(pedidoDePrueba(), { prueba: true })}>Imprimir una de prueba</button>
          {' · '}
          <button type="button" className={enlace} onClick={probarAlarma}>Probar la alarma</button>
          {' · '}
          Para que imprima sin preguntar, abrí el panel con el{' '}
          <a href="/comandas/ODB-Pedidos.bat" download="ODB-Pedidos.bat" className={enlace}>acceso directo ODB Pedidos</a>.
        </p>
      ) : (
        <p className="min-w-0 text-xs text-tinta/60">Prendelo en las PC que tienen impresora: la comanda sale sola apenas entra el pedido.</p>
      )}
    </div>
  );
}

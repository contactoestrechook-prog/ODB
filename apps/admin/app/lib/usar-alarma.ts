'use client';

import { useEffect, useId, useRef } from 'react';
import { ALARMA, sonarEscandalo } from './alarma-pedido';

// CÓMO SUENA UN AVISO DE PEDIDO (regla con candado del 21/11/2026, ver alarma-pedido.ts).
// Todo aviso de pedido usa una de estas dos, y ninguna otra cosa:
//  · useAlarmaHastaQueSeAtienda(hayAlgo): mientras el aviso espera a alguien (un pedido
//    sin tomar, un armado asignado sin abrir, una pregunta sin contestar), la alarma suena
//    al máximo cada ALARMA.entreToquesMs. Se calla sola cuando ya no hay nada que atender.
//  · useRafagaAlLlegar(clave): para lo que aparece en la pantalla donde ya se está
//    trabajando (el armado que se abre solo, la respuesta del cliente en el armado):
//    ALARMA.toquesAlLlegar toques seguidos cada vez que llega algo nuevo.
// Si hay varios avisos esperando a la vez, suena UNA alarma (no se pisan entre sí).

const esperando = new Set<string>();
let reloj: ReturnType<typeof setTimeout> | null = null;

function tocar() {
  if (!esperando.size) { reloj = null; return; }
  sonarEscandalo();
  reloj = setTimeout(tocar, ALARMA.entreToquesMs);
}

/** Suena al máximo, sin parar, mientras `hayAlgo` sea true. */
export function useAlarmaHastaQueSeAtienda(hayAlgo: boolean) {
  const id = useId();
  useEffect(() => {
    if (!hayAlgo) return;
    esperando.add(id);
    if (!reloj) tocar();
    return () => {
      esperando.delete(id);
      if (!esperando.size && reloj) { clearTimeout(reloj); reloj = null; }
    };
  }, [hayAlgo, id]);
}

/** ALARMA.toquesAlLlegar toques seguidos cada vez que `clave` cambia a algo nuevo (null = nada). */
export function useRafagaAlLlegar(clave: string | null) {
  const ultima = useRef<string | null>(null);
  useEffect(() => {
    if (!clave || clave === ultima.current) return;
    ultima.current = clave;
    const tiempos: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < ALARMA.toquesAlLlegar; i++) tiempos.push(setTimeout(sonarEscandalo, i * ALARMA.entreToquesMs));
    return () => tiempos.forEach(clearTimeout);
  }, [clave]);
}

/** Lo mismo que useRafagaAlLlegar, para llamar en el momento (cuando llega algo en una pantalla de trabajo). */
export function sonarRafaga() {
  for (let i = 0; i < ALARMA.toquesAlLlegar; i++) setTimeout(sonarEscandalo, i * ALARMA.entreToquesMs);
}

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { alCambiarAudio, audioActivo, prepararAudio } from '../lib/alarma-pedido';
import { esRutaDeAcceso } from '../lib/rutas';
import { FOCO, unir } from './kit';

// EL SONIDO DE LOS PEDIDOS, LISTO EN TODAS LAS MÁQUINAS (regla con candado, 21/11/2026:
// «un ruido escandaloso en todas las máquinas, sin excepción»). El navegador no deja
// sonar nada hasta que la persona toca la página (salvo el acceso directo con el que se
// abren las PC con impresora). Esto despierta el audio con el primer toque o tecla en
// cualquier pantalla y, mientras siga dormido, lo dice: así el primer pedido ya suena.

export function AvisoSonidoApagado() {
  const ruta = usePathname();
  const [dormido, setDormido] = useState(false);

  useEffect(() => {
    prepararAudio();
    const mirar = () => setDormido(!audioActivo());
    const dejarDeOir = alCambiarAudio(mirar);
    const despertar = () => prepararAudio();
    window.addEventListener('pointerdown', despertar);
    window.addEventListener('keydown', despertar);
    // el estado del audio vive afuera de React: se mira al montar y cada tanto (Safari no siempre avisa)
    const t = setInterval(mirar, 3_000);
    const primero = setTimeout(mirar, 300);
    return () => {
      dejarDeOir(); clearInterval(t); clearTimeout(primero);
      window.removeEventListener('pointerdown', despertar);
      window.removeEventListener('keydown', despertar);
    };
  }, []);

  if (!dormido || esRutaDeAcceso(ruta)) return null;
  return (
    <button type="button" onClick={() => prepararAudio()} role="alert"
      className={unir('flex w-full items-center gap-2 rounded-2xl bg-marca px-4 py-2.5 text-left text-sm font-semibold text-white shadow-flotante hover:bg-marca-hondo', FOCO)}>
      <span aria-hidden="true">■</span>
      <span className="min-w-0 flex-1">El sonido de los pedidos está apagado en esta máquina: tocá acá para activarlo.</span>
    </button>
  );
}

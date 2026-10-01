'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boton, useConfirmar } from './kit';

export function BotonInforme() {
  const [cargando, setCargando] = useState(false);
  const router = useRouter();
  const { avisar, dialogo } = useConfirmar();

  const generar = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/informes', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) await avisar({ titulo: (await res.json()).message ?? 'No se pudo generar el informe' });
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <Boton onClick={generar} cargando={cargando} className="w-full sm:w-auto sm:shrink-0">
        {cargando ? 'Generando…' : 'Generar informe de ayer'}
      </Boton>
      {dialogo}
    </>
  );
}

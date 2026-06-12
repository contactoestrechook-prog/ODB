'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BotonInforme() {
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  const generar = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/informes', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) alert((await res.json()).message ?? 'No se pudo generar el informe');
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <button
      onClick={generar}
      disabled={cargando}
      className="rounded-full bg-[#B82D25] text-white text-sm px-5 py-2 hover:bg-[#932A1F] disabled:opacity-50"
    >
      {cargando ? 'Generando…' : 'Generar informe de ayer'}
    </button>
  );
}

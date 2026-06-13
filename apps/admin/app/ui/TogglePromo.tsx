'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TogglePromo({ id, activo }: { id: string; activo: boolean }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);

  const alternar = async () => {
    setCargando(true);
    try {
      await fetch('/api/descuento', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, activo: !activo }),
      });
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <button
      onClick={alternar}
      disabled={cargando}
      className={`text-xs font-medium hover:underline disabled:opacity-50 ${activo ? 'text-black/50' : 'text-emerald-700'}`}
    >
      {activo ? 'Pausar' : 'Reactivar'}
    </button>
  );
}

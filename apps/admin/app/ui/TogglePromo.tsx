'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boton } from './kit';

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
    <Boton variante={activo ? 'fantasma' : 'secundario'} tamano="chico" onClick={alternar} disabled={cargando}>
      {activo ? 'Pausar' : 'Reactivar'}
    </Boton>
  );
}

'use client';

import { useState } from 'react';
import { Boton, Etiqueta } from './kit';

export function BotonPromo({
  sku,
  nombre,
  porcentaje,
  dias = 10,
}: {
  sku: string;
  nombre: string;
  porcentaje: number;
  dias?: number;
}) {
  const [estado, setEstado] = useState<'listo' | 'creando' | 'creada' | 'error'>('listo');

  async function crear() {
    setEstado('creando');
    const res = await fetch('/api/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, nombre, porcentaje, dias }),
    });
    setEstado(res.ok ? 'creada' : 'error');
  }

  if (estado === 'creada') {
    return <Etiqueta tono="ok">promo activa {dias} días</Etiqueta>;
  }
  return (
    <Boton
      variante={estado === 'error' ? 'peligro' : 'secundario'}
      tamano="chico"
      onClick={crear}
      disabled={estado === 'creando'}
      title={`Crea el descuento −${porcentaje} % por ${dias} días`}
    >
      {estado === 'creando' ? '…' : estado === 'error' ? 'reintentar' : `liquidar −${porcentaje} %`}
    </Boton>
  );
}

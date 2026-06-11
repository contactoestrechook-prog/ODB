'use client';

import { useState } from 'react';

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
    return (
      <span className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs font-medium text-black">
        ✓ promo activa {dias} días
      </span>
    );
  }
  return (
    <button
      onClick={crear}
      disabled={estado === 'creando'}
      className="rounded-full bg-[#B82D25] px-3 py-1 text-xs font-medium text-white hover:bg-[#932A1F] disabled:opacity-50"
      title={`Crea el descuento −${porcentaje} % por ${dias} días`}
    >
      {estado === 'creando' ? '…' : estado === 'error' ? 'reintentar' : `liquidar −${porcentaje} %`}
    </button>
  );
}

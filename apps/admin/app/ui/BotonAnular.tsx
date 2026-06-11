'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BotonAnular({ ventaId, total }: { ventaId: string; total: number }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'listo' | 'anulando' | 'error'>('listo');

  async function anular() {
    if (
      !window.confirm(
        `¿Anular esta venta de $${Math.round(total).toLocaleString('es-AR')}? El stock vuelve y se emite nota de crédito.`,
      )
    )
      return;
    setEstado('anulando');
    const res = await fetch('/api/anular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ventaId }),
    });
    if (res.ok) router.refresh();
    else setEstado('error');
  }

  return (
    <button
      onClick={anular}
      disabled={estado === 'anulando'}
      className="rounded-full border border-black/15 px-3 py-1 text-xs text-black/50 hover:border-[#B82D25] hover:text-[#932A1F] disabled:opacity-50"
    >
      {estado === 'anulando' ? '…' : estado === 'error' ? 'error' : 'anular'}
    </button>
  );
}

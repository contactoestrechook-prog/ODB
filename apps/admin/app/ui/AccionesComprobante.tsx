'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AccionesComprobante({ id, estado, esFiscalDebito }: { id: string; estado: string; esFiscalDebito: boolean }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);

  const anular = async () => {
    const aviso = esFiscalDebito
      ? 'Se va a emitir la nota de crédito que revierte este comprobante. ¿Continuar?'
      : '¿Anular este comprobante?';
    if (!confirm(aviso)) return;
    setCargando(true);
    try {
      const res = await fetch('/api/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'anular', id }),
      });
      const datos = await res.json();
      if (!res.ok) {
        alert(datos.message ?? 'No se pudo anular');
        return;
      }
      if (datos.anuladoCon?.id) router.push(`/facturacion/${datos.anuladoCon.id}`);
      else router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-full bg-black text-white text-xs font-medium px-4 py-2 hover:bg-black/80"
      >
        Imprimir
      </button>
      {estado !== 'anulado' && (
        <button
          onClick={anular}
          disabled={cargando}
          className="rounded-full bg-white border border-[#B82D25]/40 text-[#B82D25] text-xs font-medium px-4 py-2 hover:bg-[#B82D25] hover:text-white disabled:opacity-50"
        >
          {cargando ? 'Anulando…' : esFiscalDebito ? 'Anular (emite NC)' : 'Anular'}
        </button>
      )}
    </div>
  );
}

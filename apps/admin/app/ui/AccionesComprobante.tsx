'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boton, useConfirmar } from './kit';

export function AccionesComprobante({ id, estado, esFiscalDebito }: { id: string; estado: string; esFiscalDebito: boolean }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const { confirmar, avisar, dialogo } = useConfirmar();

  const anular = async () => {
    const aviso = esFiscalDebito
      ? 'Se va a emitir la nota de crédito que revierte este comprobante. ¿Continuar?'
      : '¿Anular este comprobante?';
    if (!(await confirmar({ titulo: aviso, variante: 'peligro', textoConfirmar: esFiscalDebito ? 'Anular (emite NC)' : 'Anular' }))) return;
    setCargando(true);
    try {
      const res = await fetch('/api/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'anular', id }),
      });
      const datos = await res.json();
      if (!res.ok) {
        await avisar({ titulo: datos.message ?? 'No se pudo anular' });
        return;
      }
      if (datos.anuladoCon?.id) router.push(`/facturacion/${datos.anuladoCon.id}`);
      else router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Boton variante="secundario" onClick={() => window.print()}>
        Imprimir
      </Boton>
      {estado !== 'anulado' && (
        <Boton variante="peligro" onClick={anular} cargando={cargando}>
          {cargando ? 'Anulando…' : esFiscalDebito ? 'Anular (emite NC)' : 'Anular'}
        </Boton>
      )}
      {dialogo}
    </div>
  );
}

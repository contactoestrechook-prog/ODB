'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boton, useConfirmar } from './kit';
import { pesos } from '../lib/formato';

export function BotonAnular({ ventaId, total }: { ventaId: string; total: number }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'listo' | 'anulando' | 'error'>('listo');
  const { confirmar, dialogo } = useConfirmar();

  async function anular() {
    if (
      !(await confirmar({
        titulo: `¿Anular esta venta de ${pesos(Math.round(total))}?`,
        texto: 'El stock vuelve y se emite nota de crédito.',
        variante: 'peligro',
        textoConfirmar: 'Anular',
      }))
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
    <>
      <Boton variante="peligro" tamano="chico" onClick={anular} cargando={estado === 'anulando'}>
        {estado === 'error' ? 'Error' : 'Anular'}
      </Boton>
      {dialogo}
    </>
  );
}

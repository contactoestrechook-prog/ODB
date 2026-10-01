'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boton } from './kit';

export function SubirFoto({ sku }: { sku: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<'listo' | 'subiendo' | 'error'>('listo');

  async function subir(archivo: File) {
    setEstado('subiendo');
    const form = new FormData();
    form.append('imagen', archivo);
    form.append('sku', sku);
    const res = await fetch('/api/imagen', { method: 'POST', body: form });
    if (res.ok) {
      setEstado('listo');
      router.refresh();
    } else {
      setEstado('error');
    }
  }

  return (
    <>
      {/* el input queda escondido: lo abre el botón, que sí se alcanza con el teclado */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      <Boton
        variante={estado === 'error' ? 'peligro' : 'secundario'}
        tamano="chico"
        onClick={() => inputRef.current?.click()}
        disabled={estado === 'subiendo'}
      >
        {estado === 'subiendo' ? 'Subiendo…' : estado === 'error' ? 'Error: reintentar' : 'Cambiar foto'}
      </Boton>
    </>
  );
}

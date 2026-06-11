'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={estado === 'subiendo'}
        className="rounded-full border border-black/15 px-4 py-1.5 text-xs text-black/60 hover:border-[#B82D25] hover:text-[#932A1F] disabled:opacity-50"
      >
        {estado === 'subiendo' ? 'Subiendo…' : estado === 'error' ? 'Error: reintentar' : 'Cambiar foto'}
      </button>
    </>
  );
}

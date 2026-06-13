'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const datos = new FormData(e.currentTarget);
    const res = await fetch('/api/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: datos.get('email'), clave: datos.get('clave') }),
    });
    if (res.ok) {
      router.push('/inicio');
      router.refresh();
    } else {
      const cuerpo = await res.json().catch(() => null);
      setError(cuerpo?.message ?? 'No se pudo iniciar sesión');
      setCargando(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] flex items-center justify-center p-6">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-2xl bg-white p-8">
        <h1 className="text-black tracking-widest font-medium text-2xl text-center">O.D.B</h1>
        <p className="text-center text-sm text-black/50 mb-6">Panel administrativo</p>

        <label className="block text-xs text-black/60 mb-1">Email</label>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black mb-4 outline-none focus:border-[#B82D25]"
        />
        <label className="block text-xs text-black/60 mb-1">Clave</label>
        <input
          name="clave"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black mb-6 outline-none focus:border-[#B82D25]"
        />

        {error && <p className="mb-4 text-sm text-[#932A1F]">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded-full bg-[#B82D25] py-2.5 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-60"
        >
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

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
      <form onSubmit={entrar} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)] border border-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-16 w-auto mx-auto mb-3" />
        <p className="text-center text-xs tracking-[0.25em] uppercase text-black/45 mb-7">Panel administrativo</p>

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

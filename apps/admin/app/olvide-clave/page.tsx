'use client';

import { useState } from 'react';

// "Olvidé mi contraseña": se pide el mail y el sistema manda el enlace. La
// respuesta es siempre la misma exista o no la cuenta, para que nadie pueda
// averiguar quién tiene usuario probando direcciones.
export default function OlvideClave() {
  const [enviado, setEnviado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pedir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCargando(true); setError(null);
    const email = new FormData(e.currentTarget).get('email');
    try {
      const r = await fetch('/api/olvide-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo procesar el pedido');
      setEnviado(d?.mensaje ?? 'Si ese mail tiene una cuenta, le llega un enlace.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el pedido');
    }
    setCargando(false);
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)] border border-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-16 w-auto mx-auto mb-3" />
        <p className="text-center text-xs tracking-[0.25em] uppercase text-black/45 mb-7">Recuperar el acceso</p>

        {enviado ? (
          <>
            <div className="rounded-lg bg-[#F0EBE2] px-4 py-3 text-sm text-black/75 mb-5">{enviado}</div>
            <a href="/login" className="block w-full rounded-full bg-[#B82D25] py-2.5 text-center text-sm font-medium text-white hover:bg-[#932A1F]">
              Volver
            </a>
          </>
        ) : (
          <form onSubmit={pedir}>
            <p className="text-sm text-black/70 mb-5">
              Escribí el mail con el que entrás al sistema y te mandamos un enlace para elegir una contraseña nueva.
            </p>
            <label className="block text-xs text-black/60 mb-1">Email</label>
            <input
              name="email" type="email" required autoComplete="username" autoFocus
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black mb-5 outline-none focus:border-[#B82D25]"
            />
            {error && <p className="mb-3 text-sm text-[#932A1F]">{error}</p>}
            <button
              type="submit" disabled={cargando}
              className="w-full rounded-full bg-[#B82D25] py-2.5 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-60"
            >
              {cargando ? 'Enviando…' : 'Mandarme el enlace'}
            </button>
            <a href="/login" className="mt-4 block text-center text-xs text-black/50 hover:text-black/80 underline">
              Volver al ingreso
            </a>
          </form>
        )}
      </div>
    </main>
  );
}

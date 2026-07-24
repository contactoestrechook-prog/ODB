'use client';

import { useState } from 'react';

export default function CambiarClave() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const claveActual = String(f.get('actual') ?? '');
    const claveNueva = String(f.get('nueva') ?? '');
    const repetir = String(f.get('repetir') ?? '');
    if (claveNueva.length < 6) return setError('La clave nueva debe tener al menos 6 caracteres');
    if (claveNueva !== repetir) return setError('Las claves nuevas no coinciden');
    if (claveNueva === claveActual) return setError('La clave nueva tiene que ser distinta a la actual');

    setCargando(true);
    try {
      const res = await fetch('/api/cambiar-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claveActual, claveNueva }),
      });
      if (res.ok) {
        // navegación DURA: recarga completa con la sesión nueva (evita que la
        // interacción router/middleware deje el botón trabado en "Guardando…")
        window.location.assign('/inicio');
        return; // se deja "Guardando…" mientras recarga: está bien, funcionó
      }
      const c = await res.json().catch(() => null);
      setError(c?.message ?? 'No se pudo cambiar la clave');
      setCargando(false);
    } catch {
      setError('No se pudo conectar con el servidor. Reintentá en un momento.');
      setCargando(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]';

  return (
    <main className="min-h-screen bg-[#F0EBE2] flex items-center justify-center p-6">
      <form onSubmit={enviar} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)] border border-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-14 w-auto mx-auto mb-3" />
        <h1 className="text-center text-lg font-semibold text-black">Cambiá tu contraseña</h1>
        <p className="text-center text-xs text-black/50 mb-6 mt-1">
          Por seguridad, elegí una clave nueva que solo vos sepas.
        </p>

        <label className="block text-xs text-black/60 mb-1">Clave actual</label>
        <input name="actual" type="password" required autoComplete="current-password" className={`${inputCls} mb-4`} />

        <label className="block text-xs text-black/60 mb-1">Clave nueva</label>
        <input name="nueva" type="password" required minLength={6} autoComplete="new-password" className={`${inputCls} mb-4`} placeholder="Mínimo 6 caracteres" />

        <label className="block text-xs text-black/60 mb-1">Repetir clave nueva</label>
        <input name="repetir" type="password" required autoComplete="new-password" className={`${inputCls} mb-6`} />

        {error && <p className="mb-4 text-sm text-[#932A1F]">{error}</p>}

        <button type="submit" disabled={cargando} className="w-full rounded-full bg-[#B82D25] py-2.5 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-60">
          {cargando ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </main>
  );
}

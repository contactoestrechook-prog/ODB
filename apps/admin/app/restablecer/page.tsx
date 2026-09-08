'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Pantalla del enlace del mail: se valida el enlace ANTES de mostrar el
// formulario, para que nadie escriba una clave nueva y se entere recién al
// final de que el enlace venció.
function Formulario() {
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<'verificando' | 'valido' | 'invalido' | 'listo'>('verificando');
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ver, setVer] = useState(false);

  useEffect(() => {
    if (!token) { setEstado('invalido'); return; }
    fetch(`/api/olvide-clave?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setNombre(d?.nombre ?? null); setEstado(d?.valido ? 'valido' : 'invalido'); })
      .catch(() => setEstado('invalido'));
  }, [token]);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const nueva = String(datos.get('clave') ?? '');
    const repetir = String(datos.get('repetir') ?? '');
    if (nueva.length < 6) { setError('La clave nueva debe tener al menos 6 caracteres'); return; }
    if (nueva !== repetir) { setError('Las dos claves no coinciden'); return; }
    setCargando(true); setError(null);
    try {
      const r = await fetch('/api/olvide-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'confirmar', token, claveNueva: nueva }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo cambiar la clave');
      setEstado('listo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la clave');
    }
    setCargando(false);
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)] border border-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-16 w-auto mx-auto mb-3" />
        <p className="text-center text-xs tracking-[0.25em] uppercase text-black/45 mb-7">Contraseña nueva</p>

        {estado === 'verificando' && <p className="text-sm text-black/60 text-center">Verificando el enlace…</p>}

        {estado === 'invalido' && (
          <>
            <div className="rounded-lg bg-[#F7E9E7] px-4 py-3 text-sm text-[#932A1F] mb-5">
              El enlace venció o ya se usó. Pedí uno nuevo, dura 30 minutos.
            </div>
            <a href="/olvide-clave" className="block w-full rounded-full bg-[#B82D25] py-2.5 text-center text-sm font-medium text-white hover:bg-[#932A1F]">
              Pedir un enlace nuevo
            </a>
          </>
        )}

        {estado === 'listo' && (
          <>
            <div className="rounded-lg bg-[#EAF2E9] px-4 py-3 text-sm text-[#2C5F2D] mb-5">
              Listo: ya podés entrar con tu contraseña nueva.
            </div>
            <a href="/login" className="block w-full rounded-full bg-[#B82D25] py-2.5 text-center text-sm font-medium text-white hover:bg-[#932A1F]">
              Ir al ingreso
            </a>
          </>
        )}

        {estado === 'valido' && (
          <form onSubmit={guardar}>
            {nombre && <p className="text-sm text-black/70 mb-5">Hola {nombre}, elegí tu contraseña nueva.</p>}
            <label className="block text-xs text-black/60 mb-1">Contraseña nueva</label>
            <input
              name="clave" type={ver ? 'text' : 'password'} required autoComplete="new-password" autoFocus minLength={6}
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black mb-4 outline-none focus:border-[#B82D25]"
            />
            <label className="block text-xs text-black/60 mb-1">Repetila</label>
            <input
              name="repetir" type={ver ? 'text' : 'password'} required autoComplete="new-password" minLength={6}
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black mb-3 outline-none focus:border-[#B82D25]"
            />
            <label className="flex items-center gap-2 text-xs text-black/60 mb-6 cursor-pointer">
              <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="accent-[#B82D25]" />
              Mostrar la clave
            </label>
            {error && <p className="mb-3 text-sm text-[#932A1F]">{error}</p>}
            <button
              type="submit" disabled={cargando}
              className="w-full rounded-full bg-[#B82D25] py-2.5 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-60"
            >
              {cargando ? 'Guardando…' : 'Guardar y entrar'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function Restablecer() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F0EBE2]" />}>
      <Formulario />
    </Suspense>
  );
}

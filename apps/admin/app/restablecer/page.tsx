'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Aviso, Boton, Campo, Cargando, Entrada, clasesBoton } from '../ui/kit';
import { CLASE_CASILLA, PantallaAcceso } from '../ui/PantallaAcceso';

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
    <PantallaAcceso rotulo="Contraseña nueva">
      {estado === 'verificando' && <Cargando texto="Verificando el enlace…" className="justify-center" />}

      {estado === 'invalido' && (
        <div className="space-y-4">
          <Aviso tono="error">El enlace venció o ya se usó. Pedí uno nuevo, dura 30 minutos.</Aviso>
          <a href="/olvide-clave" className={clasesBoton({ anchoCompleto: true })}>
            Pedir un enlace nuevo
          </a>
        </div>
      )}

      {estado === 'listo' && (
        <div className="space-y-4">
          <Aviso tono="ok">Listo: ya podés entrar con tu contraseña nueva.</Aviso>
          <a href="/login" className={clasesBoton({ anchoCompleto: true })}>
            Ir al ingreso
          </a>
        </div>
      )}

      {estado === 'valido' && (
        <form onSubmit={guardar} className="space-y-4">
          {nombre && <p className="text-sm text-tinta/70">Hola {nombre}, elegí tu contraseña nueva.</p>}
          <Campo etiqueta="Contraseña nueva">
            <Entrada name="clave" type={ver ? 'text' : 'password'} required autoComplete="new-password" autoFocus minLength={6} />
          </Campo>
          <div>
            <Campo etiqueta="Repetila">
              <Entrada name="repetir" type={ver ? 'text' : 'password'} required autoComplete="new-password" minLength={6} />
            </Campo>
            <label className={CLASE_CASILLA}>
              <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="size-4 accent-marca" />
              Mostrar la clave
            </label>
          </div>
          {error && <Aviso tono="error">{error}</Aviso>}
          <Boton type="submit" cargando={cargando} anchoCompleto>
            {cargando ? 'Guardando…' : 'Guardar y entrar'}
          </Boton>
        </form>
      )}
    </PantallaAcceso>
  );
}

export default function Restablecer() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-crema" />}>
      <Formulario />
    </Suspense>
  );
}

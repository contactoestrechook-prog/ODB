'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Campo, Entrada } from '../ui/kit';
import { CLASE_CASILLA, PantallaAcceso } from '../ui/PantallaAcceso';

export default function CambiarClave() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ver, setVer] = useState(false);
  const [email, setEmail] = useState('');

  // email del login (cookie legible): va como campo username del formulario.
  // Sin él, el gestor de contraseñas del navegador no sabe qué credencial
  // actualizar, se queda con la clave vieja guardada y la autocompleta en el
  // próximo login → "clave incorrecta" sin que el usuario entienda por qué.
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)odb_usuario=([^;]*)/);
    if (m) setEmail(decodeURIComponent(m[1]));
  }, []);

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

  return (
    <PantallaAcceso titulo="Cambiá tu contraseña" bajada="Por seguridad, elegí una clave nueva que solo vos sepas.">
      <form onSubmit={enviar} className="space-y-4">
        {/* username oculto: imprescindible para que el navegador asocie la clave
            nueva a esta cuenta y actualice la guardada (si falta, autocompleta
            la vieja en el próximo login) */}
        <input name="email" type="email" value={email} readOnly autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />

        <Campo etiqueta="Clave actual">
          <Entrada name="actual" type={ver ? 'text' : 'password'} required autoComplete="current-password" />
        </Campo>

        <Campo etiqueta="Clave nueva">
          <Entrada name="nueva" type={ver ? 'text' : 'password'} required minLength={6} autoComplete="new-password" placeholder="Mínimo 6 caracteres" />
        </Campo>

        <div>
          <Campo etiqueta="Repetir clave nueva">
            <Entrada name="repetir" type={ver ? 'text' : 'password'} required autoComplete="new-password" />
          </Campo>
          <label className={CLASE_CASILLA}>
            <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="size-4 accent-marca" />
            Mostrar las claves mientras escribo
          </label>
        </div>

        {error && <Aviso tono="error">{error}</Aviso>}

        <Boton type="submit" cargando={cargando} anchoCompleto>
          {cargando ? 'Guardando…' : 'Cambiar contraseña'}
        </Boton>
      </form>
    </PantallaAcceso>
  );
}

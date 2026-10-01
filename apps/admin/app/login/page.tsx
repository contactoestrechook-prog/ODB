'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { landingDe } from '../lib/permisos';
import { Aviso, Boton, Campo, Entrada } from '../ui/kit';
import { CLASE_CASILLA, CLASE_ENLACE_ACCESO, PantallaAcceso } from '../ui/PantallaAcceso';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ver, setVer] = useState(false);
  const [fallos, setFallos] = useState(0);

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
      const cuerpo = await res.json().catch(() => null);
      router.push(landingDe(cuerpo?.usuario?.rol));
      router.refresh();
    } else {
      const cuerpo = await res.json().catch(() => null);
      setError(cuerpo?.message ?? 'No se pudo iniciar sesión');
      setFallos((n) => n + 1);
      setCargando(false);
    }
  }

  return (
    <PantallaAcceso rotulo="Panel administrativo">
      <form onSubmit={entrar} className="space-y-4">
        <Campo etiqueta="Email">
          <Entrada name="email" type="email" required autoComplete="username" />
        </Campo>
        <div>
          <Campo etiqueta="Clave">
            <Entrada name="clave" type={ver ? 'text' : 'password'} required autoComplete="current-password" />
          </Campo>
          <label className={CLASE_CASILLA}>
            <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="size-4 accent-marca" />
            Mostrar la clave
          </label>
        </div>

        {error && <Aviso tono="error">{error}</Aviso>}
        {fallos >= 2 && (
          <Aviso tono="info">
            Si el navegador te completa la clave solo (puntitos que aparecen sin escribir),
            puede tener guardada una clave vieja. Borrala, tildá “Mostrar la clave” y escribila a mano.
          </Aviso>
        )}

        <Boton type="submit" cargando={cargando} anchoCompleto>
          {cargando ? 'Entrando…' : 'Entrar'}
        </Boton>
      </form>

      <a href="/olvide-clave" className={CLASE_ENLACE_ACCESO}>
        Olvidé mi contraseña
      </a>
    </PantallaAcceso>
  );
}

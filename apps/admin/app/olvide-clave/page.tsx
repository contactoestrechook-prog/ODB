'use client';

import { useState } from 'react';
import { Aviso, Boton, Campo, Entrada, clasesBoton } from '../ui/kit';
import { CLASE_ENLACE_ACCESO, PantallaAcceso } from '../ui/PantallaAcceso';

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
    <PantallaAcceso rotulo="Recuperar el acceso">
      {enviado ? (
        <div className="space-y-4">
          <Aviso tono="info">{enviado}</Aviso>
          <a href="/login" className={clasesBoton({ anchoCompleto: true })}>
            Volver
          </a>
        </div>
      ) : (
        <form onSubmit={pedir} className="space-y-4">
          <p className="text-sm text-tinta/70">
            Escribí el mail con el que entrás al sistema y te mandamos un enlace para elegir una contraseña nueva.
          </p>
          <Campo etiqueta="Email">
            <Entrada name="email" type="email" required autoComplete="username" autoFocus />
          </Campo>
          {error && <Aviso tono="error">{error}</Aviso>}
          <Boton type="submit" cargando={cargando} anchoCompleto>
            {cargando ? 'Enviando…' : 'Mandarme el enlace'}
          </Boton>
          <a href="/login" className={CLASE_ENLACE_ACCESO}>
            Volver al ingreso
          </a>
        </form>
      )}
    </PantallaAcceso>
  );
}

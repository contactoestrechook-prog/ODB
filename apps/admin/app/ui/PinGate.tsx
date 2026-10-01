'use client';

import { useEffect, useState } from 'react';
import { Boton } from './kit';

// Candado liviano por PIN para las pantallas sensibles de plata (Mercado Pago,
// ARCA). No reemplaza el login+rol del servidor: es un segundo cerrojo para que,
// con el panel abierto, no cualquiera vea los números. Se recuerda por sesión.
const PIN_OK = '3105';

export function PinGate({ modulo, titulo, children }: { modulo: string; titulo: string; children: React.ReactNode }) {
  const clave = `odb_pin_${modulo}`;
  const [abierto, setAbierto] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    setAbierto(sessionStorage.getItem(clave) === '1');
    setListo(true);
  }, [clave]);

  const probar = (valor: string) => {
    if (valor === PIN_OK) {
      sessionStorage.setItem(clave, '1');
      setAbierto(true);
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  };

  if (!listo) return null;
  if (abierto) return <>{children}</>;

  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-6">
      <div className="w-full max-w-xs rounded-2xl border border-black/[0.06] bg-white p-6 text-center shadow-flotante sm:p-7">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-crema">
          <svg viewBox="0 0 24 24" className="size-6 text-marca" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 11V7a5 5 0 0110 0v4M6 11h12v9H6zM12 15v2" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-tinta">{titulo}</h2>
        <p className="mt-1 mb-4 text-sm text-tinta/60">Ingresá el PIN para ver esta sección.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          aria-label="PIN"
          aria-invalid={error || undefined}
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === 'Enter' && probar(pin)}
          placeholder="••••"
          className="block min-h-11 w-full rounded-xl border border-black/15 bg-crema-claro px-3.5 py-2 text-center text-lg tracking-[0.5em] text-tinta transition-[border-color,box-shadow,background-color] placeholder:text-tinta/40 focus:border-marca focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15 aria-invalid:border-marca aria-invalid:bg-white"
        />
        {error && <p role="alert" className="mt-2 text-sm text-marca-hondo">PIN incorrecto</p>}
        <Boton onClick={() => probar(pin)} anchoCompleto className="mt-4">
          Entrar
        </Boton>
      </div>
    </div>
  );
}

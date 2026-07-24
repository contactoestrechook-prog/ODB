'use client';

import { useEffect, useState } from 'react';

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
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-xs rounded-2xl bg-white p-7 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.35)] border border-black/5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F0EBE2]">
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-[#B82D25]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 11V7a5 5 0 0110 0v4M6 11h12v9H6zM12 15v2" />
          </svg>
        </div>
        <h2 className="font-semibold text-black">{titulo}</h2>
        <p className="text-xs text-black/50 mt-1 mb-4">Ingresá el PIN para ver esta sección.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === 'Enter' && probar(pin)}
          placeholder="••••"
          className={`w-full text-center tracking-[0.5em] text-lg rounded-lg border px-3 py-2.5 outline-none ${error ? 'border-[#B82D25]' : 'border-black/15 focus:border-[#B82D25]'}`}
        />
        {error && <p className="text-xs text-[#B82D25] mt-2">PIN incorrecto</p>}
        <button
          onClick={() => probar(pin)}
          className="mt-4 w-full rounded-full bg-[#B82D25] py-2.5 text-sm font-medium text-white hover:bg-[#932A1F]"
        >
          Entrar
        </button>
      </div>
    </div>
  );
}

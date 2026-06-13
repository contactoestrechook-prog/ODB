'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const CONDICIONES = [
  ['consumidor_final', 'Consumidor final'],
  ['responsable_inscripto', 'Responsable inscripto'],
  ['monotributo', 'Monotributo'],
  ['exento', 'Exento'],
];

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export function ConfigCliente({ cliente }: { cliente: any }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({
    nombre: cliente.nombre ?? '',
    razonSocial: cliente.razon_social ?? '',
    cuit: cliente.cuit ?? '',
    condicionIva: cliente.condicion_iva ?? 'consumidor_final',
    domicilio: cliente.domicilio ?? '',
    telefono: cliente.telefono ?? '',
    ctaCteHabilitada: !!cliente.cta_cte_habilitada,
    limiteCredito: cliente.limite_credito ?? 0,
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const campo = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/cliente-editar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cliente.id,
          ...form,
          limiteCredito: Number(form.limiteCredito) || 0,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).message ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="text-xs font-medium text-[#B82D25] hover:underline whitespace-nowrap"
      >
        {cliente.cta_cte_habilitada ? 'Cta. cte. ✓' : 'Configurar'}
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div>
              <h2 className="font-semibold text-black text-lg">{cliente.nombre ?? `DNI ${cliente.dni}`}</h2>
              <p className="text-xs text-black/45 mt-0.5">Datos fiscales y cuenta corriente</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-black/50">Razón social (para facturar)</label>
                <input value={form.razonSocial} onChange={(e) => campo('razonSocial', e.target.value)} className={input + ' mt-1'} />
              </div>
              <div>
                <label className="text-xs text-black/50">CUIT</label>
                <input value={form.cuit} onChange={(e) => campo('cuit', e.target.value)} placeholder="30-12345678-9" className={input + ' mt-1'} />
              </div>
              <div>
                <label className="text-xs text-black/50">Condición IVA</label>
                <select value={form.condicionIva} onChange={(e) => campo('condicionIva', e.target.value)} className={input + ' mt-1 bg-white'}>
                  {CONDICIONES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-black/50">Domicilio</label>
                <input value={form.domicilio} onChange={(e) => campo('domicilio', e.target.value)} className={input + ' mt-1'} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-black/50">Teléfono</label>
                <input value={form.telefono} onChange={(e) => campo('telefono', e.target.value)} className={input + ' mt-1'} />
              </div>
            </div>

            <div className="rounded-xl bg-[#F0EBE2]/60 p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-black font-medium">
                <input
                  type="checkbox"
                  checked={form.ctaCteHabilitada}
                  onChange={(e) => campo('ctaCteHabilitada', e.target.checked)}
                  className="accent-[#B82D25] w-4 h-4"
                />
                Habilitar cuenta corriente
              </label>
              <p className="text-xs text-black/45 -mt-1">
                El cliente podrá comprar a crédito y ver su saldo en la app.
              </p>
              {form.ctaCteHabilitada && (
                <div>
                  <label className="text-xs text-black/50">Límite de crédito (0 = sin tope)</label>
                  <input
                    type="number"
                    value={form.limiteCredito}
                    onChange={(e) => campo('limiteCredito', e.target.value)}
                    className={input + ' mt-1 bg-white'}
                  />
                  {Number(form.limiteCredito) > 0 && (
                    <p className="text-xs text-black/45 mt-1">Tope: {pesos(Number(form.limiteCredito))}</p>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
              <button
                onClick={guardar}
                disabled={cargando}
                className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
              >
                {cargando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

// QUIÉNES COMPRAN A ESTA CUENTA (26/11/2026). Leandro: «necesito que el sistema reconozca las
// personas que tengan cuenta corriente así el bot puede gestionar el pedido». La cuenta de una
// casa o una empresa la usan varias personas desde su WhatsApp (St Thomas 470: Cristina,
// Salvador…). Las que están acá, el bot las reconoce y les deja pagar con esta cuenta; el
// pedido queda a nombre de la cuenta, y al entregarlo se carga a ella.

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Entrada, FOCO, unir } from './kit';

type Persona = { id: string; nombre: string; telefono: string | null };
type Encontrado = { id: string; nombre?: string | null; razon_social?: string | null; telefono?: string | null; cta_cte_habilitada?: boolean | null };

const tel = (t: string | null | undefined) => {
  const d = String(t ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}` : t ?? '';
};

export function CtaCteQuienesCompran({ cuentaId, compran, habilitada, onCambio }: { cuentaId: string; compran: Persona[]; habilitada: boolean; onCambio: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Encontrado[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const turno = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) return;
    const mio = ++turno.current;
    const t = setTimeout(() => {
      fetch(`/api/buscar-cliente?q=${encodeURIComponent(texto)}`, { cache: 'no-store' })
        .then(async (r) => { const d = await r.json().catch(() => ({})); if (mio === turno.current) setRes(r.ok && Array.isArray(d?.clientes) ? d.clientes : []); })
        .catch(() => mio === turno.current && setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const mostrar = q.trim().length >= 2 ? (res ?? []).filter((x) => x.id !== cuentaId && !compran.some((p) => p.id === x.id)).slice(0, 6) : null;

  async function sumar(x: Encontrado) {
    setTrabajando(x.id); setError('');
    try {
      const r = await fetch(`/api/cta-cte/cliente/${cuentaId}/compran`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: x.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.message ?? 'No se pudo sumar.'); return; }
      setQ(''); setRes(null); onCambio();
    } finally { setTrabajando(null); }
  }

  async function sacar(p: Persona) {
    setTrabajando(p.id); setError('');
    try {
      const r = await fetch(`/api/cta-cte/cliente/${cuentaId}/compran?clienteId=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.message ?? 'No se pudo sacar.'); return; }
      onCambio();
    } finally { setTrabajando(null); }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-tinta/60">Cuando escriben por WhatsApp, el bot los reconoce y les deja pagar con esta cuenta. El pedido queda a nombre de la cuenta.</p>
      {compran.length > 0 ? (
        <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.08] bg-white">
          {compran.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words text-tinta">{p.nombre}{p.telefono ? <span className="text-tinta/60"> · {tel(p.telefono)}</span> : <span className="text-atencion"> · sin teléfono: el bot no lo puede reconocer</span>}</span>
              <Boton tamano="chico" variante="fantasma" onClick={() => sacar(p)} cargando={trabajando === p.id} disabled={!!trabajando}>Sacar</Boton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tinta/60">Nadie más compra a esta cuenta: solo el titular.</p>
      )}
      {habilitada ? (
        <>
          <Entrada aria-label="Sumar a alguien que compra a esta cuenta" value={q} onChange={(e) => { setQ(e.target.value); setError(''); }} placeholder="Sumar a alguien: nombre o teléfono" autoComplete="off" />
          {mostrar !== null && (mostrar.length ? (
            <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.08] bg-white">
              {mostrar.map((x) => (
                <li key={x.id}>
                  <button type="button" disabled={!!trabajando || !!x.cta_cte_habilitada} onClick={() => sumar(x)}
                    className={unir('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-crema-claro disabled:cursor-not-allowed disabled:opacity-50', FOCO)}>
                    <span className="min-w-0 flex-1 break-words text-tinta">{x.razon_social || x.nombre}{x.telefono ? <span className="text-tinta/60"> · {tel(x.telefono)}</span> : null}</span>
                    <span className="shrink-0 text-xs font-semibold text-marca">{x.cta_cte_habilitada ? 'Tiene su cuenta' : trabajando === x.id ? 'Sumando…' : 'Sumar'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-tinta/60">No encontré a nadie con «{q.trim()}».</p>)}
        </>
      ) : (
        <p className="text-xs text-tinta/60">La cuenta está dada de baja: para sumar a alguien, primero volvé a abrirla.</p>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

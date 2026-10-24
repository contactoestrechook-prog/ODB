'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Campo, Entrada, Modal, unir, FOCO } from './kit';
import { pesos } from '../lib/formato';
import { CtaCteDatosCliente, DATOS_VACIOS, celularSirve, type DatosForm } from './CtaCteDatosCliente';

// Sumar una cuenta corriente (24/10/2026, «que quede fácil sumar nuevas
// cuentas»): se busca el cliente (casi todos ya están en la base) o se carga
// uno nuevo; se le pone tope y, si viene con deuda de antes, el saldo inicial.

type Encontrado = {
  id: string; nombre: string; razon_social: string | null; telefono: string | null; cuit: string | null; domicilio: string | null; email: string | null; cta_cte_habilitada: boolean;
  dni: string | null; barrio: string | null; sucursal: string | null; condicion_iva: string | null; fecha_nacimiento: string | null;
};

export function CtaCteAlta({ abierto, tipo = 'cliente', onCerrar, onListo }: { abierto: boolean; tipo?: 'cliente' | 'sponsor'; onCerrar: () => void; onListo: (clienteId: string, yaTenia: boolean) => void }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<Encontrado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Encontrado | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState<DatosForm>(DATOS_VACIOS);
  const [tope, setTope] = useState('');
  const [saldo, setSaldo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  // cada vez que se abre, de cero
  useEffect(() => {
    if (!abierto) return;
    setQ(''); setResultados([]); setElegido(null); setNuevo(false); setForm(DATOS_VACIOS); setTope(''); setSaldo(''); setError('');
  }, [abierto]);

  useEffect(() => {
    if (nuevo || elegido || q.trim().length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(q.trim())}`);
        const d = await r.json().catch(() => ({}));
        setResultados((Array.isArray(d) ? d : d.items ?? []).slice(0, 8));
      } finally { setBuscando(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, nuevo, elegido]);

  const elegir = (c: Encontrado) => {
    if (c.cta_cte_habilitada) { onListo(c.id, true); return; }
    setElegido(c);
    setForm({
      nombre: c.nombre ?? '', razonSocial: c.razon_social ?? '', telefono: c.telefono ?? '', cuit: c.cuit ?? '', domicilio: c.domicilio ?? '', email: c.email ?? '',
      dni: c.dni ?? '', barrio: c.barrio ?? '', sucursal: c.sucursal ?? '', condicionIva: c.condicion_iva ?? 'consumidor_final',
      fechaNacimiento: c.fecha_nacimiento ? String(c.fecha_nacimiento).slice(0, 10) : '',
    });
  };

  const empezarNuevo = () => {
    setNuevo(true);
    // lo que escribió en la búsqueda suele ser el nombre
    setForm({ ...DATOS_VACIOS, nombre: /\d{6,}/.test(q) ? '' : q.trim(), cuit: /^\d[\d-]{9,}$/.test(q.trim()) ? q.trim() : '' });
  };

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true); setError('');
    try {
      const datos = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
      const r = await fetch('/api/cta-cte/alta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId: elegido?.id, datos, tope: Number(tope) || 0, saldoInicial: Number(saldo) || 0, tipo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : j?.message || 'No se pudo');
      onListo(j.clienteId, false);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo'); }
    finally { setGuardando(false); }
  };

  const enFormulario = nuevo || !!elegido;
  const telMalo = !!form.telefono.trim() && !celularSirve(form.telefono);

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={tipo === 'sponsor' ? 'Sumar un sponsor del Wine Fest' : 'Sumar una cuenta corriente'}
      descripcion={enFormulario ? (nuevo ? 'Cliente nuevo' : 'Revisá sus datos, completá lo que falte y poné el tope.') : 'Buscá al cliente: la mayoría ya está cargado.'}
      ancho="ancho"
      bloquearCierre={guardando}
      cerrarAlTocarAfuera={!enFormulario}
      pie={enFormulario && <>
        <Boton variante="secundario" onClick={() => { setElegido(null); setNuevo(false); }} disabled={guardando}>Volver a buscar</Boton>
        <Boton onClick={guardar} disabled={guardando || !form.nombre.trim() || telMalo}>{guardando ? 'Abriendo…' : 'Abrir la cuenta'}</Boton>
      </>}
    >
      {error && <Aviso tono="error" className="mb-3">{error}</Aviso>}
      {!enFormulario ? (
        <div className="space-y-3">
          <Campo etiqueta="Nombre, DNI o CUIT">
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. Pérez o 20123456789" autoFocus autoComplete="off" />
          </Campo>
          {buscando && <p className="text-xs text-tinta/60">Buscando…</p>}
          {resultados.length > 0 && (
            <div className="divide-y divide-black/[0.06] rounded-xl border border-black/10">
              {resultados.map((c) => (
                <button key={c.id} type="button" onClick={() => elegir(c)} className={unir('flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-crema-claro', FOCO)}>
                  <span className="min-w-0">
                    <span className="block break-words text-sm text-tinta">{c.razon_social || c.nombre}</span>
                    <span className="block text-xs text-tinta/60">{[c.cuit && `CUIT ${c.cuit}`, c.telefono, c.domicilio].filter(Boolean).join(' · ') || 'sin datos de contacto'}</span>
                  </span>
                  <span className={unir('shrink-0 text-xs font-medium', c.cta_cte_habilitada ? 'text-tinta/60' : 'text-marca-hondo')}>
                    {c.cta_cte_habilitada ? 'Ya tiene cuenta · ver ficha' : 'Sumar'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !buscando && !resultados.length && <p className="text-sm text-tinta/60">No encontré a nadie con «{q.trim()}».</p>}
          <Boton variante="secundario" onClick={empezarNuevo}>Es un cliente nuevo</Boton>
        </div>
      ) : (
        <div className="space-y-5">
          <CtaCteDatosCliente valor={form} onCambiar={setForm} deshabilitado={guardando} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Tope de crédito" ayuda="Hasta cuánto puede deber. Vacío: sin tope.">
              <Entrada value={tope} onChange={(e) => setTope(e.target.value)} type="number" inputMode="decimal" prefijo="$" placeholder="0" disabled={guardando} />
            </Campo>
            <Campo etiqueta="Ya debe (saldo inicial)" ayuda={Number(saldo) > 0 ? `Queda como «Saldo inicial al abrir la cuenta» por ${pesos(Number(saldo))}.` : 'Si arranca con una deuda de antes. Si no, dejalo vacío.'}>
              <Entrada value={saldo} onChange={(e) => setSaldo(e.target.value)} type="number" inputMode="decimal" prefijo="$" placeholder="0" disabled={guardando} />
            </Campo>
          </div>
        </div>
      )}
    </Modal>
  );
}

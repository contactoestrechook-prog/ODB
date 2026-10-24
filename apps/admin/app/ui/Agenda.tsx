'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, Entrada, Etiqueta, Tarjeta, Vacio, clasesBoton } from './kit';
import { fechaHora } from '../lib/formato';

// Agenda (menú › Clientes, 24/10/2026): todos los que escribieron a las
// líneas de WhatsApp. Cada contacto se llama o se escribe con un toque, y el
// nombre se corrige ahí mismo.

type Contacto = { id: string; nombre: string | null; nombreWhatsapp: string | null; numero: string | null; tipo: 'cliente' | 'proveedor' | 'equipo'; etiquetas: string[]; ultimoMensaje: string | null };
type Tipo = 'clientes' | 'proveedores' | 'equipo' | 'todos';

const TONO = { cliente: 'neutro', proveedor: 'info', equipo: 'ok' } as const;
const ETIQ = { cliente: 'Cliente', proveedor: 'Proveedor', equipo: 'Equipo' } as const;

/** 5491122812200 → 11 2281-2200 */
function legible(n: string) {
  const d = n.startsWith('549') ? n.slice(3) : n;
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}` : `+${n}`;
}

export function Agenda() {
  const [tipo, setTipo] = useState<Tipo>('clientes');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ total: number; paginas: number; items: Contacto[] } | null>(null);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');

  const cargar = useCallback(async (b: string, t: Tipo, p: number) => {
    setDatos(null);
    try {
      const qs = new URLSearchParams({ pagina: String(p), ...(t !== 'todos' ? { tipo: t } : {}), ...(b ? { buscar: b } : {}) });
      const r = await fetch(`/api/agenda?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || 'No pude cargar la agenda');
      setDatos(j); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Sin conexión'); }
  }, []);
  useEffect(() => { cargar('', 'clientes', 1); }, [cargar]);

  const guardarNombre = async (c: Contacto) => {
    const r = await fetch(`/api/agenda/${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) });
    if (!r.ok) { setError((await r.json().catch(() => ({}))).message || 'No se pudo guardar'); return; }
    setDatos((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? { ...x, nombre: nombre.trim() || null } : x)) });
    setEditando(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setPagina(1); cargar(buscar.trim(), tipo, 1); }} className="flex min-w-0 grow gap-2">
          <Entrada type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o número…" aria-label="Buscar en la agenda" className="min-w-0 grow" />
          <Boton type="submit">Buscar</Boton>
        </form>
        <Chips
          etiquetaAccesible="Qué contactos ver"
          valor={tipo}
          onCambiar={(t) => { setTipo(t); setPagina(1); cargar(buscar.trim(), t, 1); }}
          opciones={[{ valor: 'clientes', etiqueta: 'Clientes' }, { valor: 'proveedores', etiqueta: 'Proveedores' }, { valor: 'equipo', etiqueta: 'Equipo' }, { valor: 'todos', etiqueta: 'Todos' }]}
        />
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      <Tarjeta relleno={false} className="overflow-hidden">
        {!datos ? <Cargando bloque /> : !datos.items.length ? (
          <Vacio titulo="No hay contactos con esa búsqueda." texto="Probá con otro nombre o con parte del número." />
        ) : (
          <div className="divide-y divide-black/[0.06]">
            {datos.items.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 grow basis-56">
                  {editando === c.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); guardarNombre(c); }} className="flex gap-2">
                      <Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" aria-label="Nombre del contacto" onKeyDown={(e) => { if (e.key === 'Escape') setEditando(null); }} />
                      <Boton type="submit" tamano="chico">Guardar</Boton>
                    </form>
                  ) : (
                    <button type="button" onClick={() => { setEditando(c.id); setNombre(c.nombre ?? c.nombreWhatsapp ?? ''); }} className="rounded-sm text-left focus-visible:outline-2 focus-visible:outline-marca" title="Tocá para corregir el nombre">
                      <span className="break-words text-sm font-medium text-tinta">{c.nombre ?? c.nombreWhatsapp ?? 'Sin nombre'}</span>
                      {c.nombre && c.nombreWhatsapp && c.nombreWhatsapp !== c.nombre && <span className="ml-2 text-xs text-tinta/60">en WhatsApp: {c.nombreWhatsapp}</span>}
                    </button>
                  )}
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-tinta/60">
                    <Etiqueta tono={TONO[c.tipo]}>{ETIQ[c.tipo]}</Etiqueta>
                    <span>{c.numero ? legible(c.numero) : 'sin número'}</span>
                    {c.ultimoMensaje && <span>· último mensaje {fechaHora(c.ultimoMensaje, { conAnio: true })}</span>}
                    {c.etiquetas.map((e) => <span key={e} className="rounded-full bg-crema-hondo/70 px-2 text-tinta/70">{e}</span>)}
                  </p>
                </div>
                {c.numero && (
                  <div className="flex shrink-0 gap-2">
                    <a href={`tel:+${c.numero}`} className={clasesBoton({ tamano: 'chico', variante: 'secundario' })}>Llamar</a>
                    <a href={`https://wa.me/${c.numero}`} target="_blank" rel="noopener noreferrer" className={clasesBoton({ tamano: 'chico', variante: 'secundario' })}>WhatsApp</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {datos && datos.paginas > 1 && (
          <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-3 text-sm text-tinta/70 sm:px-5">
            <span>{datos.total} contactos · página {pagina} de {datos.paginas}</span>
            <div className="flex gap-2">
              <Boton tamano="chico" variante="secundario" disabled={pagina <= 1} onClick={() => { const p = pagina - 1; setPagina(p); cargar(buscar.trim(), tipo, p); }}>Anterior</Boton>
              <Boton tamano="chico" variante="secundario" disabled={pagina >= datos.paginas} onClick={() => { const p = pagina + 1; setPagina(p); cargar(buscar.trim(), tipo, p); }}>Siguiente</Boton>
            </div>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

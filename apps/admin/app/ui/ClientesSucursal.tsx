'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Cargando, Entrada, Kpi, Tarjeta, TarjetaCabecera } from './kit';
import { ClienteTabla } from './ClientesWorkspace';

// Clientes de una sucursal (menú › Clientes › Sant Thomas / Santa Inés,
// 24/10/2026). La sucursal no se puede adivinar de las ventas (ninguna está
// atada a un cliente), así que al lado de la lista van los que todavía no
// tienen sucursal, para sumarlos con un toque.

const NOMBRE = { st: 'Sant Thomas', si: 'Santa Inés' } as const;

export function ClientesSucursal({ sucursal, porSucursal }: { sucursal: 'st' | 'si'; porSucursal: { st: number; si: number; sin: number } }) {
  const router = useRouter();
  const [lista, setLista] = useState<any>(null);
  const [buscar, setBuscar] = useState('');
  const [sinSuc, setSinSuc] = useState<any>(null);
  const [buscarSin, setBuscarSin] = useState('');
  const [error, setError] = useState('');
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const [sumados, setSumados] = useState(0);

  const cargar = useCallback((b = '') => {
    setLista(null);
    fetch(`/api/clientes?recurso=lista&sucursal=${sucursal}${b ? `&buscar=${encodeURIComponent(b)}` : ''}`).then((r) => r.json()).then(setLista).catch(() => setError('Sin conexión'));
  }, [sucursal]);
  const cargarSin = useCallback((b = '') => {
    setSinSuc(null);
    fetch(`/api/clientes?recurso=lista&sucursal=sin${b ? `&buscar=${encodeURIComponent(b)}` : ''}`).then((r) => r.json()).then(setSinSuc).catch(() => setError('Sin conexión'));
  }, []);
  useEffect(() => { cargar(); cargarSin(); }, [cargar, cargarSin]);

  const asignar = async (c: any) => {
    if (moviendo) return;
    setMoviendo(c.id);
    try {
      const r = await fetch('/api/cliente-editar', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, sucursal }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'No se pudo');
      setSinSuc((s: any) => s && { ...s, total: Math.max((s.total ?? 1) - 1, 0), items: s.items.filter((x: any) => x.id !== c.id) });
      setSumados((n) => n + 1);
      cargar(buscar);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo'); }
    finally { setMoviendo(null); }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi etiqueta={`Clientes ${NOMBRE[sucursal]}`} valor={porSucursal[sucursal] + sumados} />
        <Kpi etiqueta={`Clientes ${NOMBRE[sucursal === 'st' ? 'si' : 'st']}`} valor={porSucursal[sucursal === 'st' ? 'si' : 'st']} href={`/clientes?sucursal=${sucursal === 'st' ? 'si' : 'st'}`} />
        <Kpi etiqueta="Sin sucursal" valor={Math.max(porSucursal.sin - sumados, 0)} tono={porSucursal.sin > 0 ? 'atencion' : 'neutro'} />
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); cargar(buscar.trim()); }} className="flex flex-wrap gap-2">
            <Entrada type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, DNI o CUIT…" aria-label={`Buscar en clientes de ${NOMBRE[sucursal]}`} className="min-w-0 grow basis-48" />
            <Boton type="submit">Buscar</Boton>
          </form>
          <ClienteTabla lista={lista} router={router} />
        </div>

        <Tarjeta relleno={false} className="h-fit overflow-hidden">
          <TarjetaCabecera titulo={`Sumar clientes a ${NOMBRE[sucursal]}`} />
          <div className="space-y-3 px-4 pb-4 sm:px-5">
            <p className="text-sm text-tinta/70">Estos todavía no tienen sucursal. Tocá «Sumar» y pasan a {NOMBRE[sucursal]}; desde «Editar datos» se cambia cuando quieras.</p>
            <form onSubmit={(e) => { e.preventDefault(); cargarSin(buscarSin.trim()); }} className="flex gap-2">
              <Entrada type="search" value={buscarSin} onChange={(e) => setBuscarSin(e.target.value)} placeholder="Buscar…" aria-label="Buscar entre los clientes sin sucursal" className="min-w-0 grow" />
              <Boton type="submit" variante="secundario">Buscar</Boton>
            </form>
            {!sinSuc ? <Cargando bloque /> : (
              <div className="max-h-[28rem] divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/10">
                {(sinSuc.items ?? []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm text-tinta">{c.razon_social || c.nombre || `DNI ${c.dni}`}</p>
                      <p className="text-xs text-tinta/60">{[c.barrio, c.telefono].filter(Boolean).join(' · ') || 'sin barrio ni teléfono'}</p>
                    </div>
                    <Boton tamano="chico" variante="secundario" onClick={() => asignar(c)} disabled={!!moviendo}>{moviendo === c.id ? '…' : 'Sumar'}</Boton>
                  </div>
                ))}
                {!(sinSuc.items ?? []).length && <p className="px-3 py-3 text-sm text-tinta/60">No hay nadie sin sucursal con esa búsqueda.</p>}
              </div>
            )}
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}

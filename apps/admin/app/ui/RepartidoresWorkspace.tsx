'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Aviso,
  Boton,
  Entrada,
  Etiqueta,
  FOCO_ADENTRO,
  Selector,
  Tarjeta,
  Vacio,
  clasesBoton,
  unir,
} from './kit';

// Alta y gestión de repartidores con sus vehículos y seguros. Los datos del
// vehículo (patente, modelo) y la póliza son los que pide la seguridad de un
// barrio cerrado; el sistema los tiene a mano al asignar un reparto.

type Vehiculo = {
  id: string; tipo: string; marca?: string; modelo?: string; patente?: string; color?: string;
  seguroCompania?: string; seguroPoliza?: string; seguroVencimiento?: string;
  seguroArchivoUrl?: string; seguroVencido?: boolean;
};
type Repartidor = {
  id: string; nombre: string; email: string; dni?: string; telefono?: string; activo: boolean; vehiculos: Vehiculo[];
};

const TIPOS = ['auto', 'moto', 'camioneta', 'bici'];

export function RepartidoresWorkspace({ inicial }: { inicial: Repartidor[] }) {
  const router = useRouter();
  const [reps, setReps] = useState<Repartidor[]>(inicial);
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', dni: '', telefono: '', clave: '' });
  const [vehForm, setVehForm] = useState<Record<string, Partial<Vehiculo>>>({});
  const [abierto, setAbierto] = useState<string | null>(null);

  async function recargar() {
    const r = await fetch('/api/repartidores', { cache: 'no-store' });
    if (r.ok) setReps(await r.json());
    router.refresh();
  }

  async function crearRepartidor() {
    if (!nuevo.nombre.trim() || !nuevo.email.trim() || nuevo.clave.length < 6) {
      setEstado({ tipo: 'error', texto: 'Nombre, email y clave (mín. 6) son obligatorios' });
      return;
    }
    setCreando(true);
    try {
      const r = await fetch('/api/repartidores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crear', ...nuevo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo crear');
      setNuevo({ nombre: '', email: '', dni: '', telefono: '', clave: '' });
      setEstado({ tipo: 'ok', texto: 'Repartidor creado' });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
    setCreando(false);
  }

  async function agregarVehiculo(repartidorId: string) {
    const v = vehForm[repartidorId];
    if (!v?.tipo) { setEstado({ tipo: 'error', texto: 'Elegí el tipo de vehículo' }); return; }
    try {
      const r = await fetch('/api/repartidores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'vehiculo', repartidorId, ...v }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo agregar');
      setVehForm((f) => ({ ...f, [repartidorId]: {} }));
      setEstado({ tipo: 'ok', texto: 'Vehículo agregado' });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function quitarVehiculo(vid: string) {
    await fetch(`/api/repartidores?vehiculoId=${vid}`, { method: 'DELETE' });
    await recargar();
  }

  async function subirPoliza(vid: string, file: File) {
    const fd = new FormData();
    fd.append('vehiculoId', vid);
    fd.append('archivo', file);
    const r = await fetch('/api/repartidores/poliza', { method: 'POST', body: fd });
    const d = await r.json();
    if (r.ok) { setEstado({ tipo: 'ok', texto: 'Póliza subida' }); await recargar(); }
    else setEstado({ tipo: 'error', texto: d.message ?? 'No se pudo subir la póliza' });
  }

  const setVeh = (id: string, campo: string, valor: any) =>
    setVehForm((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } }));

  return (
    <div className="space-y-4 sm:space-y-6">
      {estado && (
        <Aviso tono={estado.tipo === 'ok' ? 'ok' : 'error'}>
          {estado.texto}
        </Aviso>
      )}

      {/* Alta de repartidor */}
      <Tarjeta className="space-y-3">
        <h2 className="text-base font-semibold text-tinta">Nuevo repartidor</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Entrada placeholder="Nombre y apellido" aria-label="Nombre y apellido" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <Entrada placeholder="Email (para entrar a la app)" aria-label="Email (para entrar a la app)" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
          <Entrada placeholder="DNI" aria-label="DNI" value={nuevo.dni} onChange={(e) => setNuevo({ ...nuevo, dni: e.target.value })} />
          <Entrada placeholder="Teléfono" aria-label="Teléfono" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
          <Entrada type="password" placeholder="Clave (mín. 6)" aria-label="Clave (mín. 6)" value={nuevo.clave} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })} />
        </div>
        <Boton onClick={crearRepartidor} cargando={creando} className="w-full sm:w-auto">{creando ? 'Creando…' : 'Crear repartidor'}</Boton>
      </Tarjeta>

      {/* Lista de repartidores */}
      {reps.length === 0 && <Vacio titulo="Todavía no hay repartidores cargados." />}
      {reps.map((r) => (
        <Tarjeta key={r.id} relleno={false} className="overflow-hidden">
          <button
            type="button"
            aria-expanded={abierto === r.id}
            className={unir('flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
            onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
            <div className="min-w-0">
              <p className="break-words font-semibold text-tinta">{r.nombre}{!r.activo && <span className="font-normal text-tinta/60"> · inactivo</span>}</p>
              <p className="break-words text-xs text-tinta/60">{r.dni ? `DNI ${r.dni} · ` : ''}{r.telefono ?? r.email}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="text-xs text-tinta/60">{r.vehiculos.length} veh.</span>
              {r.vehiculos.some((v) => v.seguroVencido) && <Etiqueta tono="error">seguro vencido</Etiqueta>}
            </div>
          </button>

          {abierto === r.id && (
            <div className="space-y-4 border-t border-black/[0.06] px-4 pb-5 pt-4 sm:px-5">
              {/* vehículos existentes */}
              {r.vehiculos.map((v) => (
                <div key={v.id} className="space-y-2 rounded-xl bg-crema-claro p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words pt-1.5 text-sm font-medium capitalize text-tinta">
                      {[v.tipo, v.marca, v.modelo].filter(Boolean).join(' ')} {v.patente && <span className="font-mono">· {v.patente}</span>} {v.color && <span className="text-tinta/60">· {v.color}</span>}
                    </p>
                    <Boton variante="peligro" tamano="chico" className="shrink-0" onClick={() => quitarVehiculo(v.id)}>Quitar</Boton>
                  </div>
                  <p className="break-words text-xs text-tinta/70">
                    Seguro: {v.seguroCompania || '—'}{v.seguroPoliza ? ` · Póliza ${v.seguroPoliza}` : ''}{v.seguroVencimiento ? ` · Vence ${v.seguroVencimiento}` : ''}
                    {v.seguroVencido && <> <Etiqueta tono="error" className="align-middle">VENCIDO</Etiqueta></>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {v.seguroArchivoUrl
                      ? <a href={v.seguroArchivoUrl} target="_blank" rel="noreferrer" className={clasesBoton({ variante: 'secundario', tamano: 'chico' })}>Ver póliza</a>
                      : <span className="text-tinta/60">Sin póliza subida</span>}
                    <label className={clasesBoton({ variante: 'secundario', tamano: 'chico', className: 'cursor-pointer' })}>
                      {v.seguroArchivoUrl ? 'Reemplazar' : 'Subir póliza'} (PDF/foto)
                      <input type="file" accept="image/*,application/pdf" className="sr-only"
                        onChange={(e) => e.target.files?.[0] && subirPoliza(v.id, e.target.files[0])} />
                    </label>
                  </div>
                </div>
              ))}

              {/* agregar vehículo */}
              <div className="space-y-2 rounded-xl border border-dashed border-black/15 p-3">
                <p className="text-xs font-medium text-tinta/70">Agregar vehículo</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Selector aria-label="Tipo de vehículo" value={vehForm[r.id]?.tipo ?? ''} onChange={(e) => setVeh(r.id, 'tipo', e.target.value)}>
                    <option value="">Tipo…</option>
                    {TIPOS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </Selector>
                  <Entrada placeholder="Marca" aria-label="Marca" value={vehForm[r.id]?.marca ?? ''} onChange={(e) => setVeh(r.id, 'marca', e.target.value)} />
                  <Entrada placeholder="Modelo" aria-label="Modelo" value={vehForm[r.id]?.modelo ?? ''} onChange={(e) => setVeh(r.id, 'modelo', e.target.value)} />
                  <Entrada placeholder="Patente" aria-label="Patente" value={vehForm[r.id]?.patente ?? ''} onChange={(e) => setVeh(r.id, 'patente', e.target.value)} />
                  <Entrada placeholder="Color" aria-label="Color" value={vehForm[r.id]?.color ?? ''} onChange={(e) => setVeh(r.id, 'color', e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Entrada placeholder="Cía. de seguro" aria-label="Cía. de seguro" value={vehForm[r.id]?.seguroCompania ?? ''} onChange={(e) => setVeh(r.id, 'seguroCompania', e.target.value)} />
                  <Entrada placeholder="Nº de póliza" aria-label="Nº de póliza" value={vehForm[r.id]?.seguroPoliza ?? ''} onChange={(e) => setVeh(r.id, 'seguroPoliza', e.target.value)} />
                  <Entrada type="date" title="Vencimiento del seguro" aria-label="Vencimiento del seguro" value={vehForm[r.id]?.seguroVencimiento ?? ''} onChange={(e) => setVeh(r.id, 'seguroVencimiento', e.target.value)} />
                </div>
                <Boton variante="secundario" onClick={() => agregarVehiculo(r.id)}>Agregar vehículo</Boton>
              </div>
            </div>
          )}
        </Tarjeta>
      ))}
    </div>
  );
}

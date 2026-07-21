'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
const btn = 'rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50';
const btnGhost = 'rounded-full border border-black/15 text-sm px-4 py-2 hover:bg-black/5';
const input = 'w-full rounded-lg bg-[#F0EBE2]/70 px-3 py-2.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#B82D25]/40';

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
    <div className="space-y-5">
      {estado && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${estado.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-[#B82D25]'}`}>
          {estado.texto}
        </div>
      )}

      {/* Alta de repartidor */}
      <div className="rounded-xl bg-white p-5 space-y-3">
        <h2 className="font-semibold text-black">Nuevo repartidor</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={input} placeholder="Nombre y apellido" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <input className={input} placeholder="Email (para entrar a la app)" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
          <input className={input} placeholder="DNI" value={nuevo.dni} onChange={(e) => setNuevo({ ...nuevo, dni: e.target.value })} />
          <input className={input} placeholder="Teléfono" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
          <input className={input} type="password" placeholder="Clave (mín. 6)" value={nuevo.clave} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })} />
        </div>
        <button className={btn} onClick={crearRepartidor} disabled={creando}>{creando ? 'Creando…' : 'Crear repartidor'}</button>
      </div>

      {/* Lista de repartidores */}
      {reps.length === 0 && <p className="text-sm text-black/50 px-1">Todavía no hay repartidores cargados.</p>}
      {reps.map((r) => (
        <div key={r.id} className="rounded-xl bg-white overflow-hidden">
          <button className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[#F0EBE2]/50"
            onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
            <div>
              <p className="font-semibold text-black">{r.nombre}{!r.activo && <span className="text-black/40 font-normal"> · inactivo</span>}</p>
              <p className="text-xs text-black/50">{r.dni ? `DNI ${r.dni} · ` : ''}{r.telefono ?? r.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-black/50">{r.vehiculos.length} veh.</span>
              {r.vehiculos.some((v) => v.seguroVencido) && <span className="text-xs text-[#B82D25] font-medium">⚠ seguro vencido</span>}
            </div>
          </button>

          {abierto === r.id && (
            <div className="px-5 pb-5 space-y-4 border-t border-black/5 pt-4">
              {/* vehículos existentes */}
              {r.vehiculos.map((v) => (
                <div key={v.id} className="rounded-lg bg-[#F0EBE2]/60 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-black capitalize">
                      {[v.tipo, v.marca, v.modelo].filter(Boolean).join(' ')} {v.patente && <span className="font-mono">· {v.patente}</span>} {v.color && <span className="text-black/50">· {v.color}</span>}
                    </p>
                    <button className="text-xs text-[#B82D25]" onClick={() => quitarVehiculo(v.id)}>Quitar</button>
                  </div>
                  <p className="text-xs text-black/60">
                    Seguro: {v.seguroCompania || '—'}{v.seguroPoliza ? ` · Póliza ${v.seguroPoliza}` : ''}{v.seguroVencimiento ? ` · Vence ${v.seguroVencimiento}` : ''}
                    {v.seguroVencido && <span className="text-[#B82D25] font-medium"> ⚠ VENCIDO</span>}
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    {v.seguroArchivoUrl
                      ? <a href={v.seguroArchivoUrl} target="_blank" rel="noreferrer" className="text-[#B82D25] font-medium underline">Ver póliza</a>
                      : <span className="text-black/40">Sin póliza subida</span>}
                    <label className="text-black/60 cursor-pointer hover:text-black">
                      {v.seguroArchivoUrl ? 'Reemplazar' : 'Subir póliza'} (PDF/foto)
                      <input type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={(e) => e.target.files?.[0] && subirPoliza(v.id, e.target.files[0])} />
                    </label>
                  </div>
                </div>
              ))}

              {/* agregar vehículo */}
              <div className="rounded-lg border border-dashed border-black/15 p-3 space-y-2">
                <p className="text-xs font-medium text-black/60">Agregar vehículo</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <select className={input} value={vehForm[r.id]?.tipo ?? ''} onChange={(e) => setVeh(r.id, 'tipo', e.target.value)}>
                    <option value="">Tipo…</option>
                    {TIPOS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </select>
                  <input className={input} placeholder="Marca" value={vehForm[r.id]?.marca ?? ''} onChange={(e) => setVeh(r.id, 'marca', e.target.value)} />
                  <input className={input} placeholder="Modelo" value={vehForm[r.id]?.modelo ?? ''} onChange={(e) => setVeh(r.id, 'modelo', e.target.value)} />
                  <input className={input} placeholder="Patente" value={vehForm[r.id]?.patente ?? ''} onChange={(e) => setVeh(r.id, 'patente', e.target.value)} />
                  <input className={input} placeholder="Color" value={vehForm[r.id]?.color ?? ''} onChange={(e) => setVeh(r.id, 'color', e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input className={input} placeholder="Cía. de seguro" value={vehForm[r.id]?.seguroCompania ?? ''} onChange={(e) => setVeh(r.id, 'seguroCompania', e.target.value)} />
                  <input className={input} placeholder="Nº de póliza" value={vehForm[r.id]?.seguroPoliza ?? ''} onChange={(e) => setVeh(r.id, 'seguroPoliza', e.target.value)} />
                  <input className={input} type="date" title="Vencimiento del seguro" value={vehForm[r.id]?.seguroVencimiento ?? ''} onChange={(e) => setVeh(r.id, 'seguroVencimiento', e.target.value)} />
                </div>
                <button className={btnGhost} onClick={() => agregarVehiculo(r.id)}>Agregar vehículo</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

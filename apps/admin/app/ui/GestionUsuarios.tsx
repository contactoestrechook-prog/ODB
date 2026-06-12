'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES: Record<string, string> = {
  dueno: 'Dueño',
  gerente: 'Gerente',
  comprador: 'Comprador',
  cajero: 'Cajero',
  deposito: 'Depósito',
};

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

type Sucursal = { id: string; nombre: string };

const FORM_VACIO = {
  nombre: '',
  email: '',
  rol: 'cajero',
  clave: '',
  sucursalId: '',
  pin: '',
  limiteAprobacion: 0,
};

export function GestionUsuarios({ usuarios, sucursales }: { usuarios: any[]; sucursales: Sucursal[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<any>(FORM_VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const campo = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const abrirNuevo = () => {
    setForm(FORM_VACIO);
    setEditando(null);
    setError('');
    setAbierto(true);
  };

  const abrirEdicion = (u: any) => {
    setForm({
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      clave: '',
      sucursalId: u.sucursal?.id ?? '',
      pin: '',
      limiteAprobacion: u.limiteAprobacion,
    });
    setEditando(u.id);
    setError('');
    setAbierto(true);
  };

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const cuerpo: any = {
        nombre: form.nombre,
        email: form.email,
        rol: form.rol,
        sucursalId: form.sucursalId || null,
        limiteAprobacion: Number(form.limiteAprobacion) || 0,
      };
      if (form.clave) cuerpo.clave = form.clave;
      if (form.pin) cuerpo.pin = form.pin;
      const res = await fetch('/api/usuarios', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editando ? { id: editando, ...cuerpo } : cuerpo),
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

  const alternarActivo = async (u: any) => {
    await fetch('/api/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, activo: !u.activo }),
    });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-black/60">
          {usuarios.length} usuarios · los inactivos no pueden iniciar sesión
        </p>
        <button
          onClick={abrirNuevo}
          className="rounded-full bg-[#B82D25] text-white text-sm px-5 py-2 hover:bg-[#932A1F]"
        >
          + Nuevo usuario
        </button>
      </div>

      <section className="rounded-xl bg-white overflow-hidden">
        <table className="w-full text-sm text-black">
          <thead>
            <tr className="text-left text-xs text-black/50 border-b border-black/10">
              <th className="px-4 py-3 font-medium">Usuario</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Sucursal</th>
              <th className="px-4 py-3 font-medium text-right">Límite de firma</th>
              <th className="px-4 py-3 font-medium text-center">PIN</th>
              <th className="px-4 py-3 font-medium text-center">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={`border-b border-black/5 last:border-0 ${u.activo ? '' : 'opacity-50'}`}>
                <td className="px-4 py-3">
                  <p className="font-medium">{u.nombre}</p>
                  <p className="text-xs text-black/50">{u.email}</p>
                </td>
                <td className="px-4 py-3">{ROLES[u.rol] ?? u.rol}</td>
                <td className="px-4 py-3">{u.sucursal?.nombre ?? 'Todas'}</td>
                <td className="px-4 py-3 text-right">
                  {u.limiteAprobacion > 0 ? pesos(u.limiteAprobacion) : '—'}
                </td>
                <td className="px-4 py-3 text-center">{u.tienePin ? '●' : '—'}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => alternarActivo(u)}
                    className={`text-xs rounded-full px-3 py-1 ${
                      u.activo ? 'bg-green-100 text-green-800' : 'bg-black/10 text-black/60'
                    }`}
                  >
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => abrirEdicion(u)} className="text-xs text-[#B82D25] hover:underline">
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {abierto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-3">
            <h2 className="font-medium text-black">{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>

            <input
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black"
            />
            <input
              value={form.email}
              onChange={(e) => campo('email', e.target.value)}
              placeholder="Email"
              type="email"
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={form.rol}
                onChange={(e) => campo('rol', e.target.value)}
                className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
              >
                {Object.entries(ROLES).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              <select
                value={form.sucursalId}
                onChange={(e) => campo('sucursalId', e.target.value)}
                className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
              >
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={form.clave}
              onChange={(e) => campo('clave', e.target.value)}
              placeholder={editando ? 'Nueva clave (vacío = no cambiar)' : 'Clave (mín. 6 caracteres)'}
              type="password"
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-black"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.pin}
                onChange={(e) => campo('pin', e.target.value)}
                placeholder={editando ? 'Nuevo PIN de firma' : 'PIN de firma (opcional)'}
                type="password"
                inputMode="numeric"
                className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black"
              />
              <input
                value={form.limiteAprobacion}
                onChange={(e) => campo('limiteAprobacion', e.target.value)}
                placeholder="Límite de aprobación $"
                type="number"
                className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black"
              />
            </div>
            <p className="text-xs text-black/40">
              El PIN y el límite habilitan a firmar órdenes de compra hasta ese monto.
            </p>

            {error && <p className="text-xs text-[#B82D25]">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2">
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={cargando}
                className="rounded-full bg-[#B82D25] text-white text-sm px-5 py-2 hover:bg-[#932A1F] disabled:opacity-50"
              >
                {cargando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

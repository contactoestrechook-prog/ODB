'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES: Record<string, { etiqueta: string; chip: string; descripcion: string }> = {
  dueno: { etiqueta: 'Dueño', chip: 'bg-black text-white', descripcion: 'Acceso total, administra usuarios y firma sin límite' },
  gerente: { etiqueta: 'Gerente', chip: 'bg-[#B82D25]/10 text-[#932A1F]', descripcion: 'Opera todo, administra el equipo, firma hasta su límite' },
  comprador: { etiqueta: 'Comprador', chip: 'bg-amber-100 text-amber-900', descripcion: 'Compras, proveedores y Analista ODB' },
  cajero: { etiqueta: 'Cajero', chip: 'bg-sky-100 text-sky-900', descripcion: 'Ventas, caja y control de salida' },
  deposito: { etiqueta: 'Depósito', chip: 'bg-emerald-100 text-emerald-900', descripcion: 'Stock, recepción y pedidos' },
};

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

const iniciales = (nombre: string) =>
  nombre
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

type Sucursal = { id: string; nombre: string };

const FORM_VACIO = {
  nombre: '',
  email: '',
  rol: 'cajero',
  clave: '',
  sucursalId: '',
  pin: '',
  limiteAprobacion: 0,
  telefono: '',
};

// Mensaje de bienvenida con los accesos, para mandarle por WhatsApp a la persona.
function mensajeAccesos(nombre: string, email: string, clave: string) {
  const link = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    `Hola ${nombre.replace(/\(.*\)/, '').trim()}! Te damos de alta en el sistema de O.D.B 🍷\n\n` +
    `Entrá acá: ${link}\n` +
    `Usuario: ${email}\n` +
    `Clave: ${clave}\n\n` +
    `Por seguridad, cambiá la clave la primera vez que entres.`
  );
}
const soloDigitos = (t: string) => (t || '').replace(/\D/g, '');

export function GestionUsuarios({ usuarios, sucursales }: { usuarios: any[]; sucursales: Sucursal[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<any>(FORM_VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  // tras crear un usuario nuevo, guardamos sus accesos para ofrecer el envío por WhatsApp
  const [creado, setCreado] = useState<{ nombre: string; email: string; clave: string; telefono: string } | null>(null);
  const [aviso, setAviso] = useState('');

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
      telefono: u.telefono ?? '',
    });
    setEditando(u.id);
    setError('');
    setCreado(null);
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
        telefono: form.telefono || null,
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
      // usuario nuevo: mostramos el panel para enviarle los accesos por WhatsApp
      if (!editando) {
        setCreado({ nombre: form.nombre, email: form.email, clave: form.clave, telefono: form.telefono });
      } else {
        setAbierto(false);
      }
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const eliminar = async (u: any) => {
    if (!window.confirm(`¿Eliminar a ${u.nombre}? Si tiene ventas o cajas registradas, se desactiva en vez de borrarse (para no romper el historial).`)) return;
    const res = await fetch(`/api/usuarios?id=${u.id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setAviso(d.message ?? 'No se pudo eliminar'); return; }
    setAviso(d.desactivado ? d.mensaje : `${u.nombre} eliminado`);
    router.refresh();
  };

  const alternarActivo = async (u: any) => {
    await fetch('/api/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, activo: !u.activo }),
    });
    router.refresh();
  };

  const activos = usuarios.filter((u) => u.activo).length;

  return (
    <div className="space-y-5">
      {aviso && (
        <div className="flex items-center justify-between rounded-lg bg-black text-white text-sm px-4 py-2.5">
          <span>{aviso}</span>
          <button onClick={() => setAviso('')} className="text-white/60 hover:text-white">✕</button>
        </div>
      )}
      {/* resumen + acción principal */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-6">
          <div>
            <p className="text-2xl font-semibold text-black leading-none">{usuarios.length}</p>
            <p className="text-xs text-black/45 mt-1">en el equipo</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-black leading-none">{activos}</p>
            <p className="text-xs text-black/45 mt-1">activos</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-black leading-none">
              {usuarios.filter((u) => u.tienePin).length}
            </p>
            <p className="text-xs text-black/45 mt-1">con firma</p>
          </div>
        </div>
        <button
          onClick={abrirNuevo}
          className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm"
        >
          + Sumar al equipo
        </button>
      </div>

      {/* tarjetas de usuario */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {usuarios.map((u) => {
          const rol = ROLES[u.rol] ?? { etiqueta: u.rol, chip: 'bg-black/10 text-black', descripcion: '' };
          return (
            <article
              key={u.id}
              className={`rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-black/[0.04] flex flex-col gap-4 ${
                u.activo ? '' : 'opacity-55'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[#121212] text-white flex items-center justify-center text-sm font-semibold tracking-wide">
                    {iniciales(u.nombre)}
                  </div>
                  <div>
                    <p className="font-medium text-black leading-tight">{u.nombre}</p>
                    <p className="text-xs text-black/45">{u.email}</p>
                  </div>
                </div>
                <span className={`text-[11px] font-medium rounded-full px-2.5 py-1 whitespace-nowrap ${rol.chip}`}>
                  {rol.etiqueta}
                </span>
              </div>

              <p className="text-xs text-black/50 leading-relaxed">{rol.descripcion}</p>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-[#F0EBE2]/70 px-3 py-2">
                  <p className="text-black/45">Sucursal</p>
                  <p className="font-medium text-black mt-0.5">{u.sucursal?.nombre ?? 'Todas'}</p>
                </div>
                <div className="rounded-lg bg-[#F0EBE2]/70 px-3 py-2">
                  <p className="text-black/45">Firma de compras</p>
                  <p className="font-medium text-black mt-0.5">
                    {u.tienePin && u.limiteAprobacion > 0
                      ? u.limiteAprobacion >= 999_999_999
                        ? 'Sin límite'
                        : `hasta ${pesos(u.limiteAprobacion)}`
                      : 'No firma'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-black/5 pt-3 mt-auto">
                <button
                  onClick={() => alternarActivo(u)}
                  className={`text-xs rounded-full px-3 py-1.5 font-medium ${
                    u.activo
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-black/5 text-black/50 hover:bg-black/10'
                  }`}
                >
                  {u.activo ? '● Activo' : '○ Inactivo'}
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => eliminar(u)}
                    className="text-xs font-medium text-black/40 hover:text-[#B82D25]"
                  >
                    Eliminar
                  </button>
                  <button
                    onClick={() => abrirEdicion(u)}
                    className="text-xs font-medium text-[#B82D25] hover:underline"
                  >
                    Editar →
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {/* invitación a sumar */}
        <button
          onClick={abrirNuevo}
          className="rounded-2xl border-2 border-dashed border-black/15 text-black/40 hover:text-[#B82D25] hover:border-[#B82D25]/40 transition-colors flex flex-col items-center justify-center gap-2 p-8 min-h-[180px]"
        >
          <span className="text-3xl leading-none">+</span>
          <span className="text-sm font-medium">Sumar a alguien del equipo</span>
          <span className="text-xs text-black/35">cajeros, depósito, compradores…</span>
        </button>
      </div>

      {/* modal alta/edición */}
      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 shadow-2xl">
            <div>
              <h2 className="font-semibold text-black text-lg">
                {editando ? 'Editar usuario' : 'Nuevo usuario'}
              </h2>
              <p className="text-xs text-black/45 mt-0.5">
                {editando ? 'Los campos de clave y PIN solo se cambian si escribís uno nuevo.' : 'Va a poder entrar al panel con su email y clave.'}
              </p>
            </div>

            <input
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
            />
            <input
              value={form.email}
              onChange={(e) => campo('email', e.target.value)}
              placeholder="Email"
              type="email"
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
            />
            <input
              value={form.telefono}
              onChange={(e) => campo('telefono', e.target.value)}
              placeholder="WhatsApp (con cód. país, ej: 5491122334455)"
              inputMode="tel"
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={form.rol}
                onChange={(e) => campo('rol', e.target.value)}
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black bg-white focus:border-[#B82D25] focus:outline-none"
              >
                {Object.entries(ROLES).map(([valor, r]) => (
                  <option key={valor} value={valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
              <select
                value={form.sucursalId}
                onChange={(e) => campo('sucursalId', e.target.value)}
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black bg-white focus:border-[#B82D25] focus:outline-none"
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
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.pin}
                onChange={(e) => campo('pin', e.target.value)}
                placeholder={editando ? 'Nuevo PIN de firma' : 'PIN de firma (opcional)'}
                type="password"
                inputMode="numeric"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <input
                value={form.limiteAprobacion}
                onChange={(e) => campo('limiteAprobacion', e.target.value)}
                placeholder="Límite de aprobación $"
                type="number"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
            </div>
            <p className="text-xs text-black/40">
              El PIN y el límite habilitan a firmar órdenes de compra hasta ese monto.
            </p>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            {/* usuario recién creado: enviar accesos por WhatsApp */}
            {creado && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-900">✓ Usuario creado. Mandale los accesos:</p>
                <div className="flex flex-wrap items-center gap-3">
                  {soloDigitos(creado.telefono) ? (
                    <a
                      href={`https://wa.me/${soloDigitos(creado.telefono)}?text=${encodeURIComponent(mensajeAccesos(creado.nombre, creado.email, creado.clave))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-[#25D366] text-white text-sm font-medium px-4 py-2 hover:brightness-95"
                    >
                      Enviar por WhatsApp →
                    </a>
                  ) : (
                    <span className="text-xs text-emerald-900/70">No cargaste el WhatsApp de la persona — copiá el mensaje y mandáselo.</span>
                  )}
                  <button
                    onClick={() => { navigator.clipboard.writeText(mensajeAccesos(creado.nombre, creado.email, creado.clave)); setAviso('Mensaje copiado'); }}
                    className="text-xs text-emerald-900 underline"
                  >
                    Copiar mensaje
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              {creado ? (
                <button
                  onClick={() => { setAbierto(false); setCreado(null); }}
                  className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F]"
                >
                  Listo
                </button>
              ) : (
                <>
                  <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">
                    Cancelar
                  </button>
                  <button
                    onClick={guardar}
                    disabled={cargando}
                    className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
                  >
                    {cargando ? 'Guardando…' : 'Guardar'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

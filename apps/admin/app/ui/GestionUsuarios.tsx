'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pesos as pesosFmt } from '../lib/formato';
import { Aviso, Boton, Campo, Entrada, Etiqueta, FOCO, Modal, Selector, clasesBoton, unir, useConfirmar } from './kit';

const ROLES: Record<string, { etiqueta: string; descripcion: string }> = {
  dueno: { etiqueta: 'Dueño', descripcion: 'Acceso total. Es el único que firma aprobaciones: órdenes de compra y de pago, cobros a cuenta, cambios de factura y de costos' },
  gerente: { etiqueta: 'Gerente', descripcion: 'Opera todo y administra el equipo. Ve la cola de aprobaciones, pero firmar es del dueño' },
  comprador: { etiqueta: 'Comprador', descripcion: 'Compras, proveedores y Analista ODB' },
  cajero: { etiqueta: 'Cajero', descripcion: 'Ventas, caja y control de salida' },
  deposito: { etiqueta: 'Depósito', descripcion: 'Stock, recepción y pedidos' },
  administrativo: { etiqueta: 'Administrativo', descripcion: 'Backoffice: facturas de compra, remitos y recepción de mercadería, compras y proveedores. No ve caja, ventas ni dirección; los cambios sobre facturas los aprueba un dueño' },
  repartidor: { etiqueta: 'Repartidor', descripcion: 'Solo la pantalla de reparto: sus entregas del día' },
};

const pesos = (n: number) => pesosFmt(Number(n) || 0);

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
    `Clave temporal: ${clave}\n\n` +
    `La primera vez que entres, el sistema te va a pedir que elijas tu propia clave. ¡Bienvenida/o!`
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
  const { confirmar, dialogo } = useConfirmar();

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
    if (!(await confirmar({
      titulo: `¿Eliminar a ${u.nombre}?`,
      texto: 'Si tiene ventas o cajas registradas, se desactiva en vez de borrarse (para no romper el historial).',
      variante: 'peligro',
      textoConfirmar: 'Eliminar',
    }))) return;
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

  const cerrarModal = () => { setAbierto(false); setCreado(null); };

  return (
    <div className="space-y-4 sm:space-y-6">
      {aviso && (
        <Aviso
          tono="info"
          accion={<Boton variante="secundario" tamano="chico" onClick={() => setAviso('')}>Cerrar</Boton>}
        >
          {aviso}
        </Aviso>
      )}
      {/* resumen + acción principal */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div>
            <p className="importe text-2xl font-bold leading-none text-tinta">{usuarios.length}</p>
            <p className="mt-1 text-xs text-tinta/60">en el equipo</p>
          </div>
          <div>
            <p className="importe text-2xl font-bold leading-none text-tinta">{activos}</p>
            <p className="mt-1 text-xs text-tinta/60">activos</p>
          </div>
          <div>
            <p className="importe text-2xl font-bold leading-none text-tinta">
              {usuarios.filter((u) => u.tienePin).length}
            </p>
            <p className="mt-1 text-xs text-tinta/60">con firma</p>
          </div>
        </div>
        <Boton onClick={abrirNuevo} icono={<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>} className="w-full sm:w-auto">
          Sumar al equipo
        </Boton>
      </div>

      {/* tarjetas de usuario */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {usuarios.map((u) => {
          const rol = ROLES[u.rol] ?? { etiqueta: u.rol, descripcion: '' };
          return (
            <article
              key={u.id}
              className={unir(
                'flex min-w-0 flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-tarjeta sm:p-5',
                !u.activo && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tinta text-sm font-semibold tracking-wide text-white" aria-hidden="true">
                    {iniciales(u.nombre)}
                  </div>
                  <div className="min-w-0">
                    <p className="break-words font-semibold leading-tight text-tinta">{u.nombre}</p>
                    <p className="text-xs text-tinta/60 [overflow-wrap:anywhere]">{u.email}</p>
                  </div>
                </div>
                <Etiqueta className="shrink-0">{rol.etiqueta}</Etiqueta>
              </div>

              <p className="text-xs leading-relaxed text-tinta/70">{rol.descripcion}</p>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="min-w-0 rounded-xl bg-crema-claro px-3 py-2">
                  <p className="text-tinta/60">Sucursal</p>
                  <p className="mt-0.5 break-words font-medium text-tinta">{u.sucursal?.nombre ?? 'Todas'}</p>
                </div>
                <div className="min-w-0 rounded-xl bg-crema-claro px-3 py-2">
                  <p className="text-tinta/60">Firma de compras</p>
                  <p className="mt-0.5 break-words font-medium text-tinta">
                    {u.tienePin && u.limiteAprobacion > 0
                      ? u.limiteAprobacion >= 999_999_999
                        ? 'Sin límite'
                        : `hasta ${pesos(u.limiteAprobacion)}`
                      : 'No firma'}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3">
                <button
                  onClick={() => alternarActivo(u)}
                  aria-pressed={!!u.activo}
                  className={unir(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors',
                    FOCO,
                    u.activo ? 'bg-ok-suave text-ok hover:brightness-95' : 'bg-crema-hondo/70 text-tinta/70 hover:bg-crema-hondo',
                  )}
                >
                  <span className={unir('size-1.5 rounded-full', u.activo ? 'bg-current' : 'border border-current')} aria-hidden="true" />
                  {u.activo ? 'Activo' : 'Inactivo'}
                </button>
                <div className="flex items-center gap-2">
                  <Boton variante="peligro" tamano="chico" onClick={() => eliminar(u)}>
                    Eliminar
                  </Boton>
                  <Boton variante="secundario" tamano="chico" onClick={() => abrirEdicion(u)}>
                    Editar
                  </Boton>
                </div>
              </div>
            </article>
          );
        })}

        {/* invitación a sumar */}
        <button
          onClick={abrirNuevo}
          className={unir(
            'flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/15 p-8 text-tinta/60 transition-colors hover:border-marca/40 hover:text-marca-hondo',
            FOCO,
          )}
        >
          <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span className="text-sm font-semibold">Sumar a alguien del equipo</span>
          <span className="text-xs text-tinta/60">cajeros, depósito, compradores…</span>
        </button>
      </div>

      {/* modal alta/edición */}
      <Modal
        abierto={abierto}
        onCerrar={cerrarModal}
        titulo={editando ? 'Editar usuario' : 'Nuevo usuario'}
        descripcion={editando ? 'Los campos de clave y PIN solo se cambian si escribís uno nuevo.' : 'Va a poder entrar al panel con su email y clave.'}
        bloquearCierre={cargando}
        cerrarAlTocarAfuera={false}
        pie={
          creado ? (
            <Boton onClick={() => { setAbierto(false); setCreado(null); }}>
              Listo
            </Boton>
          ) : (
            <>
              <Boton variante="secundario" onClick={() => setAbierto(false)}>
                Cancelar
              </Boton>
              <Boton onClick={guardar} cargando={cargando}>
                {cargando ? 'Guardando…' : 'Guardar'}
              </Boton>
            </>
          )
        }
      >
        <div className="space-y-3">
          <Campo etiqueta="Nombre y apellido">
            <Entrada value={form.nombre} onChange={(e) => campo('nombre', e.target.value)} placeholder="Nombre y apellido" />
          </Campo>
          <Campo etiqueta="Email">
            <Entrada value={form.email} onChange={(e) => campo('email', e.target.value)} placeholder="Email" type="email" />
          </Campo>
          <Campo etiqueta="WhatsApp">
            <Entrada
              value={form.telefono}
              onChange={(e) => campo('telefono', e.target.value)}
              placeholder="WhatsApp (con cód. país, ej: 5491122334455)"
              inputMode="tel"
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Rol">
              <Selector value={form.rol} onChange={(e) => campo('rol', e.target.value)}>
                {Object.entries(ROLES).map(([valor, r]) => (
                  <option key={valor} value={valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Sucursal">
              <Selector value={form.sucursalId} onChange={(e) => campo('sucursalId', e.target.value)}>
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
          </div>
          <Campo etiqueta="Clave">
            <Entrada
              value={form.clave}
              onChange={(e) => campo('clave', e.target.value)}
              placeholder={editando ? 'Nueva clave (vacío = no cambiar)' : 'Clave (mín. 6 caracteres)'}
              type="password"
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="PIN de firma">
              <Entrada
                value={form.pin}
                onChange={(e) => campo('pin', e.target.value)}
                placeholder={editando ? 'Nuevo PIN de firma' : 'PIN de firma (opcional)'}
                type="password"
                inputMode="numeric"
              />
            </Campo>
            <Campo etiqueta="Límite de aprobación">
              <Entrada
                value={form.limiteAprobacion}
                onChange={(e) => campo('limiteAprobacion', e.target.value)}
                placeholder="Límite de aprobación $"
                type="number"
                inputMode="decimal"
                prefijo="$"
              />
            </Campo>
          </div>
          <p className="text-xs text-tinta/60">
            El PIN y el límite habilitan a firmar órdenes de compra hasta ese monto.
          </p>

          {error && <Aviso tono="error">{error}</Aviso>}

          {/* usuario recién creado: enviar accesos por WhatsApp */}
          {creado && (
            <Aviso
              tono="ok"
              titulo="Usuario creado. Mandale los accesos:"
              accion={
                <>
                  {soloDigitos(creado.telefono) && (
                    <a
                      href={`https://wa.me/${soloDigitos(creado.telefono)}?text=${encodeURIComponent(mensajeAccesos(creado.nombre, creado.email, creado.clave))}`}
                      target="_blank"
                      rel="noreferrer"
                      className={clasesBoton({ tamano: 'chico' })}
                    >
                      Enviar por WhatsApp
                    </a>
                  )}
                  <Boton
                    variante="secundario"
                    tamano="chico"
                    onClick={() => { navigator.clipboard.writeText(mensajeAccesos(creado.nombre, creado.email, creado.clave)); setAviso('Mensaje copiado'); }}
                  >
                    Copiar mensaje
                  </Boton>
                </>
              }
            >
              {!soloDigitos(creado.telefono) && 'No cargaste el WhatsApp de la persona — copiá el mensaje y mandáselo.'}
            </Aviso>
          )}
        </div>
      </Modal>
      {dialogo}
    </div>
  );
}

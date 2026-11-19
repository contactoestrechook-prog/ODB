'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pesos as pesosFmt } from '../lib/formato';
import { Aviso, Boton, Campo, Entrada, Etiqueta, FOCO, Modal, Selector, clasesBoton, unir, useConfirmar } from './kit';

const ROLES: Record<string, { etiqueta: string; descripcion: string }> = {
  dueno: { etiqueta: 'Dueño', descripcion: 'Acceso total. Es el único que firma aprobaciones: órdenes de compra y de pago, cobros a cuenta, cambios de factura y de costos' },
  gerente: { etiqueta: 'Gerente', descripcion: 'Opera todo y administra el equipo. Ve la cola de aprobaciones, pero firmar es del dueño' },
  administrativo: { etiqueta: 'Administrativo', descripcion: 'Backoffice: facturas de compra, remitos y recepción de mercadería, compras y proveedores, y completar las altas del equipo. Los cambios sobre facturas los aprueba un dueño' },
  comprador: { etiqueta: 'Comprador', descripcion: 'Compras, proveedores y Analista ODB' },
  cajero: { etiqueta: 'Caja', descripcion: 'Ventas, caja y control de salida' },
  deposito: { etiqueta: 'Depósito', descripcion: 'Stock, recepción y pedidos' },
  repartidor: { etiqueta: 'Reparto', descripcion: 'Sus entregas del día' },
  op_salon: { etiqueta: 'Op salón', descripcion: 'Arma los pedidos que le asigna la caja, ve el stock y dónde está cada producto, y carga lo que entra por puerta de depósito (administración lo confirma con la factura)' },
  fiambreria: { etiqueta: 'Fiambrería', descripcion: 'Arma en el celular los pedidos que le asigna la caja, en su sucursal' },
};
// el principal es el de más alcance: adónde entra al loguearse (igual que la API)
const ORDEN = ['dueno', 'gerente', 'administrativo', 'comprador', 'cajero', 'deposito', 'repartidor', 'op_salon', 'fiambreria'];
const ordenar = (roles: string[]) => [...new Set(roles)].filter((r) => ROLES[r]).sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b));
const CON_SUCURSAL = ['op_salon', 'fiambreria'];
const JEFES = ['dueno', 'gerente'];

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
  roles: ['cajero'] as string[],
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
const rolesDe = (u: any): string[] => ordenar(Array.isArray(u.roles) && u.roles.length ? u.roles : [u.rol]);
const etiquetas = (roles: string[]) => roles.map((r) => ROLES[r]?.etiqueta ?? r);

/**
 * soloCompletar (administración, 19/11/2026): completa nombre, email, WhatsApp y
 * clave. Altas, bajas, roles, sucursal y firma siguen siendo del dueño y el
 * gerente (la API lo frena igual).
 */
export function GestionUsuarios({ usuarios, sucursales, soloCompletar = false }: { usuarios: any[]; sucursales: Sucursal[]; soloCompletar?: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [form, setForm] = useState<any>(FORM_VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  // tras crear (o completar) un usuario, guardamos sus accesos para ofrecer el envío por WhatsApp
  const [creado, setCreado] = useState<{ nombre: string; email: string; clave: string; telefono: string } | null>(null);
  const [aviso, setAviso] = useState('');
  const { confirmar, dialogo } = useConfirmar();

  const campo = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const alternarRol = (r: string) =>
    setForm((f: any) => {
      const tiene = f.roles.includes(r);
      const roles = tiene ? f.roles.filter((x: string) => x !== r) : [...f.roles, r];
      return { ...f, roles: ordenar(roles) };
    });

  const abrirNuevo = () => {
    setForm(FORM_VACIO);
    setEditando(null);
    setError('');
    setCreado(null);
    setAbierto(true);
  };

  const abrirEdicion = (u: any) => {
    setForm({
      nombre: u.nombre,
      email: u.email ?? '',
      roles: rolesDe(u),
      clave: '',
      sucursalId: u.sucursal?.id ?? '',
      pin: '',
      limiteAprobacion: u.limiteAprobacion,
      telefono: u.telefono ?? '',
    });
    setEditando(u);
    setError('');
    setCreado(null);
    setAbierto(true);
  };

  const completando = !!editando?.altaPendiente;
  const faltaSucursal = !soloCompletar && form.roles.some((r: string) => CON_SUCURSAL.includes(r)) && !form.sucursalId;
  const faltaParaCompletar = completando && (!form.email.trim() || soloDigitos(form.telefono).length < 10 || form.clave.length < 6);

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const cuerpo: any = soloCompletar
        ? { nombre: form.nombre, email: form.email, telefono: form.telefono || null }
        : {
            nombre: form.nombre,
            email: form.email,
            roles: form.roles,
            sucursalId: form.sucursalId || null,
            limiteAprobacion: Number(form.limiteAprobacion) || 0,
            telefono: form.telefono || null,
          };
      if (form.clave) cuerpo.clave = form.clave;
      if (form.pin && !soloCompletar) cuerpo.pin = form.pin;
      const res = await fetch('/api/usuarios', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editando ? { id: editando.id, ...cuerpo } : cuerpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.message ?? 'No se pudo guardar');
        return;
      }
      // usuario nuevo o alta completada: el panel para enviarle los accesos por WhatsApp
      if (!editando || d.completada) {
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
    const res = await fetch('/api/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, activo: !u.activo }),
    });
    if (!res.ok) setAviso((await res.json().catch(() => ({}))).message ?? 'No se pudo cambiar');
    router.refresh();
  };

  const pendientes = usuarios.filter((u) => u.altaPendiente);
  const equipo = usuarios.filter((u) => !u.altaPendiente);
  const activos = equipo.filter((u) => u.activo).length;
  const puedeEditar = (u: any) => !soloCompletar || !rolesDe(u).some((r) => JEFES.includes(r));

  const cerrarModal = () => { setAbierto(false); setCreado(null); };

  const tarjeta = (u: any) => {
    const roles = rolesDe(u);
    const principal = ROLES[roles[0]] ?? { etiqueta: roles[0], descripcion: '' };
    return (
      <article
        key={u.id}
        className={unir(
          'flex min-w-0 flex-col gap-4 rounded-2xl border bg-white p-4 shadow-tarjeta sm:p-5',
          u.altaPendiente ? 'border-atencion/40' : 'border-black/[0.06]',
          !u.activo && !u.altaPendiente && 'opacity-60',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tinta text-sm font-semibold tracking-wide text-white" aria-hidden="true">
              {iniciales(u.nombre)}
            </div>
            <div className="min-w-0">
              <p className="break-words font-semibold leading-tight text-tinta">{u.nombre}</p>
              <p className="text-xs text-tinta/60 [overflow-wrap:anywhere]">{u.email || 'Sin email todavía'}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {etiquetas(roles).map((e) => <Etiqueta key={e}>{e}</Etiqueta>)}
        </div>

        {u.altaPendiente ? (
          <p className="text-xs leading-relaxed text-tinta/80">
            Falta {[!u.email && 'el email', !soloDigitos(u.telefono ?? '') && 'el WhatsApp', 'la clave'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' y $1')}. Con eso queda activo y le mandás los accesos.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-tinta/70">{principal.descripcion}</p>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="min-w-0 rounded-xl bg-crema-claro px-3 py-2">
            <p className="text-tinta/60">Sucursal</p>
            <p className="mt-0.5 break-words font-medium text-tinta">{u.sucursal?.nombre ?? 'Todas'}</p>
          </div>
          <div className="min-w-0 rounded-xl bg-crema-claro px-3 py-2">
            <p className="text-tinta/60">{u.altaPendiente ? 'WhatsApp' : 'Firma de compras'}</p>
            <p className="mt-0.5 break-words font-medium text-tinta">
              {u.altaPendiente
                ? (u.telefono || 'Falta')
                : u.tienePin && u.limiteAprobacion > 0
                  ? u.limiteAprobacion >= 999_999_999
                    ? 'Sin límite'
                    : `hasta ${pesos(u.limiteAprobacion)}`
                  : 'No firma'}
            </p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3">
          {u.altaPendiente ? (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-atencion-suave px-3 text-xs font-semibold text-atencion">
              Para completar
            </span>
          ) : soloCompletar ? (
            <span className={unir('inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', u.activo ? 'bg-ok-suave text-ok' : 'bg-crema-hondo/70 text-tinta/70')}>
              {u.activo ? 'Activo' : 'Inactivo'}
            </span>
          ) : (
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
          )}
          <div className="flex items-center gap-2">
            {!soloCompletar && (
              <Boton variante="peligro" tamano="chico" onClick={() => eliminar(u)}>
                Eliminar
              </Boton>
            )}
            {puedeEditar(u) && (
              <Boton variante={u.altaPendiente ? 'primario' : 'secundario'} tamano="chico" onClick={() => abrirEdicion(u)}>
                {u.altaPendiente ? 'Completar' : 'Editar'}
              </Boton>
            )}
          </div>
        </div>
      </article>
    );
  };

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
            <p className="importe text-2xl font-bold leading-none text-tinta">{equipo.length}</p>
            <p className="mt-1 text-xs text-tinta/60">en el equipo</p>
          </div>
          <div>
            <p className="importe text-2xl font-bold leading-none text-tinta">{activos}</p>
            <p className="mt-1 text-xs text-tinta/60">activos</p>
          </div>
          {pendientes.length > 0 && (
            <div>
              <p className="importe text-2xl font-bold leading-none text-atencion">{pendientes.length}</p>
              <p className="mt-1 text-xs text-tinta/60">para completar</p>
            </div>
          )}
          {!soloCompletar && (
            <div>
              <p className="importe text-2xl font-bold leading-none text-tinta">
                {equipo.filter((u) => u.tienePin).length}
              </p>
              <p className="mt-1 text-xs text-tinta/60">con firma</p>
            </div>
          )}
        </div>
        {!soloCompletar && (
          <Boton onClick={abrirNuevo} icono={<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>} className="w-full sm:w-auto">
            Sumar al equipo
          </Boton>
        )}
      </div>

      {/* altas para completar: email, WhatsApp y clave (19/11/2026) */}
      {pendientes.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-tinta">Para completar</h2>
            <p className="text-sm text-tinta/70">
              {pendientes.length === 1 ? 'Ya tiene' : 'Ya tienen'} sus permisos. Falta el email, el WhatsApp y la clave: con eso {pendientes.length === 1 ? 'queda activo' : 'quedan activos'} y le mandás los accesos.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{pendientes.map(tarjeta)}</div>
        </section>
      )}

      {/* tarjetas de usuario */}
      <section className="space-y-3">
        {pendientes.length > 0 && <h2 className="text-base font-semibold text-tinta">El equipo</h2>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {equipo.map(tarjeta)}

          {/* invitación a sumar */}
          {!soloCompletar && (
            <button
              onClick={abrirNuevo}
              className={unir(
                'flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/15 p-8 text-tinta/60 transition-colors hover:border-marca/40 hover:text-marca-hondo',
                FOCO,
              )}
            >
              <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <span className="text-sm font-semibold">Sumar a alguien del equipo</span>
              <span className="text-xs text-tinta/60">caja, depósito, fiambrería, reparto…</span>
            </button>
          )}
        </div>
      </section>

      {/* modal alta/edición */}
      <Modal
        abierto={abierto}
        onCerrar={cerrarModal}
        titulo={completando ? `Completar a ${editando?.nombre ?? ''}` : editando ? 'Editar usuario' : 'Nuevo usuario'}
        descripcion={
          completando
            ? 'Con el email, el WhatsApp y una clave temporal queda activo. La primera vez que entre elige la suya.'
            : editando
              ? 'Los campos de clave y PIN solo se cambian si escribís uno nuevo.'
              : 'Va a poder entrar al panel con su email y clave.'
        }
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
              <Boton onClick={guardar} cargando={cargando} disabled={faltaSucursal || (!soloCompletar && !form.roles.length) || faltaParaCompletar}>
                {cargando ? 'Guardando…' : completando ? 'Guardar y activar' : 'Guardar'}
              </Boton>
            </>
          )
        }
      >
        <div className="space-y-3">
          <Campo etiqueta="Nombre y apellido">
            <Entrada value={form.nombre} onChange={(e) => campo('nombre', e.target.value)} placeholder="Nombre y apellido" />
          </Campo>
          <Campo etiqueta="Email" obligatorio={completando}>
            <Entrada value={form.email} onChange={(e) => campo('email', e.target.value)} placeholder="Email" type="email" />
          </Campo>
          <Campo etiqueta="WhatsApp" obligatorio={completando} ayuda="Con código de país y de área">
            <Entrada
              value={form.telefono}
              onChange={(e) => campo('telefono', e.target.value)}
              placeholder="WhatsApp"
              inputMode="tel"
            />
          </Campo>

          {/* varios roles por persona (19/11/2026, planilla de St Thomas y Santa Inés) */}
          {soloCompletar ? (
            <div className="rounded-xl bg-crema-claro px-3 py-2 text-xs">
              <p className="text-tinta/60">Permisos</p>
              <p className="mt-0.5 font-medium text-tinta">
                {etiquetas(form.roles).join(' · ')}{editando?.sucursal?.nombre ? ` — ${editando.sucursal.nombre}` : ''}
              </p>
            </div>
          ) : (
            <>
              <Campo etiqueta="Roles" ayuda={form.roles.length > 1 ? `Entra por ${ROLES[form.roles[0]]?.etiqueta}; también ve ${etiquetas(form.roles.slice(1)).join(', ').replace(/, ([^,]*)$/, ' y $1')}` : 'Podés marcar más de uno'}>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Roles">
                  {ORDEN.map((r) => {
                    const marcado = form.roles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => alternarRol(r)}
                        aria-pressed={marcado}
                        className={unir(
                          'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                          FOCO,
                          marcado ? 'border-tinta bg-tinta text-white' : 'border-black/15 bg-white text-tinta/80 hover:border-tinta/40',
                        )}
                      >
                        {ROLES[r].etiqueta}
                      </button>
                    );
                  })}
                </div>
              </Campo>
              {/* op salón y fiambrería: cada uno es de UNA sucursal (5/11/2026) */}
              <Campo etiqueta="Sucursal" obligatorio={faltaSucursal || form.roles.some((r: string) => CON_SUCURSAL.includes(r))} ayuda={form.roles.some((r: string) => CON_SUCURSAL.includes(r)) ? 'Solo ve y arma los pedidos de esta sucursal' : undefined}>
                <Selector value={form.sucursalId} onChange={(e) => campo('sucursalId', e.target.value)}>
                  <option value="">{form.roles.some((r: string) => CON_SUCURSAL.includes(r)) ? 'Elegí la sucursal' : 'Todas las sucursales'}</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </Selector>
              </Campo>
            </>
          )}

          <Campo etiqueta={completando ? 'Clave temporal' : 'Clave'} obligatorio={completando}>
            <Entrada
              value={form.clave}
              onChange={(e) => campo('clave', e.target.value)}
              placeholder={completando ? 'Mínimo 6 caracteres' : editando ? 'Nueva clave (vacío = no cambiar)' : 'Clave (mín. 6 caracteres)'}
              type="password"
            />
          </Campo>
          {!soloCompletar && !completando && (
            <>
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
            </>
          )}

          {error && <Aviso tono="error">{error}</Aviso>}

          {/* usuario recién creado o completado: enviar accesos por WhatsApp */}
          {creado && (
            <Aviso
              tono="ok"
              titulo={completando ? 'Listo, ya puede entrar. Mandale los accesos:' : 'Usuario creado. Mandale los accesos:'}
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

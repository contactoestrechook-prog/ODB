'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AreaTexto, Aviso, BarraInferior, Boton, BotonLink, Campo, Cargando, Entrada, Etiqueta, Kpi, Selector, Tarjeta, TarjetaCabecera, TarjetaCuerpo, useConfirmar,
} from './kit';
import { cuit as cuitLegible, fecha, pesos } from '../lib/formato';

// Ficha de un proveedor (27/10/2026): datos fiscales, contacto, condiciones,
// banco, las personas y los papeles (catálogos, listas, constancia de CUIT).
// Todo se guarda con un solo botón; el WhatsApp se verifica contra WhatsApp
// porque es el número al que sale el pedido.

type Proveedor = Record<string, any> & { id: string; razon_social: string; activo: boolean; faltan: string[] };
type Contacto = { id: string; nombre: string; rol: string; telefono: string | null; email: string | null; notas: string | null };
type Documento = { id: string; tipo: string; nombre: string; tipo_archivo: string | null; tamano: number | null; vigencia_hasta: string | null; creado_en: string; subidoPor: string | null };
type Ficha = {
  proveedor: Proveedor; contactos: Contacto[]; documentos: Documento[]; ordenes: any[]; facturasPendientes: any[];
  deuda: number; productos: number; listas: any[];
};

const IVA = [
  { valor: 'responsable_inscripto', etiqueta: 'Responsable inscripto' },
  { valor: 'monotributo', etiqueta: 'Monotributo' },
  { valor: 'exento', etiqueta: 'Exento' },
  { valor: 'consumidor_final', etiqueta: 'Consumidor final' },
];
const ROLES = [
  { valor: 'vendedor', etiqueta: 'Vendedor / preventista' },
  { valor: 'cobranzas', etiqueta: 'Cobranzas' },
  { valor: 'reparto', etiqueta: 'Reparto' },
  { valor: 'administracion', etiqueta: 'Administración' },
  { valor: 'dueno', etiqueta: 'Dueño' },
  { valor: 'otro', etiqueta: 'Otro' },
];
const TIPOS_DOC = [
  { valor: 'catalogo', etiqueta: 'Catálogo' },
  { valor: 'lista_precios', etiqueta: 'Lista de precios' },
  { valor: 'constancia_cuit', etiqueta: 'Constancia de CUIT' },
  { valor: 'datos_bancarios', etiqueta: 'Datos bancarios' },
  { valor: 'contrato', etiqueta: 'Contrato o acuerdo' },
  { valor: 'otro', etiqueta: 'Otro' },
];
const nombreDe = (lista: { valor: string; etiqueta: string }[], v: string) => lista.find((x) => x.valor === v)?.etiqueta ?? v;

// campo de pantalla → columna de la base (lo que se compara para saber si cambió)
const CAMPOS: [string, string][] = [
  ['razonSocial', 'razon_social'], ['nombreFantasia', 'nombre_fantasia'], ['cuit', 'cuit'], ['condicionIva', 'condicion_iva'],
  ['telefono', 'telefono'], ['telefonoFijo', 'telefono_fijo'], ['email', 'email'], ['web', 'web'],
  ['direccion', 'direccion'], ['localidad', 'localidad'],
  ['condicionPago', 'condicion_pago'], ['leadTimeDias', 'lead_time_dias'], ['leadTimeConfirmado', 'lead_time_confirmado'],
  ['diasPedido', 'dias_pedido'], ['diasEntrega', 'dias_entrega'], ['pedidoMinimo', 'pedido_minimo'], ['descuentoEfectivo', 'descuento_efectivo'],
  ['banco', 'banco'], ['cbu', 'cbu'], ['aliasCbu', 'alias_cbu'], ['notas', 'notas'],
];

function formularioDe(p: Proveedor): Record<string, any> {
  const f: Record<string, any> = {};
  for (const [campo, col] of CAMPOS) {
    const v = p[col];
    if (campo === 'leadTimeConfirmado') f[campo] = v === true;
    else if (campo === 'cuit') f[campo] = v ? cuitLegible(v) : '';
    else if (campo === 'telefono') f[campo] = telefonoLegible(v);
    else f[campo] = v == null ? '' : String(v);
  }
  return f;
}

// 5491123456789 → 11 2345-6789
function telefonoLegible(t: unknown) {
  const s = String(t ?? '');
  const d = s.replace(/\D/g, '').replace(/^549/, '');
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}` : s;
}

function tamanoLegible(n: number | null) {
  if (!n) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function enviar(cuerpo: Record<string, unknown>) {
  const r = await fetch('/api/proveedores-ficha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join('. ') : (j?.message ?? 'No se pudo guardar'));
  return j;
}

export function FichaProveedor({ id }: { id: string }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [inicial, setInicial] = useState<Record<string, any>>({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { confirmar, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/proveedores-ficha?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude abrir la ficha');
      setFicha(j);
      const f = formularioDe(j.proveedor);
      setForm(f);
      setInicial(f);
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const cambios = useMemo(() => Object.keys(form).filter((k) => form[k] !== inicial[k]), [form, inicial]);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // avisar si se va con cambios sin guardar
  useEffect(() => {
    if (!cambios.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [cambios.length]);

  async function guardar() {
    if (!cambios.length) return;
    setGuardando(true); setError(null); setAviso(null);
    try {
      const cuerpo: Record<string, unknown> = { accion: 'guardar', id };
      for (const k of cambios) cuerpo[k] = form[k];
      const j = await enviar(cuerpo);
      setFicha(j);
      const f = formularioDe(j.proveedor);
      setForm(f); setInicial(f);
      setAviso('Guardado.');
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  async function cambiarActivo() {
    if (!ficha) return;
    const activo = ficha.proveedor.activo;
    const ok = await confirmar(activo
      ? { titulo: '¿Dar de baja este proveedor?', texto: 'Deja de aparecer para pedir y comprar. Se puede reactivar desde «Dados de baja».', textoConfirmar: 'Dar de baja', variante: 'peligro' }
      : { titulo: '¿Reactivar este proveedor?', texto: 'Vuelve a aparecer para pedir y comprar.', textoConfirmar: 'Reactivar' });
    if (!ok) return;
    try { await enviar({ accion: 'activo', id, activo: !activo }); await cargar(); } catch (e: any) { setError(e.message); }
  }

  if (!ficha) return error ? <Aviso tono="error">{error}</Aviso> : <Cargando bloque />;
  const p = ficha.proveedor;

  return (
    <div className="space-y-4">
      {dialogo}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Logo id={id} url={p.logo_url ?? null} tieneWeb={!!p.web} onCambio={cargar} />
          <div className="min-w-0">
          <Link href="/proveedores" className="text-sm text-tinta/70 hover:text-tinta">← Proveedores</Link>
          <h1 className="mt-1 text-2xl font-bold text-tinta [overflow-wrap:anywhere]">{p.razon_social}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {!p.activo && <Etiqueta tono="error">Dado de baja</Etiqueta>}
            {p.logo_url && p.logo_auto && <Etiqueta tono="info">Logo traído solo: revisalo</Etiqueta>}
            {p.faltan.length === 0
              ? <Etiqueta tono="ok">Ficha completa</Etiqueta>
              : <p className="text-sm text-tinta/70"><b className="text-tinta">Falta:</b> {p.faltan.join(', ')}</p>}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotonLink variante="secundario" tamano="chico" href={`/pedido-proveedor?proveedor=${id}`}>Armar pedido</BotonLink>
          <BotonLink variante="secundario" tamano="chico" href={`/compras?proveedor=${id}`}>Ver en Compras</BotonLink>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi etiqueta="Productos" valor={String(ficha.productos)} />
        <Kpi etiqueta="Deuda" valor={pesos(ficha.deuda)} tono={ficha.deuda > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Sin pagar" valor={String(ficha.facturasPendientes.length)} />
        <Kpi etiqueta="Papeles" valor={String(ficha.documentos.length)} />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Datos fiscales" />
          <TarjetaCuerpo className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Razón social" obligatorio className="sm:col-span-2">
              <Entrada value={form.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} />
            </Campo>
            <Campo etiqueta="Nombre de fantasía" className="sm:col-span-2">
              <Entrada value={form.nombreFantasia} onChange={(e) => set('nombreFantasia', e.target.value)} placeholder="Como lo conocen en el local" />
            </Campo>
            <Campo etiqueta="CUIT">
              <Entrada inputMode="numeric" value={form.cuit} onChange={(e) => set('cuit', e.target.value)} placeholder="30-12345678-9" />
            </Campo>
            <Campo etiqueta="Condición de IVA">
              <Selector vacio="Elegí…" opciones={IVA} value={form.condicionIva} onChange={(e) => set('condicionIva', e.target.value)} />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Contacto y dirección" />
          <TarjetaCuerpo className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="WhatsApp para pedidos" ayuda="A este número sale el pedido firmado. Se verifica que tenga WhatsApp.">
              <Entrada inputMode="tel" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="11 2345-6789" />
            </Campo>
            <Campo etiqueta="Teléfono fijo">
              <Entrada inputMode="tel" value={form.telefonoFijo} onChange={(e) => set('telefonoFijo', e.target.value)} placeholder="011 4234-5678" />
            </Campo>
            <Campo etiqueta="Mail">
              <Entrada type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Campo>
            <Campo etiqueta="Web">
              <Entrada value={form.web} onChange={(e) => set('web', e.target.value)} placeholder="www…" />
            </Campo>
            <Campo etiqueta="Dirección">
              <Entrada value={form.direccion} onChange={(e) => set('direccion', e.target.value)} placeholder="Calle y número" />
            </Campo>
            <Campo etiqueta="Localidad">
              <Entrada value={form.localidad} onChange={(e) => set('localidad', e.target.value)} />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Condiciones comerciales" />
          <TarjetaCuerpo className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Condición de pago">
              <Entrada value={form.condicionPago} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Contado, 15 días, 30 días…" />
            </Campo>
            <Campo etiqueta="Pedido mínimo">
              <Entrada inputMode="decimal" prefijo="$" value={form.pedidoMinimo} onChange={(e) => set('pedidoMinimo', e.target.value)} />
            </Campo>
            <Campo etiqueta="Plazo de entrega (días)">
              <Entrada inputMode="numeric" value={form.leadTimeDias} onChange={(e) => set('leadTimeDias', e.target.value)} />
            </Campo>
            <Campo etiqueta="Descuento por pago en efectivo">
              <Entrada inputMode="decimal" sufijo="%" value={form.descuentoEfectivo} onChange={(e) => set('descuentoEfectivo', e.target.value)} />
            </Campo>
            <label className="flex items-center gap-2 text-sm text-tinta sm:col-span-2">
              <input type="checkbox" className="size-4 accent-marca" checked={!!form.leadTimeConfirmado} onChange={(e) => set('leadTimeConfirmado', e.target.checked)} />
              El plazo de entrega está confirmado con el proveedor
            </label>
            <Campo etiqueta="Días que toma pedidos">
              <Entrada value={form.diasPedido} onChange={(e) => set('diasPedido', e.target.value)} placeholder="Ej.: lunes y jueves" />
            </Campo>
            <Campo etiqueta="Días que entrega">
              <Entrada value={form.diasEntrega} onChange={(e) => set('diasEntrega', e.target.value)} placeholder="Ej.: martes y viernes a la mañana" />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Datos bancarios" sub="Para pagarle por transferencia" />
          <TarjetaCuerpo className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Banco">
              <Entrada value={form.banco} onChange={(e) => set('banco', e.target.value)} />
            </Campo>
            <Campo etiqueta="Alias">
              <Entrada value={form.aliasCbu} onChange={(e) => set('aliasCbu', e.target.value)} />
            </Campo>
            <Campo etiqueta="CBU o CVU" className="sm:col-span-2">
              <Entrada inputMode="numeric" value={form.cbu} onChange={(e) => set('cbu', e.target.value)} placeholder="22 números" />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>
      </div>

      <Tarjeta relleno={false}>
        <TarjetaCabecera titulo="Notas" />
        <TarjetaCuerpo>
          <AreaTexto rows={3} value={form.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Lo que conviene saber: con quién hablar, horarios de descarga, acuerdos…" />
        </TarjetaCuerpo>
      </Tarjeta>

      <Contactos id={id} contactos={ficha.contactos} onCambio={cargar} confirmar={confirmar} />
      <Documentos id={id} documentos={ficha.documentos} onCambio={cargar} confirmar={confirmar} />

      {(ficha.facturasPendientes.length > 0 || ficha.ordenes.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Facturas sin pagar" accion={<BotonLink variante="fantasma" tamano="chico" href="/facturas-compra">Ver todas</BotonLink>} />
            <ul className="divide-y divide-black/[0.06]">
              {ficha.facturasPendientes.length === 0 && <li className="px-4 py-3 text-sm text-tinta/60 sm:px-5">No debe nada.</li>}
              {ficha.facturasPendientes.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0 truncate">{[f.tipo, f.letra, f.numero].filter(Boolean).join(' ')} · vence {fecha(f.vencimiento)}</span>
                  <span className="font-semibold tabular-nums">{pesos(Number(f.monto) - Number(f.monto_pagado ?? 0))}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Últimas órdenes de compra" />
            <ul className="divide-y divide-black/[0.06]">
              {ficha.ordenes.length === 0 && <li className="px-4 py-3 text-sm text-tinta/60 sm:px-5">Todavía no se le pidió nada desde ODB.</li>}
              {ficha.ordenes.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0 truncate">OC {o.numero ?? ''} · {fecha(o.creado_en)} · {String(o.estado).replace(/_/g, ' ')}</span>
                  <span className="font-semibold tabular-nums">{pesos(o.total)}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
      )}

      <div className="flex justify-end">
        <Boton variante={p.activo ? 'peligro' : 'secundario'} tamano="chico" onClick={() => void cambiarActivo()}>
          {p.activo ? 'Dar de baja el proveedor' : 'Reactivar el proveedor'}
        </Boton>
      </div>

      {/* Guardar siempre a mano, también en el celular */}
      {cambios.length > 0 ? (
        <BarraInferior etiqueta="Guardar la ficha" resumen={error
          ? <span className="text-sm font-semibold text-marca-hondo">{error}</span>
          : <span className="text-sm text-tinta/70">{cambios.length} cambio{cambios.length === 1 ? '' : 's'} sin guardar</span>}>
          <Boton variante="secundario" onClick={() => { setForm(inicial); setError(null); }} disabled={guardando}>Descartar</Boton>
          <Boton onClick={() => void guardar()} cargando={guardando}>Guardar</Boton>
        </BarraInferior>
      ) : aviso && <Aviso tono="ok">{aviso}</Aviso>}
    </div>
  );
}

type Confirmar = ReturnType<typeof useConfirmar>['confirmar'];

function Contactos({ id, contactos, onCambio, confirmar }: { id: string; contactos: Contacto[]; onCambio: () => Promise<void>; confirmar: Confirmar }) {
  const vacio = { nombre: '', rol: 'vendedor', telefono: '', email: '', notas: '' };
  const [editando, setEditando] = useState<(typeof vacio & { contactoId?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!editando) return;
    setGuardando(true); setError(null);
    try {
      const { contactoId, ...datos } = editando;
      await enviar(contactoId ? { accion: 'editarContacto', contactoId, ...datos } : { accion: 'contacto', id, ...datos });
      setEditando(null);
      await onCambio();
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  async function borrar(c: Contacto) {
    if (!(await confirmar({ titulo: `¿Borrar a ${c.nombre}?`, textoConfirmar: 'Borrar', variante: 'peligro' }))) return;
    try { await enviar({ accion: 'borrarContacto', contactoId: c.id }); await onCambio(); } catch (e: any) { setError(e.message); }
  }

  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera
        titulo="Personas"
        sub="Vendedor, cobranzas, reparto: a quién llamar para cada cosa"
        accion={!editando && <Boton variante="secundario" tamano="chico" onClick={() => setEditando(vacio)}>Agregar</Boton>}
      />
      <ul className="divide-y divide-black/[0.06]">
        {contactos.length === 0 && !editando && <li className="px-4 py-3 text-sm text-tinta/60 sm:px-5">Todavía no hay personas cargadas.</li>}
        {contactos.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-tinta">{c.nombre} <span className="font-normal text-tinta/60">· {nombreDe(ROLES, c.rol)}</span></p>
              <p className="text-tinta/70 [overflow-wrap:anywhere]">{[c.telefono, c.email].filter(Boolean).join(' · ')}{c.notas ? ` · ${c.notas}` : ''}</p>
            </div>
            <div className="flex gap-1">
              <Boton variante="fantasma" tamano="chico" onClick={() => setEditando({ contactoId: c.id, nombre: c.nombre, rol: c.rol, telefono: c.telefono ?? '', email: c.email ?? '', notas: c.notas ?? '' })}>Editar</Boton>
              <Boton variante="fantasma" tamano="chico" onClick={() => void borrar(c)}>Borrar</Boton>
            </div>
          </li>
        ))}
      </ul>
      {editando && (
        <TarjetaCuerpo className="grid gap-3 border-t border-black/[0.06] sm:grid-cols-2">
          <Campo etiqueta="Nombre" obligatorio>
            <Entrada value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} autoFocus />
          </Campo>
          <Campo etiqueta="Qué hace">
            <Selector opciones={ROLES} value={editando.rol} onChange={(e) => setEditando({ ...editando, rol: e.target.value })} />
          </Campo>
          <Campo etiqueta="Teléfono">
            <Entrada inputMode="tel" value={editando.telefono} onChange={(e) => setEditando({ ...editando, telefono: e.target.value })} />
          </Campo>
          <Campo etiqueta="Mail">
            <Entrada type="email" value={editando.email} onChange={(e) => setEditando({ ...editando, email: e.target.value })} />
          </Campo>
          <Campo etiqueta="Nota" className="sm:col-span-2">
            <Entrada value={editando.notas} onChange={(e) => setEditando({ ...editando, notas: e.target.value })} placeholder="Ej.: pasa los martes" />
          </Campo>
          {error && <Aviso tono="error" className="sm:col-span-2">{error}</Aviso>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Boton variante="secundario" onClick={() => { setEditando(null); setError(null); }}>Cancelar</Boton>
            <Boton onClick={() => void guardar()} cargando={guardando}>Guardar persona</Boton>
          </div>
        </TarjetaCuerpo>
      )}
      {error && !editando && <TarjetaCuerpo><Aviso tono="error">{error}</Aviso></TarjetaCuerpo>}
    </Tarjeta>
  );
}

function Documentos({ id, documentos, onCambio, confirmar }: { id: string; documentos: Documento[]; onCambio: () => Promise<void>; confirmar: Confirmar }) {
  const [tipo, setTipo] = useState('catalogo');
  const [nombre, setNombre] = useState('');
  const [vigencia, setVigencia] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function subir() {
    if (!archivo) { setError('Elegí el archivo'); return; }
    if (archivo.size > 25 * 1024 * 1024) { setError('El archivo pesa más de 25 MB'); return; }
    setSubiendo(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('proveedorId', id);
      fd.append('tipo', tipo);
      if (nombre.trim()) fd.append('nombre', nombre.trim());
      if (vigencia) fd.append('vigenciaHasta', vigencia);
      const r = await fetch('/api/proveedores-ficha', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude subir el archivo');
      setArchivo(null); setNombre(''); setVigencia('');
      if (input.current) input.current.value = '';
      await onCambio();
    } catch (e: any) { setError(e.message); } finally { setSubiendo(false); }
  }

  async function abrir(d: Documento) {
    // la ventana se abre ya (si se abre después del await, el celular la bloquea)
    const ventana = window.open('', '_blank');
    try {
      const r = await fetch(`/api/proveedores-ficha?documento=${encodeURIComponent(d.id)}`);
      const j = await r.json();
      if (!r.ok || !j?.url) throw new Error(j?.message ?? 'No pude abrir el archivo');
      if (ventana) ventana.location.href = j.url; else window.location.href = j.url;
    } catch (e: any) { ventana?.close(); setError(e.message); }
  }

  async function borrar(d: Documento) {
    if (!(await confirmar({ titulo: `¿Sacar «${d.nombre}»?`, texto: 'Deja de verse en la ficha. Queda registrado quién lo sacó.', textoConfirmar: 'Sacar', variante: 'peligro' }))) return;
    try { await enviar({ accion: 'borrarDocumento', documentoId: d.id }); await onCambio(); } catch (e: any) { setError(e.message); }
  }

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera titulo="Catálogos y papeles" sub="PDF o foto, hasta 25 MB: catálogo, lista de precios, constancia de CUIT, datos bancarios" />
      <ul className="divide-y divide-black/[0.06]">
        {documentos.length === 0 && <li className="px-4 py-3 text-sm text-tinta/60 sm:px-5">Todavía no hay papeles cargados.</li>}
        {documentos.map((d) => {
          const vencido = d.vigencia_hasta && d.vigencia_hasta < hoy;
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-tinta [overflow-wrap:anywhere]">{d.nombre}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-tinta/60">
                  <span>{nombreDe(TIPOS_DOC, d.tipo)}</span>
                  <span>· {fecha(d.creado_en)}{d.subidoPor ? ` · ${d.subidoPor}` : ''}</span>
                  {d.tamano ? <span>· {tamanoLegible(d.tamano)}</span> : null}
                  {d.vigencia_hasta && (vencido ? <Etiqueta tono="atencion">Venció el {fecha(d.vigencia_hasta)}</Etiqueta> : <span>· vale hasta {fecha(d.vigencia_hasta)}</span>)}
                </p>
              </div>
              <div className="flex gap-1">
                <Boton variante="secundario" tamano="chico" onClick={() => void abrir(d)}>Abrir</Boton>
                <Boton variante="fantasma" tamano="chico" onClick={() => void borrar(d)}>Sacar</Boton>
              </div>
            </li>
          );
        })}
      </ul>
      <TarjetaCuerpo className="grid gap-3 border-t border-black/[0.06] sm:grid-cols-2">
        <Campo etiqueta="Qué es">
          <Selector opciones={TIPOS_DOC} value={tipo} onChange={(e) => setTipo(e.target.value)} />
        </Campo>
        <Campo etiqueta="Archivo">
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="block w-full min-w-0 text-sm text-tinta file:mr-3 file:rounded-full file:border file:border-black/15 file:bg-white file:px-4 file:py-2 file:text-sm file:text-tinta"
          />
        </Campo>
        <Campo etiqueta="Nombre" ayuda="Si lo dejás vacío, usa el nombre del archivo.">
          <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Catálogo verano 2026" />
        </Campo>
        <Campo etiqueta="Vale hasta" ayuda="Opcional: para listas de precios y constancias.">
          <Entrada type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
        </Campo>
        {error && <Aviso tono="error" className="sm:col-span-2">{error}</Aviso>}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          {tipo === 'lista_precios'
            ? <p className="text-xs text-tinta/60">Para leer los precios y actualizar costos, subila también en <Link className="underline" href="/listas">Listas de proveedor</Link>.</p>
            : <span />}
          <Boton onClick={() => void subir()} cargando={subiendo} disabled={!archivo}>Subir</Boton>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  );
}

// El logo de la marca: se sube a mano o se trae de la web del proveedor.
function Logo({ id, url, tieneWeb, onCambio }: { id: string; url: string | null; tieneWeb: boolean; onCambio: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function hacer(f: () => Promise<Response>) {
    setTrabajando(true); setError(null);
    try {
      const r = await f();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude cambiar el logo');
      setAbierto(false);
      await onCambio();
    } catch (e: any) { setError(e.message); } finally { setTrabajando(false); }
  }
  const subir = (archivo: File) => hacer(() => {
    const fd = new FormData();
    fd.append('archivo', archivo); fd.append('proveedorId', id); fd.append('destino', 'logo');
    return fetch('/api/proveedores-ficha', { method: 'POST', body: fd });
  });
  const json = (accion: string) => hacer(() => fetch('/api/proveedores-ficha', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, id }),
  }));

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-label={url ? 'Cambiar el logo' : 'Agregar el logo'}
        className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-black/10 bg-white text-xs text-tinta/60 hover:border-black/25 sm:size-20"
      >
        {url ? <img src={url} alt="" className="size-full object-contain p-1.5" /> : 'Logo'}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ''; }} />
      {abierto && (
        <div className="absolute left-0 top-full z-modal mt-2 w-64 space-y-2 rounded-2xl border border-black/10 bg-white p-3 shadow-flotante">
          <Boton variante="secundario" tamano="chico" anchoCompleto onClick={() => input.current?.click()} cargando={trabajando}>Subir una imagen</Boton>
          <Boton variante="secundario" tamano="chico" anchoCompleto onClick={() => void json('logoWeb')} disabled={!tieneWeb || trabajando}>Traerlo de su web</Boton>
          {!tieneWeb && <p className="text-xs text-tinta/60">Para traerlo solo, cargá y guardá la web del proveedor.</p>}
          {url && <Boton variante="fantasma" tamano="chico" anchoCompleto onClick={() => void json('sacarLogo')} disabled={trabajando}>Sacar el logo</Boton>}
          {error && <p className="text-xs font-semibold text-marca-hondo">{error}</p>}
        </div>
      )}
    </div>
  );
}

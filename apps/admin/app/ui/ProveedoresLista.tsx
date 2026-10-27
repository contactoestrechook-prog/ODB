'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Cargando, Chips, Entrada, Etiqueta, Modal, TablaResponsiva, Vacio } from './kit';
import { cuit, hace, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// Proveedores (27/10/2026). Pedido de Leandro: «un módulo para que
// administración vea y pueda cargar bien todos los proveedores actuales con
// número de teléfono, dirección, CUIT, que puedan subir PDF para catálogo y
// todo el resto». La lista muestra qué le falta a cada ficha; al tocar uno se
// abre la ficha completa (/proveedores/[id]).

type Fila = {
  id: string; razonSocial: string; nombreFantasia: string | null; cuit: string | null; telefono: string | null;
  localidad: string | null; activo: boolean; logo: string | null; productos: number; ultimaActividad: string | null; deuda: number;
  documentos: number; contactos: number; faltan: string[];
};

type Filtro = 'activos' | 'compras' | 'incompletos' | 'sin_whatsapp' | 'baja';

// 5491123456789 → 11 2345-6789
function telefonoCorto(t: string | null) {
  if (!t) return null;
  const d = t.replace(/\D/g, '').replace(/^549/, '');
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}` : t;
}

export function ProveedoresLista() {
  const router = useRouter();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('compras');
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/proveedores-ficha', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer los proveedores');
      setFilas(j);
    } catch (e: any) { setError(e.message); setFilas([]); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const cuentas = useMemo(() => {
    const f = filas ?? [];
    const act = f.filter((p) => p.activo);
    return {
      activos: act.length,
      compras: act.filter((p) => p.ultimaActividad).length,
      incompletos: act.filter((p) => p.faltan.length).length,
      sin_whatsapp: act.filter((p) => !p.telefono).length,
      baja: f.length - act.length,
    };
  }, [filas]);

  const visibles = useMemo(() => {
    const f = (filas ?? []).filter((p) => {
      if (filtro === 'baja') return !p.activo;
      if (!p.activo) return false;
      if (filtro === 'compras') return !!p.ultimaActividad;
      if (filtro === 'incompletos') return p.faltan.length > 0;
      if (filtro === 'sin_whatsapp') return !p.telefono;
      return true;
    });
    const buscados = filtrarPorBusqueda(f, q, (p) => `${p.razonSocial} ${p.nombreFantasia ?? ''} ${p.cuit ?? ''} ${p.localidad ?? ''}`);
    // con movimiento arriba, después los que tienen más productos
    return q ? buscados : [...buscados].sort((a, b) =>
      String(b.ultimaActividad ?? '').localeCompare(String(a.ultimaActividad ?? '')) || b.productos - a.productos);
  }, [filas, filtro, q]);

  // a medida que se completan las fichas, este número sube
  const completos = filas ? filas.filter((p) => p.activo && p.faltan.length === 0).length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-tinta/70">
          {filas ? <>Fichas completas: <b className="text-tinta">{completos}</b> de {cuentas.activos} proveedores activos.</> : ' '}
        </p>
        <Boton onClick={() => setNuevo(true)}>Nuevo proveedor</Boton>
      </div>

      <Entrada type="search" placeholder="Buscar por nombre, CUIT o localidad" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar proveedor" />

      <Chips<Filtro>
        desplazable
        etiquetaAccesible="Qué proveedores ver"
        valor={filtro}
        onCambiar={setFiltro}
        opciones={[
          { valor: 'compras', etiqueta: 'Con compras en ODB', cuenta: cuentas.compras },
          { valor: 'incompletos', etiqueta: 'Ficha incompleta', cuenta: cuentas.incompletos },
          { valor: 'sin_whatsapp', etiqueta: 'Sin WhatsApp', cuenta: cuentas.sin_whatsapp },
          { valor: 'activos', etiqueta: 'Todos los activos', cuenta: cuentas.activos },
          { valor: 'baja', etiqueta: 'Dados de baja', cuenta: cuentas.baja },
        ]}
      />

      {filtro === 'compras' && filas && (
        <p className="text-xs text-tinta/60">
          Los que tienen una orden, un remito o una factura cargada en ODB. Saint Thomas todavía compra con el sistema viejo: el resto está en «Todos los activos».
        </p>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}
      {!filas ? <Cargando bloque /> : (
        <TablaResponsiva<Fila>
          etiqueta="Proveedores"
          filas={visibles}
          claveFila="id"
          hrefFila={(p) => `/proveedores/${p.id}`}
          vacio={<Vacio titulo={q ? 'Ningún proveedor coincide.' : 'No hay proveedores en este filtro.'} />}
          columnas={[
            {
              clave: 'nombre', titulo: 'Proveedor', principal: true,
              celda: (p) => (
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-white text-sm font-bold text-tinta/60">
                    {p.logo ? <img src={p.logo} alt="" className="size-full object-contain p-1" loading="lazy" /> : p.razonSocial.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                  <p className="truncate font-semibold text-tinta">{p.razonSocial}</p>
                  <p className="truncate text-xs text-tinta/60">
                    {[p.nombreFantasia, p.cuit ? cuit(p.cuit) : null, p.localidad].filter(Boolean).join(' · ') || 'Sin CUIT'}
                  </p>
                  </div>
                </div>
              ),
            },
            { clave: 'whatsapp', titulo: 'WhatsApp', ocultarEnMovil: true, celda: (p) => telefonoCorto(p.telefono) ?? <span className="text-tinta/60">Falta</span> },
            {
              clave: 'faltan', titulo: 'Ficha',
              celda: (p) => p.faltan.length === 0
                ? <Etiqueta tono="ok">Completa</Etiqueta>
                : <span className="text-xs text-tinta/70" title={`Falta: ${p.faltan.join(', ')}`}>Falta {p.faltan.slice(0, 2).join(', ')}{p.faltan.length > 2 ? ` y ${p.faltan.length - 2} más` : ''}</span>,
            },
            { clave: 'productos', titulo: 'Productos', alinear: 'derecha', ocultarEnMovil: true, celda: (p) => p.productos },
            { clave: 'docs', titulo: 'Papeles', alinear: 'derecha', ocultarEnMovil: true, celda: (p) => p.documentos || '—' },
            { clave: 'deuda', titulo: 'Deuda', importe: true, ocultarEnMovil: true, celda: (p) => (p.deuda > 0 ? pesos(p.deuda) : '—') },
            { clave: 'actividad', titulo: 'Última compra', ocultarEnMovil: true, celda: (p) => (p.ultimaActividad ? hace(p.ultimaActividad) : '—') },
          ]}
        />
      )}

      <NuevoProveedor abierto={nuevo} onCerrar={() => setNuevo(false)} onCreado={(id) => router.push(`/proveedores/${id}`)} />
    </div>
  );
}

function NuevoProveedor({ abierto, onCerrar, onCreado }: { abierto: boolean; onCerrar: () => void; onCreado: (id: string) => void }) {
  const [razonSocial, setRazonSocial] = useState('');
  const [cuitTxt, setCuit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    setError(null);
    if (!razonSocial.trim()) { setError('Poné la razón social'); return; }
    setGuardando(true);
    try {
      const r = await fetch('/api/proveedores-ficha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crear', razonSocial, ...(cuitTxt.trim() ? { cuit: cuitTxt } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude crear el proveedor');
      onCreado(j.id);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo proveedor"
      descripcion="Con la razón social alcanza para crearlo; el resto se completa en la ficha."
      ancho="chico"
      pie={(
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton onClick={() => void crear()} cargando={guardando}>Crear y abrir la ficha</Boton>
        </div>
      )}
    >
      <div className="space-y-3">
        <Campo etiqueta="Razón social" obligatorio>
          <Entrada value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} autoFocus />
        </Campo>
        <Campo etiqueta="CUIT" ayuda="Si lo tenés: así no se carga dos veces el mismo proveedor.">
          <Entrada inputMode="numeric" placeholder="30-12345678-9" value={cuitTxt} onChange={(e) => setCuit(e.target.value)} />
        </Campo>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

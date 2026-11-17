'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { numero } from '../../lib/formato';
import { Aviso, Boton, Campo, Chips, Entrada, FOCO_ADENTRO, Selector, Tarjeta, unir } from '../kit';
import { api, nombrePropio, sucursalCorta, type ProductoStock, type Sucursal } from './comun';

// PUERTA DE DEPÓSITO (rediseño del 17/11/2026). Lo que baja con remito se
// carga acá y espera la factura: no suma al stock hasta que administración lo
// confirma en Compras › Puerta de depósito. A la izquierda se carga, a la
// derecha se ve qué pasó con cada ingreso.

type Renglon = { sku: string; nombre: string; cantidad: number; vencimiento: string };
type Ingreso = {
  id: string; numero: number; numero_remito: string; notas: string | null; estado: 'espera_factura' | 'ingresado' | 'rechazado' | string;
  creado_en: string; numero_factura: string | null; motivo_rechazo: string | null; creadoPorNombre: string | null; confirmadoPorNombre: string | null;
  proveedor: { nombre: string } | null; sucursal: { nombre: string } | null;
  items: { cantidad: number; cantidad_confirmada: number | null; vencimiento: string | null; producto: { sku: string; nombre: string } | null }[];
};
type Filtro = 'espera_factura' | 'ingresado' | 'rechazado' | 'todos';

export function Puerta({ proveedores, sucursales, sucursalPropia }: { proveedores: { id: string; nombre: string }[]; sucursales: Sucursal[]; sucursalPropia: string | null }) {
  const [proveedorId, setProveedorId] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursalPropia ?? (sucursales.length === 1 ? sucursales[0].id : ''));
  const [remito, setRemito] = useState('');
  const [notas, setNotas] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<ProductoStock[]>([]);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ingresos, setIngresos] = useState<Ingreso[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('espera_factura');

  const cargarIngresos = useCallback(async () => {
    try { setIngresos(await api<Ingreso[]>('GET', { recurso: 'ingresos', estado: 'todos' })); } catch { setIngresos([]); }
  }, []);
  useEffect(() => { cargarIngresos(); }, [cargarIngresos]);

  function agregar(sku: string, nombre: string) {
    setRenglones((xs) => {
      const i = xs.findIndex((x) => x.sku === sku);
      if (i >= 0) return xs.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + 1 } : x));
      return [{ sku, nombre, cantidad: 1, vencimiento: '' }, ...xs];
    });
    setBusca('');
    setSug([]);
  }

  async function buscar() {
    const t = busca.trim();
    if (t.length < 2) return;
    try {
      const c = await api('GET', { recurso: 'codigo', codigo: t });
      if (c?.encontrado) { agregar(c.sku, c.nombre); setAviso(null); return; }
      const r = await api<ProductoStock[]>('GET', { recurso: 'stock', q: t });
      if (r.length === 1) agregar(r[0].sku, r[0].nombre);
      else { setSug(r.slice(0, 8)); if (!r.length) setAviso({ tono: 'error', texto: 'Ese producto no está en el sistema: avisale a administración.' }); }
    } catch (e: any) { setAviso({ tono: 'error', texto: e.message }); }
  }

  async function enviar() {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await api('POST', {
        accion: 'ingreso', proveedorId, sucursalId, numeroRemito: remito, notas,
        items: renglones.map((x) => ({ sku: x.sku, cantidad: x.cantidad, vencimiento: x.vencimiento || undefined })),
      });
      setAviso({ tono: 'ok', texto: `Ingreso #${r.numero} enviado. Espera la factura: cuando administración lo confirme, suma al stock.` });
      setRenglones([]); setRemito(''); setNotas('');
      setFiltro('espera_factura');
      cargarIngresos();
    } catch (e: any) { setAviso({ tono: 'error', texto: e.message }); }
    finally { setEnviando(false); }
  }

  const unidades = renglones.reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
  const listo = proveedorId && sucursalId && remito.trim() && renglones.length && renglones.every((r) => r.cantidad > 0);
  const cuenta = (e: Filtro) => (ingresos ?? []).filter((i) => e === 'todos' || i.estado === e).length;
  const vistos = (ingresos ?? []).filter((i) => filtro === 'todos' || i.estado === filtro);

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* cargar: tres pasos, en el orden en que se hace en la puerta */}
      <Tarjeta relleno={false}>
        <div className="border-b border-black/[0.06] px-4 py-3 sm:px-5">
          <h2 className="text-base font-bold text-tinta">Cargar lo que bajó</h2>
          <p className="text-xs text-tinta/60">No suma al stock todavía: entra cuando administración lo confirma con la factura.</p>
        </div>

        <Paso n={1} titulo="De quién viene">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Proveedor" obligatorio>
              <Selector value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} vacio="Elegí el proveedor" opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.nombre }))} />
            </Campo>
            <Campo etiqueta="N.º de remito" obligatorio>
              <Entrada value={remito} onChange={(e) => setRemito(e.target.value)} />
            </Campo>
            {sucursales.length > 1 && (
              <Campo etiqueta="Sucursal" obligatorio>
                <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} vacio="Elegí la sucursal" opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: sucursalCorta(s.nombre) }))} />
              </Campo>
            )}
          </div>
        </Paso>

        <Paso n={2} titulo="Qué bajó" extra={renglones.length ? `${numero(renglones.length)} ${renglones.length === 1 ? 'producto' : 'productos'} · ${numero(unidades, 2)} unidades` : undefined}>
          <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="flex gap-2">
            <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Producto que bajó" placeholder="Escaneá o buscá el producto" className="flex-1" />
            <Boton type="submit" variante="secundario" disabled={busca.trim().length < 2}>Sumar</Boton>
          </form>
          {sug.length > 0 && (
            <ul className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/10 bg-white">
              {sug.map((s) => (
                <li key={s.id}><button type="button" onClick={() => agregar(s.sku, s.nombre)} className={unir('w-full px-3 py-2 text-left text-sm hover:bg-crema-claro', FOCO_ADENTRO)}>{s.nombre} <span className="text-tinta/60">· {s.sku}</span></button></li>
              ))}
            </ul>
          )}
          {renglones.length === 0 ? (
            <p className="mt-3 text-sm text-tinta/60">Escaneá cada bulto: si ya está en la lista, suma uno.</p>
          ) : (
            <ul className="mt-3 divide-y divide-black/[0.06] rounded-xl border border-black/[0.06]">
              {renglones.map((r, j) => (
                <li key={r.sku} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-tinta">{r.nombre}</p>
                    <p className="truncate text-xs text-tinta/60">{r.sku}</p>
                  </div>
                  <Entrada type="number" inputMode="decimal" min={0} step="any" value={String(r.cantidad)} aria-label={`Cantidad de ${r.nombre}`} className="text-right"
                    onChange={(e) => setRenglones((xs) => xs.map((x, k) => (k === j ? { ...x, cantidad: Number(e.target.value) } : x)))} />
                  <Entrada type="date" value={r.vencimiento} aria-label={`Vencimiento de ${r.nombre} (si tiene)`} title="Vence (si tiene)"
                    onChange={(e) => setRenglones((xs) => xs.map((x, k) => (k === j ? { ...x, vencimiento: e.target.value } : x)))} />
                  <Boton tamano="chico" variante="fantasma" onClick={() => setRenglones((xs) => xs.filter((_, k) => k !== j))}>Quitar</Boton>
                </li>
              ))}
            </ul>
          )}
        </Paso>

        <Paso n={3} titulo="Mandar a administración" ultimo>
          <Campo etiqueta="Notas para administración">
            <Entrada value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} />
          </Campo>
          {aviso && <div className="mt-3"><Aviso tono={aviso.tono}>{aviso.texto}</Aviso></div>}
          <Boton anchoCompleto onClick={enviar} disabled={!listo} cargando={enviando} className="mt-3">
            Enviar a administración{renglones.length ? ` · ${numero(renglones.length)} ${renglones.length === 1 ? 'producto' : 'productos'}` : ''}
          </Boton>
          {!listo && <p className="mt-2 text-xs text-tinta/60">{faltaParaEnviar({ proveedorId, sucursalId, remito, renglones })}</p>}
        </Paso>
      </Tarjeta>

      {/* qué pasó con cada ingreso */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-base font-bold text-tinta">Ingresos por la puerta</h2>
          <span className="text-xs text-tinta/60">Los últimos 100</span>
        </div>
        <Chips className="mb-3" etiquetaAccesible="Estado" valor={filtro} onCambiar={setFiltro} desplazable
          opciones={[
            { valor: 'espera_factura', etiqueta: 'Esperan factura', cuenta: cuenta('espera_factura') },
            { valor: 'ingresado', etiqueta: 'En stock', cuenta: cuenta('ingresado') },
            { valor: 'rechazado', etiqueta: 'Rechazados', cuenta: cuenta('rechazado') },
            { valor: 'todos', etiqueta: 'Todos', cuenta: cuenta('todos') },
          ]} />
        <Tarjeta relleno={false} className="divide-y divide-black/[0.06]">
          {ingresos === null && <p className="p-4 text-sm text-tinta/60">Buscando…</p>}
          {ingresos?.length === 0 && (
            <div className="p-4 sm:p-5">
              <p className="text-sm font-semibold text-tinta">Todavía no entró nada por la puerta de depósito.</p>
              <p className="mt-1 text-sm text-tinta/70">Lo que cargues queda acá esperando la factura, y se ve cuando administración lo pasa al stock o lo rechaza.</p>
            </div>
          )}
          {ingresos && ingresos.length > 0 && vistos.length === 0 && <p className="p-4 text-sm text-tinta/70">No hay ingresos en este estado.</p>}
          {vistos.map((i) => <FilaIngreso key={i.id} i={i} />)}
        </Tarjeta>
      </section>
    </div>
  );
}

function faltaParaEnviar({ proveedorId, sucursalId, remito, renglones }: { proveedorId: string; sucursalId: string; remito: string; renglones: Renglon[] }) {
  const falta = [
    !proveedorId && 'el proveedor',
    !remito.trim() && 'el n.º de remito',
    !sucursalId && 'la sucursal',
    !renglones.length && 'al menos un producto',
    renglones.some((r) => !(r.cantidad > 0)) && 'la cantidad de cada producto',
  ].filter(Boolean) as string[];
  return falta.length ? `Falta ${falta.length > 1 ? `${falta.slice(0, -1).join(', ')} y ${falta[falta.length - 1]}` : falta[0]}.` : '';
}

function Paso({ n, titulo, extra, ultimo = false, children }: { n: number; titulo: string; extra?: string; ultimo?: boolean; children: ReactNode }) {
  return (
    <div className={unir('px-4 py-4 sm:px-5', !ultimo && 'border-b border-black/[0.06]')}>
      <div className="mb-3 flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tinta text-xs font-bold text-white">{n}</span>
        <h3 className="text-sm font-bold text-tinta">{titulo}</h3>
        {extra && <span className="ml-auto text-xs text-tinta/60">{extra}</span>}
      </div>
      {children}
    </div>
  );
}

function FilaIngreso({ i }: { i: Ingreso }) {
  const unidades = (i.items ?? []).reduce((a, x) => a + Number(x.cantidad || 0), 0);
  const cuando = new Date(i.creado_en).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <details className="group">
      <summary className={unir('flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-crema-claro sm:px-5 [&::-webkit-details-marker]:hidden', FOCO_ADENTRO)}>
        <EstadoPunto estado={i.estado} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-tinta">{i.proveedor?.nombre ?? 'Proveedor'}</p>
            <span className="importe shrink-0 text-xs text-tinta/60">#{i.numero}</span>
          </div>
          <p className="truncate text-xs text-tinta/70">
            Remito {i.numero_remito} · {numero((i.items ?? []).length)} {(i.items ?? []).length === 1 ? 'producto' : 'productos'}, {numero(unidades, 2)} u. · {cuando}{i.creadoPorNombre ? ` · ${nombrePropio(i.creadoPorNombre)}` : ''}
          </p>
          <p className={unir('mt-0.5 text-xs font-semibold', i.estado === 'ingresado' ? 'text-ok' : i.estado === 'rechazado' ? 'text-marca-hondo' : 'text-atencion')}>
            {i.estado === 'ingresado' ? `En stock con la factura ${i.numero_factura ?? ''}${i.confirmadoPorNombre ? ` · ${nombrePropio(i.confirmadoPorNombre)}` : ''}`
              : i.estado === 'rechazado' ? `Rechazado${i.motivo_rechazo ? `: ${i.motivo_rechazo}` : ''}`
                : 'Espera la factura'}
          </p>
        </div>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-1 size-4 shrink-0 text-tinta/60 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <ul className="space-y-1 bg-crema-claro px-4 py-3 sm:px-5 sm:pl-12">
        {(i.items ?? []).map((x, k) => (
          <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-tinta">{x.producto?.nombre ?? 'Producto'}{x.vencimiento ? <span className="text-tinta/60"> · vence {x.vencimiento.split('-').reverse().join('/')}</span> : ''}</span>
            <span className="importe shrink-0 text-tinta/70">
              {numero(x.cantidad, 2)}{x.cantidad_confirmada != null && Number(x.cantidad_confirmada) !== Number(x.cantidad) ? <b className="font-semibold text-marca-hondo"> → {numero(x.cantidad_confirmada, 2)}</b> : ''}
            </span>
          </li>
        ))}
        {i.notas && <li className="pt-1 text-xs text-tinta/70">Nota: {i.notas}</li>}
      </ul>
    </details>
  );
}

function EstadoPunto({ estado }: { estado: string }) {
  return <span aria-hidden="true" className={unir('mt-1.5 size-2.5 shrink-0 rounded-full', estado === 'ingresado' ? 'bg-ok' : estado === 'rechazado' ? 'bg-marca' : 'bg-atencion')} />;
}

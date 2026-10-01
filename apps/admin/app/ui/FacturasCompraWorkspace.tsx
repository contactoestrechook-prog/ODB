'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AreaTexto, Aviso, Boton, Campo, Cargando, Chip, Chips, Entrada, Etiqueta, FOCO, FOCO_ADENTRO, IconoAtencion, IconoFlechaAbajo, IconoOk,
  Kpi, Modal, Monto, ROTULO, Selector, Tarjeta, unir, type TonoEtiqueta,
} from './kit';
import { fecha, pesos } from '../lib/formato';

// clip de "tiene comprobante adjunto" (en lugar del 📎)
function IconoClip({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.5 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" />
    </svg>
  );
}

const EMPRESAS: Record<string, string> = { principal: 'Sant Thomas · CHINVENGUENCHA', santa_ines: 'Santa Inés · ODB SRL' };
const EMPRESA_CORTA: Record<string, string> = { principal: 'Sant Thomas', santa_ines: 'Santa Inés' };
const TIPOS: Record<string, string> = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
const ESTADOS: Record<string, [string, TonoEtiqueta]> = {
  pendiente: ['Pendiente', 'atencion'],
  parcial: ['Pago parcial', 'info'],
  en_pago: ['En orden de pago', 'info'],
  pagada: ['Pagada', 'ok'],
  anulada: ['Anulada', 'neutro'],
};
// casilla y botón de opción (conciliación, carga manual): 20 px, en rojo marca
const CASILLA = 'size-5 shrink-0 accent-marca';
const CATEGORIAS_GASTO = ['Alquiler', 'Servicios (luz/gas/agua)', 'Internet y telefonía', 'Honorarios', 'Impuestos y tasas', 'Mantenimiento', 'Logística y fletes', 'Limpieza', 'Publicidad', 'Seguros', 'Otros'];
const MEDIOS_PAGO = ['transferencia', 'efectivo', 'cheque', 'mp', 'otro'];

// Quién puede qué (la seguridad real está en el API; acá se muestra lo que aplica):
//  · cargar y ver TODO: administrativo, comprador, depósito, gerente, dueño
//  · editar/anular/registrar pagos directo: gerente y dueño
//  · el resto pide el cambio con motivo y lo aprueba un dueño (Juan Pablo)
const APRUEBA = (rol?: string | null) => rol === 'dueno';
const EDITA_DIRECTO = (rol?: string | null) => rol === 'dueno' || rol === 'gerente';

export function FacturasCompraWorkspace({ resumenInicial, facturasInicial, proveedores, rol, usuarioId }: {
  resumenInicial: any; facturasInicial: any; proveedores: any[]; rol?: string | null; usuarioId?: string | null;
}) {
  const [resumen, setResumen] = useState<any>(resumenInicial ?? {});
  const [datos, setDatos] = useState<any>(facturasInicial ?? { items: [], total: 0, pagina: 1, porPagina: 50 });
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState<any>({ estado: 'todas', proveedorId: '', empresa: '', tipo: '', categoria: '', buscar: '' });
  const [pagina, setPagina] = useState(1);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [modalCarga, setModalCarga] = useState(false);
  const [soloMias, setSoloMias] = useState(false);
  const [verPendientes, setVerPendientes] = useState(false);
  const [pendientes, setPendientes] = useState<any[]>([]);
  const debounceRef = useRef<any>(null);

  // solicitudes de cambio pendientes: el dueño las resuelve; los demás ven las suyas
  const cargarPendientes = useCallback(async () => {
    try {
      const r = await fetch('/api/compras?recurso=facturas-cambios&estado=pendiente');
      if (r.ok) setPendientes(await r.json());
    } catch { /* sin panel */ }
  }, []);
  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

  const cargar = useCallback(async (f = filtros, p = pagina, mias = soloMias) => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ recurso: mias ? 'mis-facturas' : 'facturas', pagina: String(p), porPagina: '50' });
      for (const [k, v] of Object.entries(f)) if (v && v !== 'todas') params.set(k, String(v));
      if (f.estado && f.estado !== 'todas') params.set('estado', f.estado);
      const [rl, rr] = await Promise.all([
        fetch(`/api/compras?${params.toString()}`),
        fetch('/api/compras?recurso=facturas-resumen'),
      ]);
      if (rl.ok) setDatos(await rl.json());
      if (rr.ok) setResumen(await rr.json());
    } catch { /* la tabla queda como estaba */ } finally { setCargando(false); }
  }, [filtros, pagina, soloMias]);
  const alternarMias = () => { const v = !soloMias; setSoloMias(v); setPagina(1); cargar(filtros, 1, v); };

  const setFiltro = (k: string, v: string) => {
    const f = { ...filtros, [k]: v };
    setFiltros(f); setPagina(1);
    if (k === 'buscar') {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => cargar(f, 1), 350);
    } else cargar(f, 1);
  };
  const irPagina = (p: number) => { setPagina(p); cargar(filtros, p); };

  const exportarCsv = () => {
    const filas = [['Fecha carga', 'Emision', 'Tipo', 'Letra', 'Numero', 'Proveedor', 'Empresa', 'Categoria', 'Vencimiento', 'Total', 'Pagado', 'Saldo', 'Estado']];
    for (const f of datos.items) {
      filas.push([
        fecha(f.creado_en), fecha(f.fecha_emision), TIPOS[f.tipo] ?? f.tipo, f.letra ?? '', f.numero,
        f.proveedor?.razon_social ?? '', EMPRESA_CORTA[f.empresa] ?? '', f.categoria_gasto ?? 'Mercadería',
        fecha(f.vencimiento), String(Math.round(f.monto)), String(Math.round(f.monto_pagado)), String(Math.round(f.saldo)),
        ESTADOS[f.estado]?.[0] ?? f.estado,
      ]);
    }
    const csv = filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'facturas-compra.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const chips: [string, string][] = [['todas', 'Todas'], ['pendiente', 'Pendientes'], ['parcial', 'Parciales'], ['en_pago', 'En pago'], ['vencidas', 'Vencidas'], ['pagada', 'Pagadas'], ['anulada', 'Anuladas']];

  return (
    <div className="space-y-4">
      {/* tablero */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Deuda total', resumen.total, 'neutro'], ['Vencido', resumen.vencido, 'error'], ['Vence en 7 días', resumen.venceSemana, 'atencion'], ['Vence en 30 días', resumen.venceMes, 'neutro']] as const).map(([l, v, c]) => (
          // el rótulo baja de renglón en vez de cortarse con "…" (en el celular la tarjeta mide 165 px)
          <Kpi key={l} etiqueta={<span className="whitespace-normal">{l}</span>} valor={<Monto valor={v ?? 0} />} tono={c} />
        ))}
      </div>
      {resumen.porEmpresa && Object.keys(resumen.porEmpresa).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(resumen.porEmpresa).map(([emp, v]: any) => (
            <span key={emp} className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-sm text-tinta/70">
              <b className="text-tinta">{EMPRESA_CORTA[emp] ?? 'Sin empresa'}</b>: <Monto valor={v ?? 0} />
            </span>
          ))}
        </div>
      )}

      {/* filtros */}
      <Tarjeta className="space-y-3">
        <Chips
          etiquetaAccesible="Estado de los comprobantes"
          desplazable
          valor={filtros.estado}
          onCambiar={(k) => setFiltro('estado', k)}
          opciones={chips.map(([k, l]) => ({ valor: k, etiqueta: l }))}
        />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Entrada aria-label="Buscar por número" value={filtros.buscar} onChange={(e) => setFiltro('buscar', e.target.value)} placeholder="Buscar por número…" className="col-span-2 lg:col-span-1" />
          <Selector aria-label="Proveedor" value={filtros.proveedorId} onChange={(e) => setFiltro('proveedorId', e.target.value)}>
            <option value="">Todos los proveedores</option>
            {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Selector>
          <Selector aria-label="Empresa" value={filtros.empresa} onChange={(e) => setFiltro('empresa', e.target.value)}>
            <option value="">Las dos empresas</option>
            <option value="principal">{EMPRESAS.principal}</option>
            <option value="santa_ines">{EMPRESAS.santa_ines}</option>
          </Selector>
          <Selector aria-label="Tipo de comprobante" value={filtros.tipo} onChange={(e) => setFiltro('tipo', e.target.value)}>
            <option value="">Todos los tipos</option>
            <option value="factura">Facturas</option>
            <option value="nota_credito">Notas de crédito</option>
            <option value="nota_debito">Notas de débito</option>
          </Selector>
          <Selector aria-label="Categoría" value={filtros.categoria} onChange={(e) => setFiltro('categoria', e.target.value)}>
            <option value="">Mercadería y gastos</option>
            <option value="mercaderia">Solo mercadería</option>
            <option value="gastos">Solo gastos</option>
            {CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{c}</option>)}
          </Selector>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-tinta/60">{cargando ? 'Buscando…' : `${datos.total} comprobante${datos.total === 1 ? '' : 's'}`}</p>
          <div className="flex flex-wrap gap-2">
            {!!usuarioId && (
              <Chip activo={soloMias} onClick={alternarMias} title="Solo los comprobantes que cargué yo">
                Mis facturas
              </Chip>
            )}
            {(APRUEBA(rol) || pendientes.length > 0) && (
              <Boton variante="secundario" tamano="chico" onClick={() => setVerPendientes(true)}>
                Cambios pendientes
                {pendientes.length ? <span className="importe rounded-full bg-atencion-suave px-1.5 text-xs leading-5 text-atencion">{pendientes.length}</span> : null}
              </Boton>
            )}
            <Boton variante="secundario" tamano="chico" onClick={exportarCsv}>Exportar CSV</Boton>
            <Boton tamano="chico" onClick={() => setModalCarga(true)}>+ Cargar comprobante</Boton>
          </div>
        </div>
      </Tarjeta>

      {/* tabla: en el celular, una tarjeta por comprobante; desde md, la tabla */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <ul className="divide-y divide-black/[0.06] md:hidden" aria-label="Comprobantes">
          {datos.items.map((f: any) => (
            <li key={f.id}>
              <button type="button" onClick={() => setDetalleId(f.id)}
                className={unir('block w-full px-4 py-3 text-left transition-colors hover:bg-crema-claro active:bg-crema-claro', FOCO_ADENTRO)}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-tinta">
                      <span className="min-w-0 break-words">{f.tipo === 'nota_credito' ? 'NC' : f.tipo === 'nota_debito' ? 'ND' : 'FC'}{f.letra ? ` ${f.letra}` : ''} {f.numero}</span>
                      {f.archivo_url && <span title="Tiene comprobante adjunto" className="shrink-0 text-tinta/60"><IconoClip /><span className="sr-only">Tiene comprobante adjunto</span></span>}
                    </span>
                    <span className="block break-words text-sm text-tinta/70">{f.proveedor?.razon_social ?? '—'}</span>
                  </span>
                  <Etiqueta tono={ESTADOS[f.estado]?.[1] ?? 'neutro'} className="shrink-0">{ESTADOS[f.estado]?.[0] ?? f.estado}</Etiqueta>
                </span>
                <span className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                  <span className="min-w-0">
                    <span className="block text-xs text-tinta/60">Vence</span>
                    <span className={unir('inline-flex items-center gap-1', f.vencida ? 'font-semibold text-marca-hondo' : 'text-tinta/70')}>
                      {fecha(f.vencimiento)}{f.vencida && <><IconoAtencion className="size-4" /><span className="sr-only">vencida</span></>}
                    </span>
                  </span>
                  <span className="min-w-0 text-right">
                    <span className="block text-xs text-tinta/60">Total</span>
                    <span className="importe block truncate font-semibold text-tinta">{f.tipo === 'nota_credito' ? '−' : ''}{pesos(f.monto ?? 0)}</span>
                  </span>
                  <span className="min-w-0 text-right">
                    <span className="block text-xs text-tinta/60">Saldo</span>
                    <span className="importe block truncate text-tinta/70">{['pagada', 'anulada'].includes(f.estado) ? '—' : pesos(f.saldo ?? 0)}</span>
                  </span>
                  <span className="col-span-3 truncate text-xs text-tinta/60">
                    {EMPRESA_CORTA[f.empresa] ?? '—'} · {f.categoria_gasto ?? 'Mercadería'} · emitida {fecha(f.fecha_emision ?? f.creado_en)} · cargó {f.cargada_por === usuarioId ? 'Yo' : (f.cargador?.nombre ?? '—')}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!datos.items.length && (
            <li className="px-4 py-10 text-center text-sm text-tinta/60">{soloMias ? 'Todavía no cargaste comprobantes (o no coinciden con los filtros).' : 'No hay comprobantes con esos filtros.'}</li>
          )}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="tabla-kit w-full text-sm text-tinta">
            <thead>
              <tr className={unir('border-b border-black/[0.06] text-left', ROTULO)}>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Comprobante</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Proveedor</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Empresa</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Categoría</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Emisión</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Vence</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Total</th>
                <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Saldo</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Estado</th>
                <th className="whitespace-nowrap px-3 py-3 font-semibold">Cargó</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {datos.items.map((f: any) => (
                <tr key={f.id} onClick={() => setDetalleId(f.id)} className="cursor-pointer transition-colors hover:bg-crema-claro">
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="font-medium">{f.tipo === 'nota_credito' ? 'NC' : f.tipo === 'nota_debito' ? 'ND' : 'FC'}{f.letra ? ` ${f.letra}` : ''} {f.numero}</span>
                    {f.archivo_url && <span title="Tiene comprobante adjunto" className="ml-1.5 inline-flex align-[-3px] text-tinta/60"><IconoClip /><span className="sr-only">Tiene comprobante adjunto</span></span>}
                  </td>
                  <td className="min-w-0 max-w-44 break-words px-3 py-3">{f.proveedor?.razon_social ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-tinta/70">{EMPRESA_CORTA[f.empresa] ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-tinta/70">{f.categoria_gasto ?? 'Mercadería'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-tinta/70">{fecha(f.fecha_emision ?? f.creado_en)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 ${f.vencida ? 'font-semibold text-marca-hondo' : 'text-tinta/70'}`}>
                    <span className="inline-flex items-center gap-1">{fecha(f.vencimiento)}{f.vencida && <><IconoAtencion className="size-4" /><span className="sr-only">vencida</span></>}</span>
                  </td>
                  <td className="importe whitespace-nowrap px-3 py-3 text-right font-medium">{f.tipo === 'nota_credito' ? '−' : ''}{pesos(f.monto ?? 0)}</td>
                  <td className="importe whitespace-nowrap px-3 py-3 text-right">{['pagada', 'anulada'].includes(f.estado) ? '—' : pesos(f.saldo ?? 0)}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <Etiqueta tono={ESTADOS[f.estado]?.[1] ?? 'neutro'}>{ESTADOS[f.estado]?.[0] ?? f.estado}</Etiqueta>
                  </td>
                  <td className="min-w-0 max-w-36 break-words px-3 py-3 text-xs text-tinta/70" title={f.cargador?.nombre ?? ''}>{f.cargada_por === usuarioId ? 'Yo' : (f.cargador?.nombre ?? '—')}</td>
                </tr>
              ))}
              {!datos.items.length && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-tinta/60">{soloMias ? 'Todavía no cargaste comprobantes (o no coinciden con los filtros).' : 'No hay comprobantes con esos filtros.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {datos.total > datos.porPagina && (
          <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-2 py-2 text-sm text-tinta/70 sm:px-3">
            <Boton variante="fantasma" tamano="chico" disabled={pagina <= 1} onClick={() => irPagina(pagina - 1)} icono={<IconoFlechaAbajo className="size-4 rotate-90" />}>Anterior</Boton>
            <span className="text-center">Página {pagina} de {Math.max(Math.ceil(datos.total / datos.porPagina), 1)}</span>
            <Boton variante="fantasma" tamano="chico" disabled={pagina >= Math.ceil(datos.total / datos.porPagina)} onClick={() => irPagina(pagina + 1)} iconoDerecha={<IconoFlechaAbajo className="size-4 -rotate-90" />}>Siguiente</Boton>
          </div>
        )}
      </Tarjeta>

      <Conciliacion refrescar={() => cargar()} />

      {detalleId && <DetalleFactura id={detalleId} rol={rol} cerrar={() => setDetalleId(null)} refrescar={() => { cargar(); cargarPendientes(); }} />}
      {verPendientes && <CambiosPendientes items={pendientes} puedeResolver={APRUEBA(rol)} cerrar={() => setVerPendientes(false)} refrescar={() => { cargar(); cargarPendientes(); }} abrirFactura={(fid: string) => { setVerPendientes(false); setDetalleId(fid); }} />}
      {modalCarga && <CargaManual proveedores={proveedores} cerrar={() => setModalCarga(false)} refrescar={() => cargar()} />}
    </div>
  );
}

/* ---------- conciliación: cruce de remitos escaneados contra facturas ---------- */
function Conciliacion({ refrescar }: { refrescar: () => void }) {
  const [bandeja, setBandeja] = useState<any>({ remitos: [], facturas: [] });
  const [facturaSel, setFacturaSel] = useState('');
  const [remitosSel, setRemitosSel] = useState<string[]>([]);
  const [cruce, setCruce] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState('');

  const cargarBandeja = useCallback(async () => {
    try {
      const r = await fetch('/api/compras?recurso=conciliacion');
      if (r.ok) setBandeja(await r.json());
    } catch { /* queda vacía */ }
  }, []);
  useEffect(() => { cargarBandeja(); }, [cargarBandeja]);

  const verCruce = async (fId = facturaSel, rIds = remitosSel) => {
    if (!fId || !rIds.length) { setCruce(null); return; }
    setCargando(true); setErr('');
    try {
      const r = await fetch(`/api/compras?recurso=cruce&facturaId=${fId}&remitos=${rIds.join(',')}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo cruzar');
      setCruce(d);
    } catch (e: any) { setErr(e.message); } finally { setCargando(false); }
  };

  const toggleRemito = (id: string) => {
    const next = remitosSel.includes(id) ? remitosSel.filter((x) => x !== id) : [...remitosSel, id];
    setRemitosSel(next);
    verCruce(facturaSel, next);
  };

  const confirmar = async () => {
    setCargando(true); setErr('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'conciliar', facturaId: facturaSel, remitoIds: remitosSel }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo conciliar');
      setCruce(null); setFacturaSel(''); setRemitosSel([]);
      await cargarBandeja(); refrescar();
    } catch (e: any) { setErr(e.message); } finally { setCargando(false); }
  };

  if (!bandeja.remitos.length && !bandeja.facturas.length) return null;

  // renglón elegible (remito o factura): 44 px de alto y el elegido en rojo suave
  const renglon = (elegido: boolean) =>
    unir(
      'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm text-tinta transition-colors',
      elegido ? 'border-marca/40 bg-marca-suave' : 'border-transparent hover:bg-crema-claro',
    );

  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-tinta">Conciliación: remitos escaneados vs facturas</h2>
        <p className="text-sm text-tinta/60">Elegí la factura y el o los remitos de esa entrega: el sistema compara lo facturado contra lo que realmente entró por la pistola.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-1 rounded-xl border border-black/[0.06] p-2.5">
          <p className={unir(ROTULO, 'px-1')}>Remitos sin conciliar ({bandeja.remitos.length})</p>
          {bandeja.remitos.length === 0 && <p className="px-1 py-2 text-sm text-tinta/60">No hay remitos esperando factura.</p>}
          {bandeja.remitos.map((r: any) => (
            <label key={r.id} className={renglon(remitosSel.includes(r.id))}>
              <input type="checkbox" checked={remitosSel.includes(r.id)} onChange={() => toggleRemito(r.id)} className={CASILLA} />
              <span className="min-w-0 flex-1 break-words">
                <b>{r.proveedor?.razon_social ?? '—'}</b> · {r.numero || 's/n'} · {r.renglones} renglones
                <span className="block text-xs text-tinta/60">{fecha(r.creado_en)} · {r.sucursal?.nombre ?? ''}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="min-w-0 space-y-1 rounded-xl border border-black/[0.06] p-2.5">
          <p className={unir(ROTULO, 'px-1')}>Facturas para cruzar ({bandeja.facturas.length})</p>
          {bandeja.facturas.length === 0 && <p className="px-1 py-2 text-sm text-tinta/60">No hay facturas sueltas. Cargala desde Entrada por foto con “la mercadería ya fue recibida”.</p>}
          {bandeja.facturas.map((f: any) => (
            <label key={f.id} className={renglon(facturaSel === f.id)}>
              <input type="radio" name="fact-conc" checked={facturaSel === f.id} onChange={() => { setFacturaSel(f.id); verCruce(f.id, remitosSel); }} className={CASILLA} />
              <span className="min-w-0 flex-1 break-words">
                <b>{f.proveedor?.razon_social ?? '—'}</b> · FC {f.letra ?? ''} {f.numero}
                <span className="block text-xs text-tinta/60">{fecha(f.creado_en)} · <span className="importe">{pesos(f.monto ?? 0)}</span></span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {cargando && <Cargando texto="Cruzando…" />}
      {err && <Aviso tono="error">{err}</Aviso>}

      {cruce && (
        <div className="overflow-hidden rounded-xl border border-black/[0.06]">
          <div className={`flex items-start gap-2 px-3 py-2.5 text-sm font-semibold ${cruce.coincide ? 'bg-ok-suave text-ok' : 'bg-atencion-suave text-atencion'}`}>
            {cruce.coincide ? <IconoOk className="size-5 shrink-0" /> : <IconoAtencion className="size-5 shrink-0" />}
            <span className="min-w-0">
              {cruce.coincide
                ? 'Todo coincide: lo facturado es exactamente lo que entró'
                : `${cruce.resumen.conDiferencia} renglón(es) con diferencia${cruce.sinMatch.length ? ` · ${cruce.sinMatch.length} renglón(es) de factura sin producto identificado` : ''}`}
            </span>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="tabla-kit w-full text-sm text-tinta">
              <thead><tr className={unir('border-b border-black/[0.06] text-left', ROTULO)}>
                <th className="px-3 py-2 font-semibold">Producto</th><th className="px-3 py-2 text-right font-semibold">Facturado</th><th className="px-3 py-2 text-right font-semibold">Recibido</th><th className="px-3 py-2 text-right font-semibold">Diferencia</th>
              </tr></thead>
              <tbody>
                {cruce.filas.map((x: any) => (
                  <tr key={x.productoId} className={`border-b border-black/[0.06] ${x.diferencia !== 0 ? 'bg-atencion-suave/60' : ''}`}>
                    <td className="min-w-0 break-words px-3 py-2">{x.nombre}</td>
                    <td className="importe px-3 py-2 text-right">{x.facturado}</td>
                    <td className="importe px-3 py-2 text-right">{x.recibido}</td>
                    <td className={`importe px-3 py-2 text-right font-semibold ${x.diferencia < 0 ? 'text-marca-hondo' : x.diferencia > 0 ? 'text-atencion' : 'text-ok'}`}>
                      {x.diferencia === 0
                        ? <><IconoOk className="ml-auto size-4" /><span className="sr-only">sin diferencia</span></>
                        : (x.diferencia > 0 ? '+' : '') + x.diferencia}
                    </td>
                  </tr>
                ))}
                {cruce.sinMatch.map((x: any, i: number) => (
                  <tr key={'sm' + i} className="border-b border-black/[0.06] bg-marca-suave/50">
                    <td className="min-w-0 break-words px-3 py-2 italic text-tinta/70">{x.descripcion} (sin producto identificado)</td>
                    <td className="importe px-3 py-2 text-right">{x.cantidad}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right font-semibold text-marca-hondo">revisar</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-black/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-tinta/60">
              {cruce.coincide ? 'El remito quedará conciliado con esta factura.' : 'Se registran las diferencias para el reclamo al proveedor.'}
            </p>
            <Boton onClick={confirmar} disabled={cargando} className="shrink-0" icono={cruce.coincide ? <IconoOk className="size-4" /> : undefined}>
              {cruce.coincide ? 'Conciliar' : 'Conciliar con diferencias'}
            </Boton>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

/* ---------- detalle: desglose editable, pagos parciales, comprobante, anular ---------- */
function DetalleFactura({ id, cerrar, refrescar, rol }: { id: string; cerrar: () => void; refrescar: () => void; rol?: string | null }) {
  const editaDirecto = EDITA_DIRECTO(rol);
  const [pidiendo, setPidiendo] = useState<null | 'editar' | 'anular'>(null);
  const [motivoCambio, setMotivoCambio] = useState('');
  const [solicitado, setSolicitado] = useState('');
  const [misPendientes, setMisPendientes] = useState<any[]>([]);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any>({});
  const [guardando, setGuardando] = useState(false);
  const [pago, setPago] = useState<any>({ monto: '', medio: 'transferencia', nota: '' });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const cargarDetalle = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras?recurso=factura&id=${id}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setD(data);
      setEdit({
        numero: data.numero ?? '', letra: data.letra ?? '', fechaEmision: data.fecha_emision ?? '',
        vencimiento: data.vencimiento ?? '', empresa: data.empresa ?? '', categoriaGasto: data.categoria_gasto ?? '',
        neto: data.neto ?? '', iva: data.iva ?? '', percepcionIva: data.percepcion_iva ?? 0,
        percepcionIibb: data.percepcion_iibb ?? 0, impuestosInternos: data.impuestos_internos ?? 0,
        otros: data.otros_impuestos ?? 0, monto: data.monto ?? '', notas: data.notas ?? '',
      });
    } catch { setErr('No se pudo cargar la factura'); }
    try {
      const rp = await fetch(`/api/compras?recurso=facturas-cambios&facturaId=${id}`);
      if (rp.ok) setMisPendientes((await rp.json()).filter((c: any) => c.estado === 'pendiente'));
    } catch { /* sin aviso */ }
  }, [id]);
  useEffect(() => { cargarDetalle(); }, [cargarDetalle]);

  // sin permiso de edición directa: los cambios se PIDEN (motivo obligatorio) y
  // los aprueba un dueño; la factura no se toca hasta entonces
  const solicitar = async (tipo: 'editar' | 'anular') => {
    setGuardando(true); setErr('');
    try {
      const cambios: Record<string, any> = {};
      if (tipo === 'editar' && d) {
        const orig: Record<string, any> = {
          numero: d.numero ?? '', letra: d.letra ?? '', fechaEmision: d.fecha_emision ?? '', vencimiento: d.vencimiento ?? '', empresa: d.empresa ?? '',
          categoriaGasto: d.categoria_gasto ?? '', neto: d.neto ?? '', iva: d.iva ?? '', percepcionIva: d.percepcion_iva ?? 0, percepcionIibb: d.percepcion_iibb ?? 0,
          impuestosInternos: d.impuestos_internos ?? 0, otros: d.otros_impuestos ?? 0, monto: d.monto ?? '', notas: d.notas ?? '',
        };
        for (const k of Object.keys(edit)) if (String(edit[k] ?? '') !== String(orig[k] ?? '')) cambios[k] = edit[k];
        if (!Object.keys(cambios).length) { setErr('No cambió ningún campo: modifique lo que necesita y después pida el cambio.'); setGuardando(false); return; }
      }
      await post({ accion: 'solicitarCambioFactura', id, tipo, cambios, motivo: motivoCambio });
      setSolicitado(tipo === 'anular' ? 'Pedido de anulación enviado: lo aprueba un dueño y le llega el aviso a la campanita.' : 'Pedido de cambio enviado: lo aprueba un dueño y le llega el aviso a la campanita. La factura queda como está hasta entonces.');
      setPidiendo(null); setMotivoCambio('');
      await cargarDetalle(); refrescar();
    } catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };

  const post = async (body: any) => {
    const r = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message ?? 'Error');
    return j;
  };

  const guardar = async () => {
    setGuardando(true); setErr('');
    try { await post({ accion: 'editarFactura', id, ...edit }); await cargarDetalle(); refrescar(); }
    catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };
  const registrarPago = async () => {
    setGuardando(true); setErr('');
    try {
      await post({ accion: 'pagoFactura', id, monto: Number(pago.monto), medio: pago.medio, nota: pago.nota });
      setPago({ monto: '', medio: 'transferencia', nota: '' });
      await cargarDetalle(); refrescar();
    } catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };
  const anular = async () => {
    setGuardando(true); setErr('');
    try { await post({ accion: 'anularFactura', id, motivo }); await cargarDetalle(); refrescar(); setAnulando(false); }
    catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };

  const editable = d && !['anulada'].includes(d.estado);
  const anulable = d && ['pendiente', 'parcial'].includes(d.estado);
  const pagable = d && ['pendiente', 'parcial'].includes(d.estado);

  return (
    <Modal
      abierto
      onCerrar={cerrar}
      ancho="ancho"
      titulo={d ? <>{TIPOS[d.tipo] ?? 'Factura'}{d.letra ? ` ${d.letra}` : ''} {d.numero}</> : 'Factura'}
      descripcion={d ? <>{d.proveedor?.razon_social}{d.proveedor?.cuit ? ` · CUIT ${d.proveedor.cuit}` : ''} · cargada {fecha(d.creado_en)}</> : undefined}
      pie={d ? <Boton variante="secundario" onClick={cerrar}>Cerrar</Boton> : undefined}
    >
      <div className="space-y-4">
        {!d && !err && <Cargando bloque />}
        {err && <Aviso tono="error">{err}</Aviso>}
        {d && (<>
          <Etiqueta tono={ESTADOS[d.estado]?.[1] ?? 'neutro'}>{ESTADOS[d.estado]?.[0] ?? d.estado}</Etiqueta>

          <div className="grid grid-cols-3 gap-2 rounded-xl bg-crema-claro p-3">
            <div className="min-w-0"><p className="text-xs text-tinta/60">Total</p><p className="importe truncate text-base font-semibold text-tinta sm:text-2xl">{pesos(d.monto ?? 0)}</p></div>
            <div className="min-w-0 text-right"><p className="text-xs text-tinta/60">Pagado</p><p className="importe truncate text-base font-medium text-ok sm:text-lg">{pesos(d.monto_pagado ?? 0)}</p></div>
            <div className="min-w-0 text-right"><p className="text-xs text-tinta/60">Saldo</p><p className="importe truncate text-base font-semibold text-marca-hondo sm:text-lg">{pesos(d.saldo ?? 0)}</p></div>
          </div>

          {d.comprobanteUrl && (
            <a href={d.comprobanteUrl} target="_blank" rel="noreferrer"
              className={unir('flex min-h-11 items-center gap-2 rounded-xl border border-black/15 px-3 py-2.5 text-sm text-tinta/70 transition-colors hover:border-marca hover:text-marca-hondo', FOCO)}>
              <IconoClip className="size-4 shrink-0" /> Ver el comprobante original
            </a>
          )}

          {/* encabezado editable */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Número"><Entrada disabled={!editable} value={edit.numero} onChange={(e) => setEdit({ ...edit, numero: e.target.value })} /></Campo>
            <Campo etiqueta="Letra"><Selector disabled={!editable} value={edit.letra} onChange={(e) => setEdit({ ...edit, letra: e.target.value })}><option value="">—</option><option>A</option><option>B</option><option>C</option><option>X</option></Selector></Campo>
            <Campo etiqueta="Empresa"><Selector disabled={!editable} value={edit.empresa} onChange={(e) => setEdit({ ...edit, empresa: e.target.value })}><option value="">—</option><option value="principal">Sant Thomas</option><option value="santa_ines">Santa Inés</option></Selector></Campo>
            <Campo etiqueta="Emisión"><Entrada disabled={!editable} type="date" value={edit.fechaEmision} onChange={(e) => setEdit({ ...edit, fechaEmision: e.target.value })} /></Campo>
            <Campo etiqueta="Vencimiento"><Entrada disabled={!editable} type="date" value={edit.vencimiento} onChange={(e) => setEdit({ ...edit, vencimiento: e.target.value })} /></Campo>
            <Campo etiqueta="Categoría"><Selector disabled={!editable} value={edit.categoriaGasto} onChange={(e) => setEdit({ ...edit, categoriaGasto: e.target.value })}><option value="">Mercadería</option>{CATEGORIAS_GASTO.map((c) => <option key={c}>{c}</option>)}</Selector></Campo>
          </div>

          {/* desglose fiscal */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-black/[0.06] p-3 sm:grid-cols-4">
            {[['neto', 'Neto'], ['iva', 'IVA'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['otros', 'Otros'], ['monto', 'TOTAL']].map(([k, l]) => (
              <Campo key={k} etiqueta={l} className={k === 'monto' ? 'col-span-2 sm:col-span-1' : undefined}>
                <Entrada disabled={!editable} type="number" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} className="importe text-right" />
              </Campo>
            ))}
          </div>
          <AreaTexto aria-label="Notas internas" disabled={!editable} value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} rows={2} placeholder="Notas internas…" />
          {solicitado && <Aviso tono="ok">{solicitado}</Aviso>}
          {misPendientes.length > 0 && (
            <Aviso tono="atencion" titulo={`Esta factura tiene ${misPendientes.length === 1 ? 'un pedido de cambio pendiente' : `${misPendientes.length} pedidos de cambio pendientes`} de aprobación`}>
              <div className="space-y-1">
                {misPendientes.map((c: any) => (
                  <p key={c.id} className="break-words">· {c.tipo === 'anular' ? 'Anulación' : `Cambio de ${Object.keys(c.cambios ?? {}).join(', ')}`} — {c.solicitante?.nombre ?? 'usuario'}: {c.motivo}</p>
                ))}
              </div>
            </Aviso>
          )}
          {editable && editaDirecto && (
            <Boton onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Boton>
          )}
          {editable && !editaDirecto && (
            pidiendo === 'editar' ? (
              <div className="space-y-2 rounded-xl border border-black/[0.06] p-3">
                <p className="text-sm font-semibold text-tinta">Pedir el cambio a un dueño</p>
                <p className="text-xs text-tinta/60">Modifique arriba los campos que necesita, escriba el motivo y envíe. Hasta que se apruebe, la factura queda como está.</p>
                <Entrada aria-label="Motivo del cambio" placeholder="Motivo del cambio (obligatorio)" value={motivoCambio} onChange={(e) => setMotivoCambio(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Boton onClick={() => solicitar('editar')} disabled={guardando || !motivoCambio.trim()}>{guardando ? 'Enviando…' : 'Enviar pedido de cambio'}</Boton>
                  <Boton variante="fantasma" onClick={() => setPidiendo(null)}>Cancelar</Boton>
                </div>
              </div>
            ) : (
              <Boton variante="secundario" onClick={() => setPidiendo('editar')}>Pedir cambio (lo aprueba un dueño)</Boton>
            )
          )}

          {/* pagos */}
          <div className="space-y-2 rounded-xl border border-black/[0.06] p-3">
            <p className="text-sm font-semibold text-tinta">Pagos registrados</p>
            {(d.pagos ?? []).length === 0 && <p className="text-sm text-tinta/60">Sin pagos todavía.</p>}
            {(d.pagos ?? []).map((p: any, i: number) => (
              <div key={i} className="flex justify-between gap-3 text-sm text-tinta/70">
                <span className="min-w-0 break-words">{fecha(p.creado_en)} · {p.medio}{p.nota ? ` · ${p.nota}` : ''}</span>
                <span className="importe shrink-0 font-medium text-tinta">{pesos(p.monto ?? 0)}</span>
              </div>
            ))}
            {pagable && !editaDirecto && <p className="text-xs text-tinta/60">Los pagos los registra gerencia o un dueño.</p>}
            {pagable && editaDirecto && (
              <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap">
                <Entrada aria-label="Monto del pago" type="number" placeholder="Monto" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} className="importe sm:w-32" />
                <Selector aria-label="Medio de pago" value={pago.medio} onChange={(e) => setPago({ ...pago, medio: e.target.value })} className="sm:w-40">
                  {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                </Selector>
                <Entrada aria-label="Nota del pago" placeholder="Nota (opcional)" value={pago.nota} onChange={(e) => setPago({ ...pago, nota: e.target.value })} className="col-span-2 sm:w-auto sm:min-w-40 sm:flex-1" />
                <Boton variante="ok" onClick={registrarPago} disabled={guardando || !(Number(pago.monto) > 0)} className="col-span-2 sm:col-span-1">
                  Registrar pago
                </Boton>
              </div>
            )}
            {d.estado === 'en_pago' && <p className="text-xs text-tinta/60">Esta factura está dentro de una orden de pago: los pagos se registran por ese circuito.</p>}
          </div>

          {anulable && (
            <div className="border-t border-black/[0.06] pt-3">
              {!editaDirecto ? (
                pidiendo === 'anular' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Entrada aria-label="Motivo de la anulación" placeholder="Motivo de la anulación (la aprueba un dueño)" value={motivoCambio} onChange={(e) => setMotivoCambio(e.target.value)} className="basis-full sm:basis-auto sm:flex-1" />
                    <Boton variante="peligro" onClick={() => solicitar('anular')} disabled={guardando || !motivoCambio.trim()}>Pedir anulación</Boton>
                    <Boton variante="fantasma" onClick={() => setPidiendo(null)}>No</Boton>
                  </div>
                ) : (
                  <Boton variante="peligro" tamano="chico" onClick={() => setPidiendo('anular')}>Pedir anulación (la aprueba un dueño)</Boton>
                )
              ) : (
                anulando ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Entrada aria-label="Motivo de la anulación" placeholder="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="basis-full sm:basis-auto sm:flex-1" />
                    <Boton variante="peligro" onClick={anular} disabled={guardando}>Confirmar</Boton>
                    <Boton variante="fantasma" onClick={() => setAnulando(false)}>No</Boton>
                  </div>
                ) : (
                  <Boton variante="peligro" tamano="chico" onClick={() => setAnulando(true)}>Anular comprobante</Boton>
                )
              )}
            </div>
          )}
        </>)}
      </div>
    </Modal>
  );
}

/* ---------- carga manual: facturas de mercadería, gastos y NC/ND ---------- */
function CargaManual({ proveedores, cerrar, refrescar }: { proveedores: any[]; cerrar: () => void; refrescar: () => void }) {
  const [f, setF] = useState<any>({ tipo: 'factura', letra: 'A', empresa: '', condicionVenta: 'cta_cte', esGasto: false, categoriaGasto: CATEGORIAS_GASTO[0], pagada: false, permitirDuplicado: false });
  const [err, setErr] = useState('');
  const [hayDuplicado, setHayDuplicado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const n = (v: any) => Number(v) || 0;
  const totalCalc = n(f.neto) + n(f.iva) + n(f.percepcionIva) + n(f.percepcionIibb) + n(f.impuestosInternos) + n(f.otros);
  const total = f.monto != null && f.monto !== '' ? Number(f.monto) : totalCalc;

  const guardar = async () => {
    setGuardando(true); setErr('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'factura', proveedorId: f.proveedorId, tipo: f.tipo, letra: f.letra || undefined,
          numero: f.numero, monto: total, neto: f.neto, iva: f.iva,
          percepcionIva: n(f.percepcionIva), percepcionIibb: n(f.percepcionIibb),
          impuestosInternos: n(f.impuestosInternos), otros: n(f.otros),
          fechaEmision: f.fechaEmision || undefined, vencimiento: f.vencimiento || undefined,
          empresa: f.empresa || undefined, condicionVenta: f.condicionVenta,
          categoriaGasto: f.esGasto ? f.categoriaGasto : undefined,
          notas: f.notas || undefined, pagada: f.pagada, permitirDuplicado: f.permitirDuplicado,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (String(j.message ?? '').includes('Ya existe')) setHayDuplicado(true);
        throw new Error(j.message ?? 'No se pudo cargar');
      }
      refrescar(); cerrar();
    } catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };

  return (
    <Modal
      abierto
      onCerrar={cerrar}
      titulo="Cargar comprobante de proveedor"
      cerrarAlTocarAfuera={false}
      pie={<>
        <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
        <Boton onClick={guardar} disabled={guardando || !f.proveedorId || !f.numero || !(total > 0)}>
          {guardando ? 'Cargando…' : 'Cargar comprobante'}
        </Boton>
      </>}
    >
      <div className="space-y-3">
        <p className="text-sm text-tinta/60">Para facturas de mercadería que mueven stock usá <b className="text-tinta">Compras → Entrada por foto</b>. Esto es para cargar a mano: gastos, servicios, notas de crédito/débito o facturas sin remito.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Selector aria-label="Proveedor" value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>
            {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Selector>
          <Selector aria-label="Empresa" value={f.empresa} onChange={(e) => set('empresa', e.target.value)}>
            <option value="">Empresa…</option>
            <option value="principal">{EMPRESAS.principal}</option>
            <option value="santa_ines">{EMPRESAS.santa_ines}</option>
          </Selector>
          <Selector aria-label="Tipo de comprobante" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
            <option value="factura">Factura</option>
            <option value="nota_credito">Nota de crédito</option>
            <option value="nota_debito">Nota de débito</option>
          </Selector>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <Selector aria-label="Letra" value={f.letra} onChange={(e) => set('letra', e.target.value)}>
              <option>A</option><option>B</option><option>C</option><option>X</option>
            </Selector>
            <Entrada aria-label="Número" value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} placeholder="Número (0001-00001234)" />
          </div>
          <Campo etiqueta="Fecha de emisión"><Entrada type="date" value={f.fechaEmision ?? ''} onChange={(e) => set('fechaEmision', e.target.value)} /></Campo>
          <Campo etiqueta="Vencimiento del pago"><Entrada type="date" value={f.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} /></Campo>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tinta">
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={f.esGasto} onChange={(e) => set('esGasto', e.target.checked)} className={CASILLA} /> Es un gasto (no mueve stock)</label>
          {f.esGasto && (
            <Selector aria-label="Categoría del gasto" value={f.categoriaGasto} onChange={(e) => set('categoriaGasto', e.target.value)} className="basis-full sm:basis-56">
              {CATEGORIAS_GASTO.map((c) => <option key={c}>{c}</option>)}
            </Selector>
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={f.pagada} onChange={(e) => set('pagada', e.target.checked)} className={CASILLA} /> Ya está pagada</label>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl border border-black/[0.06] p-3 sm:grid-cols-3">
          {[['neto', 'Neto'], ['iva', 'IVA'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['otros', 'Otros']].map(([k, l]) => (
            <Campo key={k} etiqueta={l}>
              <Entrada type="number" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="importe text-right" />
            </Campo>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-crema-claro px-3 py-2">
          <span className={ROTULO}>Total</span>
          <div className="w-40 max-w-[60%]">
            <Entrada aria-label="Total" type="number" value={f.monto ?? ''} onChange={(e) => set('monto', e.target.value)} placeholder={String(Math.round(totalCalc))} className="importe text-right font-semibold" />
          </div>
        </div>
        {f.monto == null || f.monto === '' ? <p className="text-xs text-tinta/60">El total se calcula solo sumando el desglose; si lo escribís, manda el tuyo.</p> : null}

        <AreaTexto aria-label="Notas internas" value={f.notas ?? ''} onChange={(e) => set('notas', e.target.value)} rows={2} placeholder="Notas internas (opcional)…" />

        {hayDuplicado && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-atencion/20 bg-atencion-suave px-3 py-2 text-sm text-atencion">
            <input type="checkbox" checked={f.permitirDuplicado} onChange={(e) => set('permitirDuplicado', e.target.checked)} className={CASILLA} />
            Ya existe un comprobante con ese número para este proveedor — cargar igual
          </label>
        )}
        {err && !hayDuplicado && <Aviso tono="error">{err}</Aviso>}
      </div>
    </Modal>
  );
}

/* ---------- cambios pendientes: el dueño aprueba o rechaza; los demás ven el estado ---------- */
function CambiosPendientes({ items, puedeResolver, cerrar, refrescar, abrirFactura }: { items: any[]; puedeResolver: boolean; cerrar: () => void; refrescar: () => void; abrirFactura: (id: string) => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [respuesta, setRespuesta] = useState<Record<string, string>>({});
  const ETIQ: Record<string, string> = { numero: 'Número', letra: 'Letra', fechaEmision: 'Emisión', vencimiento: 'Vencimiento', empresa: 'Empresa', categoriaGasto: 'Categoría', neto: 'Neto', iva: 'IVA', percepcionIva: 'Perc. IVA', percepcionIibb: 'Perc. IIBB', impuestosInternos: 'Imp. internos', otros: 'Otros', monto: 'Total', notas: 'Notas', condicionVenta: 'Condición' };
  const resolver = async (id: string, decision: 'aprobar' | 'rechazar') => {
    setOcupado(id); setErr('');
    try {
      const r = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: decision === 'aprobar' ? 'aprobarCambioFactura' : 'rechazarCambioFactura', id, respuesta: respuesta[id] ?? '' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? 'Error');
      refrescar();
    } catch (e: any) { setErr(e.message); } finally { setOcupado(null); }
  };
  return (
    <Modal
      abierto
      onCerrar={cerrar}
      ancho="ancho"
      titulo="Cambios pendientes de aprobación"
      descripcion={puedeResolver ? 'Al aprobar, el cambio se aplica en el momento y se avisa a quien lo pidió.' : 'Los aprueba un dueño. Acá ve el estado de lo pedido.'}
      pie={<Boton variante="secundario" onClick={cerrar}>Cerrar</Boton>}
    >
      <div className="space-y-3">
        {err && <Aviso tono="error">{err}</Aviso>}
        {!items.length && <p className="py-6 text-center text-sm text-tinta/60">No hay pedidos de cambio pendientes.</p>}
        {items.map((c: any) => (
          <div key={c.id} className="space-y-2 rounded-2xl border border-black/[0.06] p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button type="button" onClick={() => abrirFactura(c.factura_id)} className={unir('break-words rounded-sm text-left text-sm font-semibold text-tinta underline-offset-4 hover:underline', FOCO)}>
                  {c.tipo === 'anular' ? 'Anular' : 'Cambiar'} {TIPOS[c.factura?.tipo] ?? 'Factura'}{c.factura?.letra ? ` ${c.factura.letra}` : ''} {c.factura?.numero} · {c.factura?.proveedor?.razon_social ?? ''}
                </button>
                <p className="text-xs text-tinta/60">Pidió {c.solicitante?.nombre ?? 'un usuario'} · {fecha(c.creado_en)} · total actual <span className="importe">{pesos(c.factura?.monto ?? 0)}</span></p>
              </div>
              <Etiqueta tono="atencion" className="shrink-0">Pendiente</Etiqueta>
            </div>
            <p className="break-words text-sm text-tinta"><span className="text-tinta/60">Motivo:</span> {c.motivo}</p>
            {c.tipo === 'editar' && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(c.cambios ?? {}).map(([k, v]) => (
                  <span key={k} className="max-w-full break-words rounded-full bg-crema-hondo/70 px-2.5 py-1 text-xs text-tinta">{ETIQ[k] ?? k}: <strong>{String(v ?? '—')}</strong></span>
                ))}
              </div>
            )}
            {puedeResolver && (
              <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap sm:items-center">
                <Entrada aria-label="Respuesta" placeholder="Respuesta (opcional)" value={respuesta[c.id] ?? ''} onChange={(e) => setRespuesta({ ...respuesta, [c.id]: e.target.value })} className="col-span-2 sm:w-auto sm:min-w-40 sm:flex-1" />
                <Boton variante="ok" onClick={() => resolver(c.id, 'aprobar')} disabled={ocupado === c.id}>Aprobar y aplicar</Boton>
                <Boton variante="peligro" onClick={() => resolver(c.id, 'rechazar')} disabled={ocupado === c.id}>Rechazar</Boton>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

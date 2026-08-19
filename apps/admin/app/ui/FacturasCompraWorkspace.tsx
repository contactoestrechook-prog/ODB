'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (v?: string | null) => (v ? new Date(v + (v.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none';

const EMPRESAS: Record<string, string> = { principal: 'Sant Thomas · CHINVENGUENCHA', santa_ines: 'Santa Inés · ODB SRL' };
const EMPRESA_CORTA: Record<string, string> = { principal: 'Sant Thomas', santa_ines: 'Santa Inés' };
const TIPOS: Record<string, string> = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
const ESTADOS: Record<string, [string, string]> = {
  pendiente: ['Pendiente', 'bg-amber-100 text-amber-900'],
  parcial: ['Pago parcial', 'bg-blue-100 text-blue-800'],
  en_pago: ['En orden de pago', 'bg-purple-100 text-purple-800'],
  pagada: ['Pagada', 'bg-emerald-100 text-emerald-800'],
  anulada: ['Anulada', 'bg-black/10 text-black/50'],
};
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Deuda total', resumen.total, ''], ['Vencido', resumen.vencido, 'text-[#B82D25]'], ['Vence en 7 días', resumen.venceSemana, 'text-amber-700'], ['Vence en 30 días', resumen.venceMes, '']].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-4">
            <p className="text-[11px] text-black/50">{l}</p>
            <p className={`text-xl font-semibold ${c || 'text-black'}`}>{pesos(v)}</p>
          </div>
        ))}
      </div>
      {resumen.porEmpresa && Object.keys(resumen.porEmpresa).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(resumen.porEmpresa).map(([emp, v]: any) => (
            <span key={emp} className="rounded-full bg-white px-3 py-1.5 text-xs text-black/70">
              <b>{EMPRESA_CORTA[emp] ?? 'Sin empresa'}</b>: {pesos(v)}
            </span>
          ))}
        </div>
      )}

      {/* filtros */}
      <div className="rounded-xl bg-white p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {chips.map(([k, l]) => (
            <button key={k} onClick={() => setFiltro('estado', k)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${filtros.estado === k ? 'bg-black text-white' : 'bg-[#F0EBE2] text-black/60 hover:text-black'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input value={filtros.buscar} onChange={(e) => setFiltro('buscar', e.target.value)} placeholder="Buscar por número…" className={input} />
          <select value={filtros.proveedorId} onChange={(e) => setFiltro('proveedorId', e.target.value)} className={input}>
            <option value="">Todos los proveedores</option>
            {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select value={filtros.empresa} onChange={(e) => setFiltro('empresa', e.target.value)} className={input}>
            <option value="">Las dos empresas</option>
            <option value="principal">{EMPRESAS.principal}</option>
            <option value="santa_ines">{EMPRESAS.santa_ines}</option>
          </select>
          <select value={filtros.tipo} onChange={(e) => setFiltro('tipo', e.target.value)} className={input}>
            <option value="">Todos los tipos</option>
            <option value="factura">Facturas</option>
            <option value="nota_credito">Notas de crédito</option>
            <option value="nota_debito">Notas de débito</option>
          </select>
          <select value={filtros.categoria} onChange={(e) => setFiltro('categoria', e.target.value)} className={input}>
            <option value="">Mercadería y gastos</option>
            <option value="mercaderia">Solo mercadería</option>
            <option value="gastos">Solo gastos</option>
            {CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-black/50">{cargando ? 'Buscando…' : `${datos.total} comprobante${datos.total === 1 ? '' : 's'}`}</p>
          <div className="flex gap-2">
            {!!usuarioId && (
              <button onClick={alternarMias} className={`rounded-full px-4 py-1.5 text-xs font-semibold border ${soloMias ? 'bg-black text-white border-black' : 'border-black/15 text-black/70 hover:border-black/40'}`} title="Solo los comprobantes que cargué yo">
                {soloMias ? '✓ Mis facturas' : 'Mis facturas'}
              </button>
            )}
            {(APRUEBA(rol) || pendientes.length > 0) && (
              <button onClick={() => setVerPendientes(true)} className={`rounded-full px-4 py-1.5 text-xs font-semibold border ${pendientes.length ? 'bg-amber-100 text-amber-900 border-amber-300' : 'border-black/15 text-black/70'}`}>
                Cambios pendientes{pendientes.length ? ` (${pendientes.length})` : ''}
              </button>
            )}
            <button onClick={exportarCsv} className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium text-black/70 hover:border-black/40">⬇ Exportar CSV</button>
            <button onClick={() => setModalCarga(true)} className="rounded-full bg-[#B82D25] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#932A1F]">+ Cargar comprobante</button>
          </div>
        </div>
      </div>

      {/* tabla */}
      <div className="rounded-xl bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-black/45 border-b border-black/10">
                <th className="px-3 py-2.5 font-medium">Comprobante</th>
                <th className="px-3 py-2.5 font-medium">Proveedor</th>
                <th className="px-3 py-2.5 font-medium">Empresa</th>
                <th className="px-3 py-2.5 font-medium">Categoría</th>
                <th className="px-3 py-2.5 font-medium">Emisión</th>
                <th className="px-3 py-2.5 font-medium">Vence</th>
                <th className="px-3 py-2.5 font-medium text-right">Total</th>
                <th className="px-3 py-2.5 font-medium text-right">Saldo</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium">Cargó</th>
              </tr>
            </thead>
            <tbody>
              {datos.items.map((f: any) => (
                <tr key={f.id} onClick={() => setDetalleId(f.id)} className="border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/50 cursor-pointer">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-medium">{f.tipo === 'nota_credito' ? 'NC' : f.tipo === 'nota_debito' ? 'ND' : 'FC'}{f.letra ? ` ${f.letra}` : ''} {f.numero}</span>
                    {f.archivo_url && <span title="Tiene comprobante adjunto" className="ml-1.5 text-black/40">📎</span>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[180px] truncate">{f.proveedor?.razon_social ?? '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-black/60 text-xs">{EMPRESA_CORTA[f.empresa] ?? '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-black/60 text-xs">{f.categoria_gasto ?? 'Mercadería'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-black/60">{fecha(f.fecha_emision ?? f.creado_en)}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap ${f.vencida ? 'text-[#B82D25] font-semibold' : 'text-black/60'}`}>{fecha(f.vencimiento)}{f.vencida ? ' ⚠' : ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{f.tipo === 'nota_credito' ? '−' : ''}{pesos(f.monto)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{['pagada', 'anulada'].includes(f.estado) ? '—' : pesos(f.saldo)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTADOS[f.estado]?.[1] ?? ''}`}>{ESTADOS[f.estado]?.[0] ?? f.estado}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-black/60 text-xs max-w-[140px] truncate" title={f.cargador?.nombre ?? ''}>{f.cargada_por === usuarioId ? 'Yo' : (f.cargador?.nombre ?? '—')}</td>
                </tr>
              ))}
              {!datos.items.length && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-black/40">{soloMias ? 'Todavía no cargaste comprobantes (o no coinciden con los filtros).' : 'No hay comprobantes con esos filtros.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {datos.total > datos.porPagina && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-black/10 text-xs text-black/60">
            <button disabled={pagina <= 1} onClick={() => irPagina(pagina - 1)} className="disabled:opacity-30 hover:text-black">‹ Anterior</button>
            <span>Página {pagina} de {Math.max(Math.ceil(datos.total / datos.porPagina), 1)}</span>
            <button disabled={pagina >= Math.ceil(datos.total / datos.porPagina)} onClick={() => irPagina(pagina + 1)} className="disabled:opacity-30 hover:text-black">Siguiente ›</button>
          </div>
        )}
      </div>

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

  return (
    <div className="rounded-xl bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-black">Conciliación: remitos escaneados vs facturas</h2>
        <p className="text-xs text-black/50">Elegí la factura y el o los remitos de esa entrega: el sistema compara lo facturado contra lo que realmente entró por la pistola.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-black/10 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold text-black/50 uppercase tracking-wide">Remitos sin conciliar ({bandeja.remitos.length})</p>
          {bandeja.remitos.length === 0 && <p className="text-xs text-black/40 py-2">No hay remitos esperando factura.</p>}
          {bandeja.remitos.map((r: any) => (
            <label key={r.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer ${remitosSel.includes(r.id) ? 'bg-[#B82D25]/10 border border-[#B82D25]/40' : 'hover:bg-[#F0EBE2]/60 border border-transparent'}`}>
              <input type="checkbox" checked={remitosSel.includes(r.id)} onChange={() => toggleRemito(r.id)} className="accent-[#B82D25]" />
              <span className="flex-1 min-w-0">
                <b>{r.proveedor?.razon_social ?? '—'}</b> · {r.numero || 's/n'} · {r.renglones} renglones
                <span className="block text-black/45">{fecha(r.creado_en)} · {r.sucursal?.nombre ?? ''}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="rounded-lg border border-black/10 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold text-black/50 uppercase tracking-wide">Facturas para cruzar ({bandeja.facturas.length})</p>
          {bandeja.facturas.length === 0 && <p className="text-xs text-black/40 py-2">No hay facturas sueltas. Cargala desde Entrada por foto con “la mercadería ya fue recibida”.</p>}
          {bandeja.facturas.map((f: any) => (
            <label key={f.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer ${facturaSel === f.id ? 'bg-[#B82D25]/10 border border-[#B82D25]/40' : 'hover:bg-[#F0EBE2]/60 border border-transparent'}`}>
              <input type="radio" name="fact-conc" checked={facturaSel === f.id} onChange={() => { setFacturaSel(f.id); verCruce(f.id, remitosSel); }} className="accent-[#B82D25]" />
              <span className="flex-1 min-w-0">
                <b>{f.proveedor?.razon_social ?? '—'}</b> · FC {f.letra ?? ''} {f.numero}
                <span className="block text-black/45">{fecha(f.creado_en)} · {pesos(f.monto)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {cargando && <p className="text-xs text-black/50">Cruzando…</p>}
      {err && <p className="text-xs text-[#932A1F]">{err}</p>}

      {cruce && (
        <div className="rounded-lg border border-black/10 overflow-hidden">
          <div className={`px-3 py-2 text-xs font-semibold ${cruce.coincide ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
            {cruce.coincide
              ? '✓ Todo coincide: lo facturado es exactamente lo que entró'
              : `⚠ ${cruce.resumen.conDiferencia} renglón(es) con diferencia${cruce.sinMatch.length ? ` · ${cruce.sinMatch.length} renglón(es) de factura sin producto identificado` : ''}`}
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs text-black">
              <thead><tr className="text-left text-[10px] uppercase text-black/45 border-b border-black/10">
                <th className="px-3 py-1.5">Producto</th><th className="px-3 py-1.5 text-right">Facturado</th><th className="px-3 py-1.5 text-right">Recibido</th><th className="px-3 py-1.5 text-right">Diferencia</th>
              </tr></thead>
              <tbody>
                {cruce.filas.map((x: any) => (
                  <tr key={x.productoId} className={`border-b border-black/5 ${x.diferencia !== 0 ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-3 py-1.5">{x.nombre}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{x.facturado}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{x.recibido}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${x.diferencia < 0 ? 'text-[#B82D25]' : x.diferencia > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {x.diferencia === 0 ? '✓' : (x.diferencia > 0 ? '+' : '') + x.diferencia}
                    </td>
                  </tr>
                ))}
                {cruce.sinMatch.map((x: any, i: number) => (
                  <tr key={'sm' + i} className="border-b border-black/5 bg-red-50/50">
                    <td className="px-3 py-1.5 italic text-black/60">{x.descripcion} (sin producto identificado)</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{x.cantidad}</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5 text-right text-[#B82D25] font-semibold">revisar</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2.5 border-t border-black/10 flex justify-between items-center">
            <p className="text-[11px] text-black/45">
              {cruce.coincide ? 'El remito quedará conciliado con esta factura.' : 'Se registran las diferencias para el reclamo al proveedor.'}
            </p>
            <button onClick={confirmar} disabled={cargando} className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${cruce.coincide ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-[#B82D25] hover:bg-[#932A1F]'}`}>
              {cruce.coincide ? 'Conciliar ✓' : 'Conciliar con diferencias'}
            </button>
          </div>
        </div>
      )}
    </div>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {!d && !err && <p className="text-sm text-black/50 py-8 text-center">Cargando…</p>}
        {err && <p className="rounded-lg bg-[#B82D25]/10 px-3 py-2 text-sm text-[#932A1F]">{err}</p>}
        {d && (<>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-black text-lg">
                {TIPOS[d.tipo] ?? 'Factura'}{d.letra ? ` ${d.letra}` : ''} {d.numero}
              </h2>
              <p className="text-xs text-black/50">{d.proveedor?.razon_social}{d.proveedor?.cuit ? ` · CUIT ${d.proveedor.cuit}` : ''} · cargada {fecha(d.creado_en)}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADOS[d.estado]?.[1] ?? ''}`}>{ESTADOS[d.estado]?.[0] ?? d.estado}</span>
          </div>

          <div className="rounded-xl bg-[#F0EBE2]/60 p-3 flex items-baseline justify-between">
            <div><p className="text-[11px] text-black/50">Total</p><p className="text-2xl font-semibold text-black tabular-nums">{pesos(d.monto)}</p></div>
            <div className="text-right"><p className="text-[11px] text-black/50">Pagado</p><p className="text-lg font-medium text-emerald-700 tabular-nums">{pesos(d.monto_pagado)}</p></div>
            <div className="text-right"><p className="text-[11px] text-black/50">Saldo</p><p className="text-lg font-semibold text-[#B82D25] tabular-nums">{pesos(d.saldo)}</p></div>
          </div>

          {d.comprobanteUrl && (
            <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className="block rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black/70 hover:border-[#B82D25] hover:text-[#932A1F]">
              📎 Ver el comprobante original
            </a>
          )}

          {/* encabezado editable */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="text-[11px] text-black/50">Número<input disabled={!editable} value={edit.numero} onChange={(e) => setEdit({ ...edit, numero: e.target.value })} className={input + ' mt-0.5'} /></label>
            <label className="text-[11px] text-black/50">Letra<select disabled={!editable} value={edit.letra} onChange={(e) => setEdit({ ...edit, letra: e.target.value })} className={input + ' mt-0.5'}><option value="">—</option><option>A</option><option>B</option><option>C</option><option>X</option></select></label>
            <label className="text-[11px] text-black/50">Empresa<select disabled={!editable} value={edit.empresa} onChange={(e) => setEdit({ ...edit, empresa: e.target.value })} className={input + ' mt-0.5'}><option value="">—</option><option value="principal">Sant Thomas</option><option value="santa_ines">Santa Inés</option></select></label>
            <label className="text-[11px] text-black/50">Emisión<input disabled={!editable} type="date" value={edit.fechaEmision} onChange={(e) => setEdit({ ...edit, fechaEmision: e.target.value })} className={input + ' mt-0.5'} /></label>
            <label className="text-[11px] text-black/50">Vencimiento<input disabled={!editable} type="date" value={edit.vencimiento} onChange={(e) => setEdit({ ...edit, vencimiento: e.target.value })} className={input + ' mt-0.5'} /></label>
            <label className="text-[11px] text-black/50">Categoría<select disabled={!editable} value={edit.categoriaGasto} onChange={(e) => setEdit({ ...edit, categoriaGasto: e.target.value })} className={input + ' mt-0.5'}><option value="">Mercadería</option>{CATEGORIAS_GASTO.map((c) => <option key={c}>{c}</option>)}</select></label>
          </div>

          {/* desglose fiscal */}
          <div className="rounded-lg border border-black/10 p-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs">
            {[['neto', 'Neto'], ['iva', 'IVA'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['otros', 'Otros'], ['monto', 'TOTAL']].map(([k, l]) => (
              <label key={k} className="flex flex-col gap-0.5">
                <span className="text-black/55 font-medium">{l}</span>
                <input disabled={!editable} type="number" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} className="rounded border border-black/15 bg-white px-2 py-1 text-right text-sm text-black disabled:bg-black/5" />
              </label>
            ))}
          </div>
          <textarea disabled={!editable} value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} rows={2} placeholder="Notas internas…" className={input} />
          {solicitado && <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">{solicitado}</p>}
          {misPendientes.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1">
              <p className="font-semibold">Esta factura tiene {misPendientes.length === 1 ? 'un pedido de cambio pendiente' : `${misPendientes.length} pedidos de cambio pendientes`} de aprobación</p>
              {misPendientes.map((c: any) => (
                <p key={c.id}>· {c.tipo === 'anular' ? 'Anulación' : `Cambio de ${Object.keys(c.cambios ?? {}).join(', ')}`} — {c.solicitante?.nombre ?? 'usuario'}: {c.motivo}</p>
              ))}
            </div>
          )}
          {editable && editaDirecto && (
            <button onClick={guardar} disabled={guardando} className="rounded-full bg-black px-5 py-2 text-xs font-semibold text-white hover:bg-black/80 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
          {editable && !editaDirecto && (
            pidiendo === 'editar' ? (
              <div className="rounded-xl border border-black/10 p-3 space-y-2">
                <p className="text-xs font-semibold text-black">Pedir el cambio a un dueño</p>
                <p className="text-[11px] text-black/55">Modifique arriba los campos que necesita, escriba el motivo y envíe. Hasta que se apruebe, la factura queda como está.</p>
                <input placeholder="Motivo del cambio (obligatorio)" value={motivoCambio} onChange={(e) => setMotivoCambio(e.target.value)} className={input} />
                <div className="flex gap-2">
                  <button onClick={() => solicitar('editar')} disabled={guardando || !motivoCambio.trim()} className="rounded-full bg-black px-5 py-2 text-xs font-semibold text-white disabled:opacity-40">{guardando ? 'Enviando…' : 'Enviar pedido de cambio'}</button>
                  <button onClick={() => setPidiendo(null)} className="text-xs text-black/50">Cancelar</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setPidiendo('editar')} className="rounded-full border border-black px-5 py-2 text-xs font-semibold text-black hover:bg-black hover:text-white">Pedir cambio (lo aprueba un dueño)</button>
            )
          )}

          {/* pagos */}
          <div className="rounded-xl border border-black/10 p-3 space-y-2">
            <p className="text-xs font-semibold text-black">Pagos registrados</p>
            {(d.pagos ?? []).length === 0 && <p className="text-xs text-black/45">Sin pagos todavía.</p>}
            {(d.pagos ?? []).map((p: any, i: number) => (
              <div key={i} className="flex justify-between text-xs text-black/70">
                <span>{fecha(p.creado_en)} · {p.medio}{p.nota ? ` · ${p.nota}` : ''}</span>
                <span className="tabular-nums font-medium">{pesos(p.monto)}</span>
              </div>
            ))}
            {pagable && !editaDirecto && <p className="text-[11px] text-black/45">Los pagos los registra gerencia o un dueño.</p>}
            {pagable && editaDirecto && (
              <div className="flex flex-wrap gap-2 pt-1">
                <input type="number" placeholder="Monto" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} className={input + ' w-28 flex-none'} />
                <select value={pago.medio} onChange={(e) => setPago({ ...pago, medio: e.target.value })} className={input + ' w-36 flex-none'}>
                  {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                </select>
                <input placeholder="Nota (opcional)" value={pago.nota} onChange={(e) => setPago({ ...pago, nota: e.target.value })} className={input + ' flex-1 min-w-[120px]'} />
                <button onClick={registrarPago} disabled={guardando || !(Number(pago.monto) > 0)} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">
                  Registrar pago
                </button>
              </div>
            )}
            {d.estado === 'en_pago' && <p className="text-[11px] text-black/45">Esta factura está dentro de una orden de pago: los pagos se registran por ese circuito.</p>}
          </div>

          <div className="flex items-center justify-between pt-1">
            {anulable && !editaDirecto ? (
              pidiendo === 'anular' ? (
                <div className="flex gap-2 items-center flex-1 mr-3">
                  <input placeholder="Motivo de la anulación (la aprueba un dueño)" value={motivoCambio} onChange={(e) => setMotivoCambio(e.target.value)} className={input} />
                  <button onClick={() => solicitar('anular')} disabled={guardando || !motivoCambio.trim()} className="rounded-full bg-[#B82D25] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-40">Pedir anulación</button>
                  <button onClick={() => setPidiendo(null)} className="text-xs text-black/50">No</button>
                </div>
              ) : (
                <button onClick={() => setPidiendo('anular')} className="text-xs font-medium text-[#B82D25] hover:underline">Pedir anulación (la aprueba un dueño)</button>
              )
            ) : anulable ? (
              anulando ? (
                <div className="flex gap-2 items-center flex-1 mr-3">
                  <input placeholder="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={input} />
                  <button onClick={anular} disabled={guardando} className="rounded-full bg-[#B82D25] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap">Confirmar</button>
                  <button onClick={() => setAnulando(false)} className="text-xs text-black/50">No</button>
                </div>
              ) : (
                <button onClick={() => setAnulando(true)} className="text-xs font-medium text-[#B82D25] hover:underline">Anular comprobante</button>
              )
            ) : <span />}
            <button onClick={cerrar} className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-black/80">Cerrar</button>
          </div>
        </>)}
      </div>
    </div>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-xl p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-black text-lg">Cargar comprobante de proveedor</h2>
        <p className="text-xs text-black/50">Para facturas de mercadería que mueven stock usá <b>Compras → Entrada por foto</b>. Esto es para cargar a mano: gastos, servicios, notas de crédito/débito o facturas sin remito.</p>

        <div className="grid grid-cols-2 gap-2">
          <select value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)} className={input}>
            <option value="">Proveedor…</option>
            {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select value={f.empresa} onChange={(e) => set('empresa', e.target.value)} className={input}>
            <option value="">Empresa…</option>
            <option value="principal">{EMPRESAS.principal}</option>
            <option value="santa_ines">{EMPRESAS.santa_ines}</option>
          </select>
          <select value={f.tipo} onChange={(e) => set('tipo', e.target.value)} className={input}>
            <option value="factura">Factura</option>
            <option value="nota_credito">Nota de crédito</option>
            <option value="nota_debito">Nota de débito</option>
          </select>
          <div className="grid grid-cols-[70px_1fr] gap-2">
            <select value={f.letra} onChange={(e) => set('letra', e.target.value)} className={input}>
              <option>A</option><option>B</option><option>C</option><option>X</option>
            </select>
            <input value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} placeholder="Número (0001-00001234)" className={input} />
          </div>
          <label className="text-[11px] text-black/50">Fecha de emisión<input type="date" value={f.fechaEmision ?? ''} onChange={(e) => set('fechaEmision', e.target.value)} className={input + ' mt-0.5'} /></label>
          <label className="text-[11px] text-black/50">Vencimiento del pago<input type="date" value={f.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} className={input + ' mt-0.5'} /></label>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-black items-center">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.esGasto} onChange={(e) => set('esGasto', e.target.checked)} className="accent-[#B82D25]" /> Es un gasto (no mueve stock)</label>
          {f.esGasto && (
            <select value={f.categoriaGasto} onChange={(e) => set('categoriaGasto', e.target.value)} className={input + ' w-52'}>
              {CATEGORIAS_GASTO.map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.pagada} onChange={(e) => set('pagada', e.target.checked)} className="accent-[#B82D25]" /> Ya está pagada</label>
        </div>

        <div className="rounded-lg border border-black/10 p-2.5 grid grid-cols-3 gap-2 text-xs">
          {[['neto', 'Neto'], ['iva', 'IVA'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['otros', 'Otros']].map(([k, l]) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-black/55 font-medium">{l}</span>
              <input type="number" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="rounded border border-black/15 bg-white px-2 py-1 text-right text-sm text-black" />
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[#F0EBE2]/70 px-3 py-2">
          <span className="text-xs font-semibold text-black/60 uppercase tracking-wide">Total</span>
          <input type="number" value={f.monto ?? ''} onChange={(e) => set('monto', e.target.value)} placeholder={String(Math.round(totalCalc))} className="w-36 rounded border border-black/15 bg-white px-2 py-1.5 text-right text-base font-semibold text-black" />
        </div>
        {f.monto == null || f.monto === '' ? <p className="text-[10px] text-black/40">El total se calcula solo sumando el desglose; si lo escribís, manda el tuyo.</p> : null}

        <textarea value={f.notas ?? ''} onChange={(e) => set('notas', e.target.value)} rows={2} placeholder="Notas internas (opcional)…" className={input} />

        {hayDuplicado && (
          <label className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <input type="checkbox" checked={f.permitirDuplicado} onChange={(e) => set('permitirDuplicado', e.target.checked)} className="accent-[#B82D25]" />
            Ya existe un comprobante con ese número para este proveedor — cargar igual
          </label>
        )}
        {err && !hayDuplicado && <p className="text-xs text-[#932A1F]">{err}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={cerrar} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
          <button onClick={guardar} disabled={guardando || !f.proveedorId || !f.numero || !(total > 0)}
            className="rounded-full bg-[#B82D25] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-50">
            {guardando ? 'Cargando…' : 'Cargar comprobante'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-black text-lg">Cambios pendientes de aprobación</h2>
            <p className="text-xs text-black/50">{puedeResolver ? 'Al aprobar, el cambio se aplica en el momento y se avisa a quien lo pidió.' : 'Los aprueba un dueño. Acá ve el estado de lo pedido.'}</p>
          </div>
          <button onClick={cerrar} className="text-sm text-black/50 hover:text-black">Cerrar</button>
        </div>
        {err && <p className="rounded-lg bg-[#B82D25]/10 px-3 py-2 text-sm text-[#932A1F]">{err}</p>}
        {!items.length && <p className="text-sm text-black/45 py-6 text-center">No hay pedidos de cambio pendientes.</p>}
        {items.map((c: any) => (
          <div key={c.id} className="rounded-xl border border-black/10 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <button onClick={() => abrirFactura(c.factura_id)} className="text-sm font-semibold text-black hover:underline text-left">
                  {c.tipo === 'anular' ? 'Anular' : 'Cambiar'} {TIPOS[c.factura?.tipo] ?? 'Factura'}{c.factura?.letra ? ` ${c.factura.letra}` : ''} {c.factura?.numero} · {c.factura?.proveedor?.razon_social ?? ''}
                </button>
                <p className="text-xs text-black/55">Pidió {c.solicitante?.nombre ?? 'un usuario'} · {fecha(c.creado_en)} · total actual {pesos(c.factura?.monto)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 text-amber-900 px-2.5 py-1 text-[11px] font-semibold">Pendiente</span>
            </div>
            <p className="text-sm text-black"><span className="text-black/50">Motivo:</span> {c.motivo}</p>
            {c.tipo === 'editar' && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(c.cambios ?? {}).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-black">{ETIQ[k] ?? k}: <strong>{String(v ?? '—')}</strong></span>
                ))}
              </div>
            )}
            {puedeResolver && (
              <div className="flex flex-wrap gap-2 pt-1 items-center">
                <input placeholder="Respuesta (opcional)" value={respuesta[c.id] ?? ''} onChange={(e) => setRespuesta({ ...respuesta, [c.id]: e.target.value })} className={input + ' flex-1 min-w-[160px]'} />
                <button onClick={() => resolver(c.id, 'aprobar')} disabled={ocupado === c.id} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">Aprobar y aplicar</button>
                <button onClick={() => resolver(c.id, 'rechazar')} disabled={ocupado === c.id} className="rounded-full border border-[#B82D25] px-4 py-2 text-xs font-semibold text-[#B82D25] hover:bg-[#B82D25] hover:text-white disabled:opacity-40">Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

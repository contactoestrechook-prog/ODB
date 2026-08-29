'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { prepararComprobante } from './comprimirImagen';

// Mismo redondeo de góndola que aplica el servidor al guardar el precio
// (apps/api/src/compras/precio.ts): a la centena, de 50 para arriba sube. Se
// repite acá para que lo que se ve al cargar sea exactamente lo que queda.
function redondearPrecio(p: number): number {
  const n = Number(p) || 0;
  if (n <= 0) return 0;
  if (n < 100) return Math.round(n);
  return Math.round(n / 100) * 100;
}

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const ESTADO_ESTILO: Record<string, string> = {
  borrador: 'bg-[#F0EBE2] text-black/60', pendiente_aprobacion: 'bg-[#B82D25] text-white',
  aprobada: 'bg-black text-white', enviada: 'bg-black text-white',
  recibida_parcial: 'bg-amber-100 text-amber-900', recibida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-[#F0EBE2] text-black/40',
};
const ESTADO_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', recibida_parcial: 'parcial' };
const OP_ESTILO: Record<string, string> = {
  pendiente_aprobacion: 'bg-[#B82D25] text-white', aprobada: 'bg-black text-white',
  pagada: 'bg-emerald-100 text-emerald-800', rechazada: 'bg-[#F0EBE2] text-black/40',
};
const OP_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', aprobada: 'aprobada · a pagar', pagada: 'pagada', rechazada: 'rechazada' };

const TABS = [['ordenes', 'Órdenes'], ['aprobar', 'Por aprobar'], ['recepcion', 'Recepción'], ['proveedores', 'Proveedores'], ['pagos', 'Órdenes de pago'], ['sugerencias', 'Sugerencias']] as const;

const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

// La IA a veces devuelve la fecha como DD/MM/AAAA: la base solo acepta ISO.
// Si no se puede normalizar con certeza, mejor no mandar nada.
function normFechaIso(f?: string | null): string | undefined {
  if (!f) return undefined;
  const s = String(f).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function ComprasWorkspace({ resumen, ordenes, proveedores, sugerencias, sucursales, categorias = [] }: {
  resumen: any; ordenes: any[]; proveedores: any[]; sugerencias: any[]; sucursales: any[]; categorias?: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState('ordenes');
  const [modal, setModal] = useState<any>(null); // {tipo, ...}
  const [deuda, setDeuda] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (tab === 'pagos' && deuda === null) {
      fetch('/api/compras?recurso=deuda').then((r) => r.json()).then((d) => setDeuda(Array.isArray(d) ? d : []));
      fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()).then((d) => setPagos(Array.isArray(d) ? d : []));
    }
  }, [tab]);

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null);
    router.refresh();
    if (tab === 'pagos') {
      const [dd, pp] = await Promise.all([
        fetch('/api/compras?recurso=deuda').then((r) => r.json()),
        fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()),
      ]);
      setDeuda(Array.isArray(dd) ? dd : []);
      setPagos(Array.isArray(pp) ? pp : []);
    }
    return d;
  };

  const porAprobar = ordenes.filter((o) => o.estado === 'pendiente_aprobacion');
  const porRecibir = ordenes.filter((o) => ['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado));

  return (
    <div className="space-y-5">
      {/* KPIs + nueva OC */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-7 flex-wrap">
          {[['Comprado (mes)', pesos(resumen?.compradoMes)], ['A aprobar', resumen?.pendientesAprobacion ?? 0, 'text-[#B82D25]'], ['Por recibir', resumen?.porRecibir ?? 0], ['Deuda proveedores', pesos(resumen?.deudaProveedores), resumen?.deudaProveedores > 0 ? 'text-[#B82D25]' : ''], ['Sugerencias', resumen?.sugerencias ?? 0]].map(([l, v, c]: any) => (
            <div key={l}><p className={`text-xl font-semibold leading-none ${c || 'text-black'}`}>{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setModal({ tipo: 'entradaFoto' })} className="rounded-full bg-black text-white text-sm font-medium px-4 py-2.5 hover:bg-black/80 shadow-sm">📷 Entrada por foto</button>
          <button onClick={() => setModal({ tipo: 'entradaDirecta' })} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2.5 hover:border-black/40 shadow-sm">📦 Entrada directa (sin OC)</button>
          <button onClick={() => setModal({ tipo: 'nuevaOC', items: [] })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm">+ Nueva orden de compra</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => {
          const badge = k === 'aprobar' ? porAprobar.length : k === 'recepcion' ? porRecibir.length : k === 'sugerencias' ? sugerencias.length : 0;
          return <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}{badge ? <span className="ml-1.5 text-[10px] rounded-full bg-[#B82D25] text-white px-1.5 py-0.5">{badge > 99 ? '99+' : badge}</span> : ''}</button>;
        })}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      {/* ÓRDENES (todas) */}
      {(tab === 'ordenes' || tab === 'aprobar' || tab === 'recepcion') && (
        <div className="space-y-2">
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).map((o) => (
            <div
              key={o.numero}
              onClick={() => setModal({ tipo: 'ocDetalle', ocId: o.id, numero: o.numero })}
              className="rounded-xl bg-white p-4 cursor-pointer hover:bg-[#F0EBE2]/40 transition-colors"
              title="Ver el detalle, los remitos y las facturas de esta compra"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-black">OC #{o.numero} · {o.proveedor?.razon_social ?? '—'}
                    <span className={`ml-2 text-[11px] rounded-full px-2 py-0.5 ${ESTADO_ESTILO[o.estado] ?? ''}`}>{ESTADO_LABEL[o.estado] ?? o.estado}</span>
                  </p>
                  <p className="text-xs text-black/50 mt-0.5">
                    {o.sucursal?.nombre} · {fecha(o.creado_en)} · {(o.items ?? []).length} ítems
                    {o.condicion_pago && ` · ${o.condicion_pago}`}
                    {o.vencimiento_pago && ` · vence ${fecha(o.vencimiento_pago)}`}
                    {o.fecha_entrega && ` · entrega ${fecha(o.fecha_entrega)}`}
                    {o.firmadaPor && ` · aprobó ${o.firmadaPor}`}
                  </p>
                  {o.observaciones && <p className="text-xs text-black/40 mt-0.5 italic">“{o.observaciones}”</p>}
                  {o.estado === 'cancelada' && o.rechazo_motivo && <p className="text-xs text-[#B82D25] mt-0.5">Rechazada: {o.rechazo_motivo}</p>}
                </div>
                <div className="text-right whitespace-nowrap">
                  <p className="font-semibold text-black">{pesos(o.total)}</p>
                  <div className="flex gap-2 justify-end mt-1" onClick={(e) => e.stopPropagation()}>
                    {o.estado === 'pendiente_aprobacion' && <>
                      <button onClick={() => post({ accion: 'aprobar', id: o.id })} className="text-xs font-medium text-emerald-700 hover:underline">Aprobar</button>
                      <button onClick={() => setModal({ tipo: 'rechazar', oc: o })} className="text-xs font-medium text-[#B82D25] hover:underline">Rechazar</button>
                    </>}
                    {['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado) && <button onClick={() => setModal({ tipo: 'recibir', oc: o, recibido: {} })} className="text-xs font-medium text-emerald-700 hover:underline">Recibir</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).length === 0 && (
            <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">
              {tab === 'aprobar' ? 'No hay órdenes esperando aprobación.' : tab === 'recepcion' ? 'No hay órdenes pendientes de recepción.' : 'Sin órdenes de compra. Creá una o miralas en Sugerencias.'}
            </p>
          )}
        </div>
      )}

      {/* PROVEEDORES */}
      {tab === 'proveedores' && (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setModal({ tipo: 'proveedor', prov: {} })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">+ Nuevo proveedor</button></div>
          <section className="rounded-xl bg-white overflow-hidden">
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Proveedor</th><th className="px-4 py-2 font-medium">CUIT</th><th className="px-4 py-2 font-medium">Condición</th><th className="px-4 py-2 font-medium text-right">Entrega</th><th className="px-4 py-2" />
              </tr></thead>
              <tbody>
                {proveedores.map((p) => (
                  <tr key={p.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium">{p.razon_social}</p><p className="text-xs text-black/45">{p.email ?? ''}</p></td>
                    <td className="px-4 py-3 text-black/70">{p.cuit ?? '—'}</td>
                    <td className="px-4 py-3 text-black/70">{p.condicion_pago ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-black/70">{p.lead_time_dias} días</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setModal({ tipo: 'proveedor', prov: p })} className="text-xs text-[#B82D25] hover:underline">Editar</button></td>
                  </tr>
                ))}
                {proveedores.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-black/40 text-sm">Sin proveedores. Agregá el primero.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* ÓRDENES DE PAGO */}
      {tab === 'pagos' && (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setModal({ tipo: 'factura' })} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 hover:border-black/40">+ Registrar factura de proveedor</button></div>
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Cuentas a pagar (por proveedor)</h2>
            {deuda === null ? <p className="px-4 py-6 text-center text-black/40 text-sm">Cargando…</p>
              : deuda.length === 0 ? <p className="px-4 py-6 text-center text-black/40 text-sm">Sin facturas pendientes de pago.</p>
              : deuda.map((d) => (
                <div key={d.proveedor?.id} className="px-4 py-3 border-b border-black/5 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="font-medium text-black">{d.proveedor?.razon_social}</p><p className="text-xs text-black/50">{d.facturas.length} factura(s) · próx. vence {fecha(d.facturas[0]?.vencimiento)}</p></div>
                    <div className="text-right"><p className="font-semibold text-[#B82D25]">{pesos(d.total)}</p>
                      <button onClick={() => setModal({ tipo: 'pagar', prov: d })} className="text-xs font-medium text-emerald-700 hover:underline">Crear orden de pago →</button></div>
                  </div>
                  {/* cada factura es clickeable para ver su detalle */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.facturas.map((fc: any) => (
                      <button key={fc.id} onClick={() => setModal({ tipo: 'facturaDetalle', facturaId: fc.id })}
                        className="rounded-full border border-black/15 px-2.5 py-1 text-xs text-black/70 hover:border-[#B82D25] hover:text-[#B82D25]">
                        #{fc.numero} · {pesos(fc.monto)} ↗
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </section>
          {pagos && pagos.length > 0 && (
            <section className="rounded-xl bg-white overflow-hidden">
              <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Órdenes de pago</h2>
              {pagos.map((p) => (
                <div key={p.numero} className="px-4 py-2.5 border-b border-black/5 last:border-0 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="text-black">OP #{p.numero} · {p.proveedor?.razon_social}</span>
                    <span className={`ml-2 text-[10px] rounded-full px-2 py-0.5 ${OP_ESTILO[p.estado] ?? 'bg-[#F0EBE2] text-black/60'}`}>{OP_LABEL[p.estado] ?? p.estado}</span>
                    <p className="text-xs text-black/45">{p.medio_pago}{p.vencimiento ? ` · vence ${fecha(p.vencimiento)}` : ''}{p.pagada_en ? ` · pagada ${fecha(p.pagada_en)}` : ''}</p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="font-medium">{pesos(p.total)}</p>
                    <div className="flex gap-2 justify-end mt-0.5">
                      {p.estado === 'pendiente_aprobacion' && <>
                        <button onClick={() => post({ accion: 'aprobarOP', id: p.id })} className="text-xs font-medium text-emerald-700 hover:underline">Aprobar</button>
                        <button onClick={() => setModal({ tipo: 'rechazarOP', op: p })} className="text-xs font-medium text-[#B82D25] hover:underline">Rechazar</button>
                      </>}
                      {p.estado === 'aprobada' && <button onClick={() => post({ accion: 'pagarOP', id: p.id })} className="text-xs font-medium text-black hover:underline">Marcar pagada</button>}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* SUGERENCIAS */}
      {tab === 'sugerencias' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
            <h2 className="font-medium text-black text-sm">Sugerencias de reposición</h2>
            <a href="/analista" className="text-xs text-[#B82D25] hover:underline">Pedir plan al Analista ODB →</a>
          </div>
          {sugerencias.length === 0 ? <p className="px-4 py-6 text-sm text-black/50">Nada para reponer por ahora.</p> : (
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5"><th className="px-4 py-2 font-medium">Producto</th><th className="px-4 py-2 font-medium">Sucursal</th><th className="px-4 py-2 font-medium text-right">Stock</th><th className="px-4 py-2 font-medium text-right">Sugerido</th><th className="px-4 py-2 font-medium">Proveedor</th></tr></thead>
              <tbody>
                {sugerencias.slice(0, 100).map((s) => (
                  <tr key={`${s.sku}-${s.sucursal}`} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5"><p className="font-medium">{s.producto}</p><p className="text-xs text-black/45">{s.sku}</p></td>
                    <td className="px-4 py-2.5 text-black/70">{s.sucursal}</td>
                    <td className="px-4 py-2.5 text-right">{Math.round(Number(s.cantidad))}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{Math.round(Number(s.cantidad_sugerida))} u.</td>
                    <td className="px-4 py-2.5 text-black/70 text-xs">{s.proveedor ?? 'sin asignar'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {modal && <Modal modal={modal} setModal={setModal} post={post} proveedores={proveedores} sucursales={sucursales} aviso={aviso} categorias={categorias} />}
    </div>
  );
}

function Modal({ modal, setModal, post, proveedores, sucursales, aviso, categorias = [] }: any) {
  const [f, setF] = useState<any>(modal.prov ?? modal);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const [items, setItems] = useState<any[]>([]);
  const [busca, setBusca] = useState(''); const [sug, setSug] = useState<any[]>([]);
  const [recibido, setRecibido] = useState<Record<string, string>>({});
  const [vencs, setVencs] = useState<Record<string, string>>({}); // vencimiento por sku al recibir → crea el lote
  // Remarcación por producto: la que quedó aprendida de la última entrada de ese
  // proveedor (y la del rubro como respaldo). Se propone en cada renglón para no
  // volver a pedirla cada vez que entra la misma mercadería; se puede editar, y
  // lo que se edite queda aprendido para la próxima.
  const [remarca, setRemarca] = useState<Record<string, { margenPct: number | null; margenRubro: number | null; ultimoCosto: number | null }>>({});
  const [margenPorSku, setMargenPorSku] = useState<Record<string, string>>({});
  // renglones donde el % editado pasa a ser el HABITUAL. Por defecto no: un %
  // distinto al de siempre es una promoción y vale solo para esta entrada.
  const [fijarSku, setFijarSku] = useState<Record<string, boolean>>({});

  const traerRemarcacion = useCallback(async (proveedorId: string, skus: string[]) => {
    const faltan = skus.filter((sku) => sku && !(sku in remarca));
    if (!faltan.length) return;
    try {
      const r = await fetch(`/api/compras?recurso=remarcacion&proveedorId=${encodeURIComponent(proveedorId ?? '')}&skus=${encodeURIComponent(faltan.join(','))}`);
      if (!r.ok) return;
      const d = await r.json();
      setRemarca((x) => ({ ...x, ...d }));
      // se propone la aprendida; si no hay, el casillero queda vacío y manda el rubro
      setMargenPorSku((m) => {
        const nuevo = { ...m };
        for (const [sku, v] of Object.entries(d as Record<string, any>)) {
          if (nuevo[sku] === undefined && v?.margenPct != null) nuevo[sku] = String(v.margenPct);
        }
        return nuevo;
      });
    } catch { /* si no se puede consultar, se usa el del rubro como siempre */ }
  }, [remarca]);

  // Al abrir "recibir" o "entrada directa", se consulta qué remarcación quedó
  // aprendida para esos productos con ese proveedor y se propone en cada
  // renglón. Es lo que evita tener que acordarse del porcentaje de memoria cada
  // vez que entra la misma mercadería.
  useEffect(() => {
    if (modal?.tipo === 'recibir') {
      const skus = (modal.oc?.items ?? []).map((it: any) => it.producto?.sku).filter(Boolean);
      traerRemarcacion(modal.oc?.proveedor_id ?? '', skus);
    }
  }, [modal, traerRemarcacion]);

  useEffect(() => {
    if (modal?.tipo !== 'entradaDirecta' || !items.length) return;
    traerRemarcacion(f.proveedorId ?? '', items.map((i: any) => i.sku).filter(Boolean));
  }, [modal, items, f.proveedorId, traerRemarcacion]);

  // lo aprendido es POR proveedor: si cambian de proveedor, se olvida lo propuesto
  useEffect(() => {
    if (modal?.tipo !== 'entradaDirecta') return;
    setRemarca({});
    setMargenPorSku({});
  }, [modal?.tipo, f.proveedorId]);

  // Debajo del casillero de %: dice cuál es el habitual, deja volver a él de un
  // toque, y ofrece fijar el nuevo si el cambio vino para quedarse.
  const AvisoMargen = ({ sku, habitualExterno, valor, poner }: { sku: string; habitualExterno?: number | null; valor?: any; poner?: (v: string) => void }) => {
    const info = remarca[sku];
    const habitual = habitualExterno !== undefined ? habitualExterno : info?.margenPct;
    if (habitual == null) return null;
    const puesto = valor !== undefined ? (valor === '' || valor == null ? '' : String(valor)) : (margenPorSku[sku] ?? '');
    const setear = poner ?? ((v: string) => setMargenPorSku((m) => ({ ...m, [sku]: v })));
    if (puesto === '' || Number(puesto) === Number(habitual)) {
      return <p className="text-[10px] text-black/35 text-right">habitual {habitual}%</p>;
    }
    return (
      <p className="text-[10px] text-right">
        <button onClick={() => setear(String(habitual))} className="text-black/45 underline">
          volver al {habitual}%
        </button>
        <label className="ml-2 inline-flex items-center gap-1 text-[#B82D25]" title="Si no lo tildás, este % vale solo para esta entrada">
          <input type="checkbox" checked={!!fijarSku[sku]} onChange={(e) => setFijarSku((x) => ({ ...x, [sku]: e.target.checked }))} className="accent-[#B82D25]" />
          dejarlo fijo
        </label>
      </p>
    );
  };

  const [facturasSel, setFacturasSel] = useState<string[]>(modal.prov?.facturas?.map((x: any) => x.id) ?? []);
  const [importando, setImportando] = useState(false);
  const [importInfo, setImportInfo] = useState<{ conMatch: number; sinMatch: string[] } | null>(null);

  // --- entrada por foto: la IA lee la factura/remito y acá se revisa y confirma ---
  const [foto, setFoto] = useState<any>(null); // resultado de /api/entrada-foto
  const [fotoArchivo, setFotoArchivo] = useState<File | null>(null); // imagen ya comprimida (para re-leer)
  const [verOriginal, setVerOriginal] = useState(true); // mostrar el documento original al lado de lo leído
  const [fotoUrl, setFotoUrl] = useState<string | null>(null); // URL local del archivo, para el visor
  const [fotoRot, setFotoRot] = useState(0); // rotación del visor: 0/90/180/270
  const [fotoZoom, setFotoZoom] = useState(1); // zoom del visor
  const [aclaraciones, setAclaraciones] = useState(''); // respuestas del operador a las dudas de la IA
  const [fotoItems, setFotoItems] = useState<any[]>([]); // renglones editables
  const [fotoImp, setFotoImp] = useState<any>({});
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const [sumarIva, setSumarIva] = useState(true); // factura A: costo = neto + IVA
  // Percepciones adentro del costo: es la política de la casa. Se puede sacar
  // para una factura puntual (por ejemplo si esa percepción se va a usar).
  const [percepcionesAlCosto, setPercepcionesAlCosto] = useState(true);
  const [pagada, setPagada] = useState(false);
  // true = la mercadería ya ingresó por Recepción (pistola): solo se registra la
  // factura con sus renglones y va a la bandeja de conciliación, SIN mover stock
  const [soloFactura, setSoloFactura] = useState(false);
  // buscador por renglón para vincular un producto (índice de fila + texto + resultados)
  const [vinculaIdx, setVinculaIdx] = useState<number | null>(null);
  const [vinculaBusca, setVinculaBusca] = useState('');
  const [vinculaSug, setVinculaSug] = useState<any[]>([]);

  // Primera lectura: comprime la foto en el navegador (las de celular pesan
  // 10-20 MB) y la guarda por si hay que volver a leerla con aclaraciones. El PDF
  // va tal cual.
  async function leerFoto(archivo: File) {
    setAclaraciones('');
    const listo = await prepararComprobante(archivo);
    setFotoArchivo(listo);
    await enviarComprobante(listo, '');
  }

  // Segunda pasada: la misma imagen + lo que el operador aclaró sobre las dudas.
  async function reLeerConAclaraciones() {
    if (!fotoArchivo || !aclaraciones.trim()) return;
    await enviarComprobante(fotoArchivo, aclaraciones);
  }

  async function enviarComprobante(listo: File, aclara: string) {
    setLeyendoFoto(true);
    try {
      const fd = new FormData();
      fd.append('archivo', listo);
      if (aclara.trim()) fd.append('aclaraciones', aclara.trim());
      const r = await fetch('/api/entrada-foto', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo leer el comprobante');
      setFoto(d);
      setF((x: any) => ({
        ...x,
        proveedorId: d.proveedor?.match?.id ?? '',
        numeroRemito: d.comprobante?.numero ?? '',
      }));
      setFotoImp({ ...(d.impuestos ?? {}) });
      // "Sumar IVA" (solo relevante como fallback cuando no hay pie): arranca en ON
      // únicamente si los renglones parecen NETOS (su suma ≈ el neto gravado), el IVA
      // no es sospechoso y no es régimen especial. En cigarrillos → OFF.
      const sumaLineas = (d.items ?? []).reduce((s: number, i: any) => s + (Number(i.cantidad) || 1) * (Number(i.precio) || 0), 0);
      const netoLeido = d.impuestos?.neto != null ? Number(d.impuestos.neto) : null;
      const ivaLeido = d.impuestos?.iva != null ? Number(d.impuestos.iva) : null;
      const alicEf = netoLeido && netoLeido > 0 && ivaLeido != null ? ivaLeido / netoLeido : null;
      const escala = netoLeido && netoLeido > 0 ? netoLeido : (sumaLineas || 1);
      const dNeto = netoLeido != null ? Math.abs(sumaLineas - netoLeido) / escala : Infinity;
      const ivaSospechoso = alicEf != null && (alicEf < 0.18 || alicEf > 0.23) && !(alicEf >= 0.095 && alicEf <= 0.115);
      setSumarIva(d.comprobante?.tipo === 'factura_a' && dNeto <= 0.01 && !ivaSospechoso && !d.regimenEspecial);
      setPagada(/contado/i.test(d.comprobante?.condicionVenta ?? ''));
      setFotoItems((d.items ?? []).map((i: any) => {
        const sugerido = i.match?.sugerido === true;
        // Producto por PESO: la IA transcribió la columna KG. Lo aplicamos solo
        // si el peso cierra con el importe (peso × precio ≈ importe), para no
        // cargar un peso mal leído; si no cierra, queda el botón «Pasar a kilos».
        const kgLeido = Number(i.kg) || 0;
        const cantLeida = Number(i.cantidad) || 1;
        const precioNum = Number(i.precio) || 0;
        const importeNum = i.importe != null && i.importe !== '' ? Number(i.importe) : null;
        let cantidad = cantLeida;
        let porPeso = false;
        // el peso solo se considera si el producto puede venderse así y si no
        // hay una bonificación de la fila que ya explique la diferencia
        const puedePeso = !!i.puedePorPeso && !(Math.abs(Number(i.bonificacionPct) || 0) > 0);
        if (puedePeso && kgLeido > 0 && Math.abs(kgLeido - cantLeida) > 0.01) {
          const esperado = kgLeido * precioNum;
          const cierra = importeNum == null || esperado <= 0
            || Math.abs(Math.abs(importeNum) - esperado) / esperado < 0.05;
          if (cierra) { cantidad = kgLeido; porPeso = true; }
        }
        // Producto por PESO sin columna KG (fiambres, quesos por horma): la CANT
        // es 1 pero el importe del renglón = peso × precio, con el precio POR
        // KILO. Si el importe no cierra con cantidad × precio y el peso que
        // implica es decimal (un entero sería un bulto, no un peso), lo cargamos
        // en kilos solo. El costo pasa a ser el precio por kilo.
        if (puedePeso && !porPeso && importeNum != null && precioNum > 0 && cantLeida > 0
            && Number(i.unidadesPorBulto ?? 0) <= 1 && !i.esDescuento) {
          const esperado = cantLeida * precioNum;
          const pesoImp = Math.abs(importeNum) / precioNum;
          const noCierra = esperado > 0 && Math.abs(Math.abs(importeNum) - esperado) / esperado > 0.02;
          const distintoDeCant = Math.abs(pesoImp - cantLeida) > 0.01;
          const noEsEntero = Math.abs(pesoImp - Math.round(pesoImp)) > 0.02; // un entero sería bulto
          if (noCierra && distintoDeCant && noEsEntero) {
            cantidad = Math.round(pesoImp * 1000) / 1000;
            porPeso = true;
          }
        }
        return {
          descripcion: i.descripcion,
          cantidad,
          porPeso,
          kg: i.kg ?? null,
          precio: Number(i.precio) || 0,
          sku: i.match?.sku ?? '',
          nombre: i.match?.nombre ?? null,
          variacionPct: i.match?.variacionPct ?? null,
          sugerido, // la IA lo propuso: hay que confirmar antes de incluir
          motivoIa: i.match?.motivo ?? null,
          // por qué NO se vinculó: medida distinta a la del producto parecido
          avisoMedida: i.avisoMedida ?? null,
          // remarcación: la guardada de la última compra; vacío ('') = hereda del rubro
          margenPct: i.match?.margenPct != null ? i.match.margenPct : '',
          codigo: i.codigo ?? null,
          // Lo que resuelve el lector en código: unidades por bulto, bonificación
          // y si el renglón es una rebaja en vez de mercadería. Este mapeo arma un
          // objeto nuevo, así que un campo que no se copie acá no existe para la
          // pantalla por más que la API lo mande.
          unidadesPorBulto: i.unidadesPorBulto ?? null,
          bonificacionPct: i.bonificacionPct ?? null,
          importe: i.importe ?? null,
          esDescuento: !!i.esDescuento,
          descuentoPct: i.descuentoPct ?? null,
          puedePorPeso: !!i.puedePorPeso,
          bultoAplicado: null,
          // las sugerencias de IA NO se incluyen hasta que el operador confirme "¿es este?"
          // y una rebaja no se incluye NUNCA: no es mercadería
          incluir: !i.esDescuento && !!i.match && !sugerido,
        };
      }));
    } catch (e) {
      setFoto({ error: e instanceof Error ? e.message : 'Error al leer' });
    }
    setLeyendoFoto(false);
  }

  // --- Costeo por PRORRATEO re-anclado a la mercadería (spec contable) ---
  // El costo unitario reparte el valor de la mercadería (neto + IVA + internos, SIN
  // percepciones) entre los renglones en proporción a su PRE.UNIT. Así se limpia la
  // percepción IIBB embebida (cigarrillos) y desaparece el ×1,21 a ciegas. En una
  // factura A normal con precios netos el factor da 1,21 (suma IVA), y sin pie
  // (remito) cae al fallback del checkbox "Sumar IVA".
  const numImp = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Muchos renglones vienen POR BULTO: "CORONA 355 X 24B", cantidad 84, precio
  // $55.000. Si eso entra tal cual contra el producto suelto, quedan 84
  // unidades a $55.000 en vez de 2.016 a $2.292 — y ese costo pasa derecho al
  // precio de venta. La conversión NO se hace sola: el renglón podría estar
  // vinculado al bulto y ahí multiplicar sería el error al revés.
  const pasarAUnidad = (idx: number) =>
    setFotoItems((xs) => xs.map((x, j) => {
      if (j !== idx) return x;
      const n = Math.round(numImp(x.unidadesPorBulto));
      if (!(n > 1)) return x;
      return {
        ...x,
        cantidad: numImp(x.cantidad) * n,
        precio: Math.round((numImp(x.precio) / n) * 100) / 100,
        // se guarda para poder volver atrás y para dejar dicho qué se hizo
        bultoAplicado: n,
        unidadesPorBulto: null,
      };
    }));

  const volverABulto = (idx: number) =>
    setFotoItems((xs) => xs.map((x, j) => {
      if (j !== idx) return x;
      const n = Math.round(numImp(x.bultoAplicado));
      if (!(n > 1)) return x;
      return {
        ...x,
        cantidad: numImp(x.cantidad) / n,
        precio: Math.round(numImp(x.precio) * n * 100) / 100,
        bultoAplicado: null,
        unidadesPorBulto: n,
      };
    }));
  const discriminaIva = foto?.comprobante?.tipo === 'factura_a';
  // Lo que de verdad se paga por el renglón. Una bonificación del 100% deja el
  // renglón en cero: la mercadería llega igual, pero no se paga. Sin esto, los
  // renglones bonificados inflaban la suma de renglones y, como el costo sale
  // de prorratear el pie sobre esa suma, ABARATABAN también a los productos que
  // sí se pagaron.
  // Lo que REALMENTE cuesta una unidad de este renglón.
  //
  // El orden importa. Manda el importe impreso del renglón, porque ya trae
  // aplicado todo lo de esa fila: es común que el proveedor mande mercadería
  // sin cargo con el precio unitario lleno (el de lista) y el importe en cero.
  // Si no hay columna de importe, se cae al precio unitario menos la
  // bonificación. Y en cualquier caso se le suma el descuento que venga en un
  // renglón aparte.
  // Lo que factura el renglón, por unidad, ANTES de los descuentos de otros
  // renglones. Manda el importe impreso; si no hay columna, el unitario menos
  // la bonificación de la fila.
  const baseUnitaria = (i: any) => {
    const cant = numImp(i.cantidad) || 1;
    return i.importe != null && i.importe !== ''
      ? numImp(i.importe) / cant
      : numImp(i.precio) * (1 - Math.min(100, Math.abs(numImp(i.bonificacionPct))) / 100);
  };

  // Un descuento NO puede ser más grande que el renglón al que se aplica. Si lo
  // es, la rebaja no era de ese renglón solo —suele ser una promoción que cubre
  // varios, o toda la factura— y adjudicársela entera deja el costo por el
  // piso o en negativo. En ese caso no se aplica y se avisa: es preferible que
  // alguien decida a que el sistema invente un costo.
  const descuentoDesmedido = (i: any) => {
    const d = Math.abs(numImp(i._descuento));
    const linea = Math.abs(baseUnitaria(i) * (numImp(i.cantidad) || 1));
    return d > 0 && linea > 0 && d > linea;
  };

  const precioEfectivo = (i: any) => {
    const cant = numImp(i.cantidad) || 1;
    const base = baseUnitaria(i);
    if (descuentoDesmedido(i)) return base; // sin aplicar: hay que revisarlo a mano
    return base + numImp(i._descuento) / cant;
  };
  // Producto por PESO (fiambres, quesos fraccionados): la factura trae CANT=1
  // (una horma), pero el precio es POR KILO y el importe del renglón = peso ×
  // precio. Si se deja cantidad=1, ese precio/kilo se reconcilia contra el pie
  // hasta el TOTAL de la horma y el costo entra inflado. El peso real sale de
  // dividir el importe del renglón por el precio unitario.
  const pesoDelImporte = (i: any) => {
    const imp = Math.abs(numImp(i.importe));
    const p = Math.abs(numImp(i.precio));
    return imp > 0 && p > 0 ? imp / p : 0;
  };
  const medidaVariable = (i: any) => {
    // Que la cuenta no cierre tiene varias explicaciones; el peso es solo una,
    // y para una bebida es imposible. Sin esto, una lata de 1000ml se ofrecía
    // cargar como 24 kg.
    if (!i.puedePorPeso) return false;
    if (i._esDescuento || numImp(i._descuento) !== 0) return false;
    // Una bonificación en el propio renglón ya explica por qué el importe no da
    // cantidad × precio, y lo explica MEJOR que el peso. Un vino bonificado al
    // 50% deja importe ÷ precio = 0,5, que leído como peso es "medio kilo".
    if (numImp(i.bonificacionPct) > 0) return false;
    if (numImp(i.unidadesPorBulto) > 1 || numImp(i.bultoAplicado) > 1) return false; // eso es bulto, no peso
    const imp = Math.abs(numImp(i.importe));
    const cant = numImp(i.cantidad);
    const p = Math.abs(numImp(i.precio));
    if (!(imp > 0 && p > 0 && cant > 0)) return false;
    const esperado = cant * p;
    if (esperado <= 0) return false;
    // el importe representa bastante más (o menos) que cantidad × precio, y el
    // peso que implica no coincide con la cantidad leída → el precio es por kilo
    return Math.abs(imp - esperado) / esperado > 0.02 && Math.abs(pesoDelImporte(i) - cant) > 0.01;
  };
  const pasarAPeso = (idx: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx) return x;
    const p = Math.abs(numImp(x.precio));
    const imp = Math.abs(numImp(x.importe));
    const kilos = p > 0 ? Math.round((imp / p) * 1000) / 1000 : numImp(x.cantidad);
    return { ...x, cantidad: kilos, porPeso: true };
  }));

  // ¿Este renglón vino sin cargo? Es lo que después se prorratea.
  // La factura trae su propia prueba: cantidad × precio unitario tiene que dar
  // el importe del renglón. Cuando el lector toma un número de la fila de al
  // lado —pasa con las columnas apretadas y con las anotaciones a mano que
  // corren el renglón— esa cuenta deja de cerrar. Es lo único que agarra ese
  // error a tiempo, porque el número leído es plausible: es el precio de otro
  // producto de la misma factura.
  const precioSegunImporte = (i: any): number | null => {
    const cantidad = numImp(i.cantidad);
    const precio = numImp(i.precio);
    const importe = i.importe == null || i.importe === '' ? null : Math.abs(numImp(i.importe));
    if (!cantidad || !precio || !importe) return null;
    if (i._esDescuento || numImp(i.kg) > 0 || i.porPeso) return null; // por peso tiene su propia regla
    const esperado = cantidad * precio;
    if (Math.abs(importe - esperado) / esperado <= 0.02) return null;
    return Math.round((importe / cantidad) * 100) / 100;
  };

  const esSinCargo = (i: any) => !i._esDescuento && numImp(i.cantidad) > 0 && Math.abs(precioEfectivo(i)) < 0.01;

  // Un renglón "Desc. 42,86% - MANOS NEGRAS Malbec" NO es mercadería: es una
  // rebaja sobre el renglón de arriba. Antes se ofrecía vincularlo a un
  // producto, y aceptar esa sugerencia habría cargado 7 unidades a -$22.630.
  // Peor: como la rebaja no se aplicaba, el Malbec entraba a precio de lista,
  // un 43% más caro de lo que se pagó, y ese costo va al precio de venta.
  const esRenglonDescuento = (i: any) => !!i.esDescuento || numImp(i.precio) < 0;
  const soloTexto = (t: any) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Reparte cada renglón de descuento sobre la mercadería que le corresponde.
  // Tres formas, en orden: (1) el descuento NOMBRA un renglón y la cuenta cierra
  // con él; (2) es un descuento de GRUPO (típico de Coca/distribuidores: "Px
  // mágico = 17,2%", "AQ 1.5L = 24,3%") que aplica a TODOS los renglones desde
  // el descuento anterior hasta este, y se reparte proporcional al importe de
  // cada uno; (3) no se puede atribuir → no se aplica y se avisa. El reparto por
  // grupo nunca deja un costo en negativo (cada renglón recibe una fracción de
  // lo suyo) y cierra con el pie por construcción.
  const sinAtribuir: { descripcion: string; importe: number }[] = [];
  const grupoDeDescuento = new Map<number, { n: number; pct: number | null; importe: number }>();
  const base = (x: any) => {
    const cant = numImp(x.cantidad) || 1;
    return x.importe != null && x.importe !== '' ? Math.abs(numImp(x.importe)) : Math.abs(numImp(x.precio) * cant);
  };
  const descuentoPorIdx = (() => {
    const m = new Map<number, number>();
    let ventanaInicio = 0; // primer índice de mercadería de la ventana en curso
    fotoItems.forEach((d: any, j: number) => {
      if (!esRenglonDescuento(d)) return;
      const cerrarVentana = () => { ventanaInicio = j + 1; };
      // El operador decidió no aplicar esta rebaja: la mercadería queda a precio
      // de lista y lo pagado de menos se reparte solo en la reconciliación.
      if (d.noAplicar) return cerrarVentana();
      const importe = d.importe != null && d.importe !== '' && numImp(d.importe) !== 0
        ? numImp(d.importe) : numImp(d.cantidad) * numImp(d.precio);
      if (!importe) return cerrarVentana();
      const abs = Math.abs(importe);
      const textoDesc = soloTexto(d.descripcion);
      const pct = d.descuentoPct != null ? numImp(d.descuentoPct) : null;

      // 1) NOMBRA un renglón puntual (dentro de la ventana) y cierra con él
      let destino = -1;
      for (let k = j - 1; k >= ventanaInicio; k--) {
        if (esRenglonDescuento(fotoItems[k])) continue;
        const nombre = soloTexto(fotoItems[k].descripcion);
        const linea = base(fotoItems[k]);
        const cierraUno = linea > 0 && (pct != null ? Math.abs((abs / linea) * 100 - pct) <= 1.5 : abs <= linea);
        if (nombre && textoDesc.includes(nombre) && cierraUno) { destino = k; break; }
      }
      if (destino >= 0) { m.set(destino, (m.get(destino) ?? 0) + importe); return cerrarVentana(); }

      // 2) descuento de GRUPO: los renglones de mercadería de la ventana
      const grupo: number[] = [];
      let sumaG = 0;
      for (let k = ventanaInicio; k < j; k++) {
        if (esRenglonDescuento(fotoItems[k])) continue;
        const b = base(fotoItems[k]);
        if (b > 0) { grupo.push(k); sumaG += b; }
      }
      // Se acepta si el descuento es una fracción del grupo y —cuando el papel
      // trae el %— ese % cierra con la suma del grupo (tolerancia amplia para no
      // depender de si la IA leyó la columna con o sin IVA).
      const pctCierra = pct == null || Math.abs(sumaG * (pct / 100) - abs) / abs < 0.06;
      if (grupo.length > 0 && sumaG > 0 && abs < sumaG * 0.999 && pctCierra) {
        for (const k of grupo) m.set(k, (m.get(k) ?? 0) + importe * (base(fotoItems[k]) / sumaG));
        grupoDeDescuento.set(j, { n: grupo.length, pct, importe: abs });
        return cerrarVentana();
      }

      // 3) no se pudo atribuir con certeza
      sinAtribuir.push({ descripcion: d.descripcion, importe: abs });
      cerrarVentana();
    });
    return m;
  })();
  // La lista con la que se calcula y se dibuja: cada renglón ya sabe qué
  // descuento le corresponde.
  const itemsCalc = fotoItems.map((i: any, idx: number) => ({
    ...i,
    _descuento: descuentoPorIdx.get(idx) ?? 0,
    _esDescuento: esRenglonDescuento(i),
  }));
  // OJO: el descuento ya está adentro de precioEfectivo del renglón que rebaja.
  // Sumar además el renglón de descuento lo restaría DOS veces.
  const sumaRenglones = itemsCalc.reduce(
    (s: number, i: any) => (i._esDescuento ? s : s + numImp(i.cantidad) * precioEfectivo(i)),
    0,
  );
  const netoDoc = fotoImp?.neto != null && fotoImp.neto !== '' ? numImp(fotoImp.neto) : null;
  const ivaDoc = fotoImp?.iva != null && fotoImp.iva !== '' ? numImp(fotoImp.iva) : null;
  const percIvaDoc = numImp(fotoImp?.percepcionIva);
  const percIibbDoc = numImp(fotoImp?.percepcionIibb);
  const impIntDoc = numImp(fotoImp?.impuestosInternos);
  const otrosDoc = numImp(fotoImp?.otros);
  // Descuento del pie sobre TODA la factura ("Desc. 50%"). Es lo que explica
  // que los renglones sumen más que el neto. Sin tenerlo en cuenta, el control
  // de "los renglones no cierran con el pie" gritaba en falso en cualquier
  // factura con descuento general — y un aviso que grita en falso se ignora.
  const descuentoGlobalDoc = Math.abs(numImp(fotoImp?.descuentoGlobal));
  const totalDoc = fotoImp?.total != null && fotoImp.total !== '' ? numImp(fotoImp.total) : null;
  const alicEfectiva = netoDoc && netoDoc > 0 && ivaDoc != null ? ivaDoc / netoDoc : null;
  // mercadería con IVA, sin percepciones
  const valorConIva = (netoDoc != null && ivaDoc != null) ? netoDoc + ivaDoc + impIntDoc
    : (totalDoc != null) ? totalDoc - percIvaDoc - percIibbDoc - otrosDoc : null;
  // Las percepciones (IIBB, IVA) son pago a cuenta de impuestos propios: en los
  // libros no son costo. Pero solo dejan de serlo si después se USAN contra el
  // impuesto que corresponde; si se acumulan sin consumir, es plata que salió y
  // no vuelve. La casa decidió costear con las percepciones adentro, que es la
  // política prudente: mejor un costo apenas alto que un precio de venta que no
  // cubre lo que de verdad se pagó.
  const percepciones = percIvaDoc + percIibbDoc;
  const baseCosto = valorConIva != null ? valorConIva + (percepcionesAlCosto ? percepciones : 0) : null;
  const factorRecon = (baseCosto != null && sumaRenglones > 0) ? baseCosto / sumaRenglones
    : (discriminaIva && sumarIva && alicEfectiva != null ? 1 + alicEfectiva : discriminaIva && sumarIva ? 1.21 : 1);
  const costoFinal = (i: any) => Math.round(precioEfectivo(i) * factorRecon * 100) / 100;
  const hayDatosFiscales = baseCosto != null;
  // Reconciliación: el costo a stock nunca puede superar el valor de la mercadería
  // con IVA (ni el total). Si lo hace, hay un error y se bloquea Registrar.
  const inclItems = itemsCalc.filter((i: any) => i.incluir && !i._esDescuento);
  const sumaCostos = inclItems.reduce((s, i) => s + numImp(i.cantidad) * costoFinal(i), 0);
  const baseIncluidos = inclItems.reduce((s, i) => s + numImp(i.cantidad) * precioEfectivo(i), 0) * factorRecon;
  const techoMerc = baseCosto != null ? baseCosto : (totalDoc != null ? totalDoc : Infinity);
  const excedeMerc = sumaCostos > techoMerc * 1.005;
  const excedeTotal = totalDoc != null && sumaCostos > totalDoc * 1.005;
  const subCosteo = baseIncluidos > 0 && sumaCostos < baseIncluidos * 0.98;
  // Si los renglones leídos no suman el neto del pie, la IA leyó otra columna
  // (la de con IVA, o el total del renglón en vez del unitario). El factor sale
  // de dividir el pie por esa suma, así que un renglón mal leído ensucia el
  // costo de TODOS sin que se note: el total cierra igual. Es la causa más
  // común de "el costo no me da".
  // Lo que los renglones TENDRÍAN que sumar: el neto más lo que se descontó en
  // el pie (el descuento se aplica después de sumar los renglones).
  // Rebajas que el operador eligió no aplicar: para el control del pie cuentan
  // igual que el descuento global (los renglones van a sumar de más por eso).
  const descuentosNoAplicados = fotoItems.reduce(
    (s: number, d: any) => (esRenglonDescuento(d) && d.noAplicar ? s + Math.abs(numImp(d.cantidad) * numImp(d.precio)) : s),
    0,
  );
  const netoEsperado = netoDoc != null ? netoDoc + descuentoGlobalDoc + descuentosNoAplicados : null;
  const desvioRenglones = netoEsperado != null && netoEsperado > 0 && sumaRenglones > 0
    ? sumaRenglones / netoEsperado - 1
    : null;
  const columnaSospechosa = desvioRenglones != null && Math.abs(desvioRenglones) > 0.02;
  // Renglones que la IA leyó como bulto y siguen sin convertir. No bloquea
  // —puede que el producto vinculado sea el bulto— pero tiene que estar a la
  // vista antes de apretar Registrar.
  const bultosSinResolver = inclItems.filter((i) => numImp(i.unidadesPorBulto) > 1).length;
  const descuentosDesmedidos = inclItems.filter((i: any) => descuentoDesmedido(i)).length;

  // El mismo producto puede venir en DOS renglones: el que se paga y el
  // bonificado. Si se mandan sueltos, la entrada fija el costo dos veces para
  // el mismo SKU y gana el último — que suele ser el de cero. Se fusionan: la
  // cantidad se suma y el costo es el promedio ponderado, que es exactamente
  // "prorratear las cajas sin cargo para bajar el costo".
  const fusionarPorSku = (xs: any[]) => {
    const porSku = new Map<string, any>();
    for (const i of xs) {
      const cant = numImp(i.cantidad);
      const costo = costoFinal(i);
      const prev = porSku.get(i.sku);
      const gratis = esSinCargo(i) ? cant : 0;
      if (!prev) {
        porSku.set(i.sku, { ...i, cantidad: cant, _costoTotal: cant * costo, _renglones: 1, _gratis: gratis });
      } else {
        prev.cantidad += cant;
        prev._costoTotal += cant * costo;
        prev._renglones += 1;
        prev._gratis += gratis;
      }
    }
    return [...porSku.values()].map((i) => ({
      ...i,
      costoUnitario: i.cantidad > 0 ? Math.round((i._costoTotal / i.cantidad) * 100) / 100 : 0,
    }));
  };
  const itemsFusionados = fusionarPorSku(inclItems.filter((i) => i.sku));
  const skusFusionados = itemsFusionados.filter((i) => i._renglones > 1);
  const costoBloquea = excedeMerc || excedeTotal;

  // Excel/CSV del portal del proveedor → precarga los renglones de la OC
  async function importarPedido(archivo: File) {
    if (!f.proveedorId) { setImportInfo({ conMatch: 0, sinMatch: ['Elegí primero el proveedor'] }); return; }
    setImportando(true);
    setImportInfo(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('proveedorId', f.proveedorId);
      const r = await fetch('/api/importar-oc', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo leer el archivo');
      const matcheados = (d.items ?? []).filter((i: any) => i.match);
      setItems((xs) => {
        const mapa = new Map(xs.map((x: any) => [x.sku, { ...x }]));
        for (const i of matcheados) {
          const ex = mapa.get(i.match.sku);
          if (ex) ex.cantidad += Number(i.cantidad) || 1;
          else mapa.set(i.match.sku, {
            sku: i.match.sku,
            nombre: i.match.nombre,
            cantidad: Number(i.cantidad) || 1,
            costoUnitario: Number(i.precio) || i.match.costoActual || 0,
          });
        }
        return [...mapa.values()];
      });
      setImportInfo({
        conMatch: matcheados.length,
        sinMatch: (d.items ?? []).filter((i: any) => !i.match).map((i: any) => `${i.descripcion} × ${i.cantidad}`),
      });
    } catch (e) {
      setImportInfo({ conMatch: 0, sinMatch: [e instanceof Error ? e.message : 'Error al importar'] });
    }
    setImportando(false);
  }

  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`); if (r.ok) setSug((await r.json()).items ?? []); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  // URL local del documento subido, para el visor lado a lado. Se revoca al
  // cambiar de archivo o desmontar, para no dejar memoria colgada.
  useEffect(() => {
    if (!fotoArchivo) { setFotoUrl(null); return; }
    const url = URL.createObjectURL(fotoArchivo);
    setFotoUrl(url);
    setFotoRot(0);
    setFotoZoom(1);
    return () => URL.revokeObjectURL(url);
  }, [fotoArchivo]);

  // buscador por renglón de la entrada por foto (vincular producto a mano):
  // por nombre, código o PLU. El backend resuelve código de barras exacto y
  // nombre/SKU por texto.
  useEffect(() => {
    if (vinculaIdx == null) return;
    if (vinculaBusca.trim().length < 2) return setVinculaSug([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(vinculaBusca)}`);
      if (r.ok) setVinculaSug((await r.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [vinculaBusca, vinculaIdx]);

  // vincula un producto a un renglón leído (y lo tilda para incluirlo)
  const vincularProducto = (idx: number, p: any) => {
    setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, sku: p.sku, nombre: p.nombre, variacionPct: null, sugerido: false, motivoIa: null, incluir: true } : x));
    setVinculaIdx(null); setVinculaBusca(''); setVinculaSug([]);
  };

  // Alta desde la factura. El renglón que el sistema no reconoce no tiene por
  // qué frenar la carga: se da de alta ahí mismo, con la descripción y el costo
  // que ya se leyeron del papel, y el renglón queda vinculado al producto nuevo.
  // Mandarlos a otra pantalla significaba perder la factura a medio cargar.
  const [altaIdx, setAltaIdx] = useState<number | null>(null);
  const [altaForm, setAltaForm] = useState<any>({ nombre: '', rubro: '', marca: '', codigoBarras: '' });
  const [altaError, setAltaError] = useState('');
  const [creandoProd, setCreandoProd] = useState(false);

  const abrirAlta = (idx: number, i: any) => {
    setAltaIdx(altaIdx === idx ? null : idx);
    setAltaError('');
    setAltaForm({
      nombre: (i.descripcion ?? '').trim(),
      rubro: '',
      marca: '',
      codigoBarras: (i.codigo ?? '').toString().trim(),
    });
    setVinculaIdx(null);
  };

  const crearDesdeFactura = async (idx: number, i: any) => {
    if (creandoProd || !altaForm.nombre.trim()) return;
    setCreandoProd(true);
    setAltaError('');
    try {
      const costo = costoFinal(i);
      const r = await fetch('/api/producto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: altaForm.nombre.trim(),
          rubro: altaForm.rubro.trim() || undefined,
          marca: altaForm.marca.trim() || undefined,
          codigoBarras: altaForm.codigoBarras.trim() || undefined,
          costo: costo > 0 ? costo : undefined,
          // queda atado al proveedor de ESTA factura, con el texto que trae el
          // papel: la próxima factura suya lo reconoce sola
          proveedores: f.proveedorId ? [{ proveedorId: f.proveedorId, codigoProveedor: (i.codigo ?? '') || undefined, costo: costo > 0 ? costo : undefined }] : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setAltaError(d?.message ?? 'No se pudo crear el producto'); return; }
      setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, sku: d.sku, nombre: altaForm.nombre.trim(), variacionPct: null, sugerido: false, motivoIa: null, incluir: true } : x));
      setAltaIdx(null);
    } catch {
      setAltaError('No se pudo crear el producto. Probá de nuevo.');
    } finally {
      setCreandoProd(false);
    }
  };

  // el operador confirma la sugerencia de la IA ("sí, es este") → queda vinculado
  // e incluido; al registrar la entrada se aprende y la próxima vez matchea solo.
  const confirmarSugerencia = (idx: number) =>
    setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, sugerido: false, incluir: true } : x));

  // "no, no es ese" → descarta la sugerencia y abre la búsqueda manual
  const rechazarSugerencia = (idx: number) => {
    setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, sku: '', nombre: null, variacionPct: null, sugerido: false, motivoIa: null, incluir: false } : x));
    setVinculaIdx(idx); setVinculaBusca('');
  };

  // alta de proveedor en el momento: si la IA detectó un proveedor que no está en
  // el sistema, lo damos de alta acá mismo (sin salir de la entrada por foto) con
  // la razón social y el CUIT leídos, y lo dejamos seleccionado.
  const [extraProv, setExtraProv] = useState<any[]>([]);
  const [creandoProv, setCreandoProv] = useState(false);
  const [provAviso, setProvAviso] = useState('');
  const provList = [...proveedores, ...extraProv];
  async function crearProveedorDetectado() {
    const det = foto?.proveedor?.detectado;
    if (!det?.nombre || creandoProv) return;
    setCreandoProv(true);
    setProvAviso('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crearProveedor', razonSocial: det.nombre, cuit: (det.cuit ?? '').toString().replace(/\D/g, '') || undefined }),
      });
      const d = await r.json();
      if (r.ok && d?.id) {
        setExtraProv((xs) => [...xs, { id: d.id, razon_social: d.razon_social ?? det.nombre, cuit: d.cuit ?? det.cuit }]);
        setF((x: any) => ({ ...x, proveedorId: d.id }));
      } else {
        setProvAviso(d?.message ?? 'No se pudo dar de alta el proveedor');
      }
    } catch {
      setProvAviso('No se pudo dar de alta el proveedor');
    } finally {
      setCreandoProv(false);
    }
  }

  // precio de venta calculado = costo final × (1 + remarcación%)
  const precioVenta = (i: any) => redondearPrecio(costoFinal(i) * (1 + (Number(i.margenPct) || 0) / 100));

  // % de remarcación GENERAL de la factura: al ponerlo, cascada a TODOS los
  // renglones (pisa el 50% por defecto). Vacío = cada renglón queda como esté.
  const aplicarRemarcacionGeneral = (v: string) => {
    set('margenPct', v);
    if (v !== '') setFotoItems((xs) => xs.map((x) => ({ ...x, margenPct: Number(v) })));
  };

  const cerrar = () => setModal(null);
  const t = modal.tipo;

  // con el documento a la vista, el modal se ensancha para el layout de dos columnas
  const modalAncho = t === 'entradaFoto' && foto && !foto.error && verOriginal && fotoUrl ? 'max-w-6xl' : 'max-w-lg';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
      <div className={`bg-white rounded-2xl w-full ${modalAncho} p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto`}>
        {t === 'nuevaOC' && (<>
          <h2 className="font-semibold text-black text-lg">Nueva orden de compra</h2>
          <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select className={input + ' bg-white'} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
            <option value="">Sucursal destino…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] text-black/45 block mb-1">Entrega esperada</label><input type="date" value={f.fechaEntrega ?? ''} onChange={(e) => set('fechaEntrega', e.target.value)} className={input} /></div>
            <div><label className="text-[11px] text-black/45 block mb-1">Vence el pago</label><input type="date" value={f.vencimientoPago ?? ''} onChange={(e) => set('vencimientoPago', e.target.value)} className={input} /></div>
          </div>
          <input value={f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición de pago (contado / 30 días / cta cte…)" className={input} />

          {/* pedido armado en el portal del proveedor → Excel/CSV precarga los renglones */}
          <label className={'flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm cursor-pointer ' + (f.proveedorId ? 'border-black/25 text-black/60 hover:border-[#B82D25] hover:text-[#B82D25]' : 'border-black/10 text-black/30')}>
            📄 {importando ? 'Leyendo el archivo…' : 'Importar Excel del pedido (portal del proveedor)'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              className="hidden"
              disabled={!f.proveedorId || importando}
              onChange={(e) => { const a = e.target.files?.[0]; if (a) importarPedido(a); e.target.value = ''; }}
            />
          </label>
          {importInfo && (
            <div className="rounded-lg bg-[#F0EBE2]/70 px-3 py-2 text-xs text-black/70 space-y-1">
              {importInfo.conMatch > 0 && <p className="text-emerald-700 font-medium">✓ {importInfo.conMatch} renglón(es) importados al pedido</p>}
              {importInfo.sinMatch.length > 0 && (
                <>
                  <p className="text-[#932A1F] font-medium">⚠ Sin match en el catálogo ({importInfo.sinMatch.length}) — agregalos a mano:</p>
                  {importInfo.sinMatch.slice(0, 6).map((s, i) => <p key={i} className="truncate">· {s}</p>)}
                  {importInfo.sinMatch.length > 6 && <p>… y {importInfo.sinMatch.length - 6} más</p>}
                </>
              )}
            </div>
          )}

          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar producto…" className={input} />
            {sug.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-48 overflow-y-auto">
              {sug.map((p: any) => <button key={p.sku} onClick={() => { setItems((xs) => [...xs, { sku: p.sku, nombre: p.nombre, cantidad: 1, costoUnitario: p.costo ?? 0 }]); setBusca(''); setSug([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">{p.nombre} <span className="text-xs text-black/40">{p.sku}</span></button>)}
            </div>}
          </div>
          {items.map((i, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{i.nombre}</span>
              <input type="number" value={i.cantidad} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className="w-16 rounded border border-black/15 px-2 py-1 text-right" />
              <input type="number" value={i.costoUnitario} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, costoUnitario: Number(e.target.value) } : x))} className="w-24 rounded border border-black/15 px-2 py-1 text-right" placeholder="costo" />
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/40 hover:text-[#B82D25]">✕</button>
            </div>
          ))}
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <textarea value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" rows={2} className={input} />
          {items.length > 0 && <p className="text-right text-sm font-semibold text-black">Total OC: {pesos(items.reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.costoUnitario || 0), 0))}</p>}
          <p className="text-[11px] text-black/40">La OC queda <b>pendiente de aprobación del dueño</b>.</p>
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'crearOC', proveedorId: f.proveedorId, sucursalId: f.sucursalId, items, fechaEntrega: f.fechaEntrega, condicionPago: f.condicionPago, vencimientoPago: f.vencimientoPago, observaciones: f.observaciones })} okLabel="Crear OC" disabled={!f.proveedorId || !f.sucursalId || !items.length} />
        </>)}

        {t === 'rechazar' && (<>
          <h2 className="font-semibold text-black text-lg">Rechazar OC #{modal.oc.numero}</h2>
          <p className="text-sm text-black/60">{modal.oc.proveedor?.razon_social} · {pesos(modal.oc.total)}. Se cancela la orden y queda registrado el motivo.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" className={input} autoFocus />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'rechazar', id: modal.oc.id, motivo: f.motivo })} okLabel="Rechazar orden" />
        </>)}

        {t === 'rechazarOP' && (<>
          <h2 className="font-semibold text-black text-lg">Rechazar OP #{modal.op.numero}</h2>
          <p className="text-sm text-black/60">{modal.op.proveedor?.razon_social} · {pesos(modal.op.total)}. Las facturas vuelven a quedar pendientes.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" className={input} autoFocus />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'rechazarOP', id: modal.op.id, motivo: f.motivo })} okLabel="Rechazar OP" />
        </>)}

        {t === 'recibir' && (<>
          <h2 className="font-semibold text-black text-lg">Recibir OC #{modal.oc.numero}</h2>
          <p className="text-xs text-black/50">Ingresá lo que llegó de cada ítem. Al recibir se fija el costo de la compra y se calcula el precio de venta con el % de remarcación. Si cargás vencimiento, nace el lote para la vigilancia de vencimientos.</p>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-black/40">
            <span className="flex-1">Producto</span><span className="w-20 text-right">Llegó</span><span className="w-24 text-right">Remarc. %</span><span className="w-36">Vencimiento</span>
          </div>
          {(modal.oc.items ?? []).map((it: any, idx: number) => {
            const pend = Number(it.cantidad) - Number(it.cantidad_recibida ?? 0);
            const sku = it.producto?.sku;
            const info = remarca[sku];
            return (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{it.producto?.nombre} <span className="text-xs text-black/40">(pend. {pend})</span></span>
                <input type="number" value={recibido[sku] ?? ''} onChange={(e) => setRecibido((r) => ({ ...r, [sku]: e.target.value }))} placeholder={String(pend)} className="w-20 rounded border border-black/15 px-2 py-1 text-right" />
                <span className="w-24">
                  <input
                    type="number"
                    value={margenPorSku[sku] ?? ''}
                    onChange={(e) => setMargenPorSku((m) => ({ ...m, [sku]: e.target.value }))}
                    placeholder={info?.margenRubro != null ? String(info.margenRubro) : 'rubro'}
                    title={info?.margenPct != null ? `La última vez se remarcó ${info.margenPct}%` : 'Sin remarcación previa: se usa la del rubro'}
                    className={`w-full rounded border px-2 py-1 text-right ${info?.margenPct != null ? 'border-[#B82D25]/40 bg-[#B82D25]/5' : 'border-black/15'}`}
                  />
                  <AvisoMargen sku={sku} />
                </span>
                <input type="date" title="Vencimiento (opcional)" value={vencs[sku] ?? ''} onChange={(e) => setVencs((v) => ({ ...v, [sku]: e.target.value }))} className="w-36 rounded border border-black/15 px-2 py-1 text-xs" />
              </div>
            );
          })}
          <div className="flex items-center gap-2 text-sm pt-2 mt-1 border-t border-black/10">
            <span className="flex-1 text-black/60">% de remarcación <span className="text-xs text-black/40">(vacío = usa el del rubro)</span></span>
            <input type="number" value={f.margenPct ?? ''} onChange={(e) => set('margenPct', e.target.value)} placeholder="rubro" className="w-20 rounded border border-black/15 px-2 py-1 text-right" />
            <span className="text-black/40 text-xs">%</span>
          </div>
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Registrar recepción" onOk={() => post({ accion: 'recibir', id: modal.oc.id, margenPct: f.margenPct ? Number(f.margenPct) : undefined, items: (modal.oc.items ?? []).map((it: any) => ({ sku: it.producto?.sku, cantidad: Number(recibido[it.producto?.sku] ?? (Number(it.cantidad) - Number(it.cantidad_recibida ?? 0))), vencimiento: vencs[it.producto?.sku] || undefined, margenPct: margenPorSku[it.producto?.sku] ? Number(margenPorSku[it.producto?.sku]) : undefined, fijarMargen: !!fijarSku[it.producto?.sku] })).filter((x: any) => x.cantidad > 0) })} />
        </>)}

        {t === 'entradaDirecta' && (<>
          <h2 className="font-semibold text-black text-lg">Entrada directa de mercadería</h2>
          <p className="text-xs text-black/50">Llegó mercadería <b>sin orden de compra previa</b> (reparto, compra de oportunidad). Genera la OC retroactiva con su remito, suma stock, fija costo y recalcula el precio de venta — todo trazable.</p>
          <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select className={input + ' bg-white'} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
              <option value="">Sucursal…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <input value={f.numeroRemito ?? ''} onChange={(e) => set('numeroRemito', e.target.value)} placeholder="N° de remito del proveedor" className={input} />
          </div>
          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar producto…" className={input} />
            {sug.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-48 overflow-y-auto">
              {sug.map((p: any) => <button key={p.sku} onClick={() => { setItems((xs) => [...xs, { sku: p.sku, nombre: p.nombre, cantidad: 1, costo: p.costo ?? 0, vencimiento: '' }]); setBusca(''); setSug([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">{p.nombre} <span className="text-xs text-black/40">{p.sku}</span></button>)}
            </div>}
          </div>
          {items.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-black/40 pr-6">
              <span className="flex-1">Producto</span><span className="w-16 text-right">Cant.</span><span className="w-24 text-right">Costo $</span><span className="w-24 text-right">Remarc. %</span><span className="w-36">Vencimiento</span>
            </div>
          )}
          {items.map((i, idx) => {
            const info = remarca[i.sku];
            const margen = margenPorSku[i.sku] !== undefined ? margenPorSku[i.sku] : '';
            const venta = Number(i.costo) > 0 && margen !== '' ? redondearPrecio(Number(i.costo) * (1 + Number(margen) / 100)) : null;
            return (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  {i.nombre}
                  {venta != null && <span className="ml-2 text-xs text-black/40">vende {pesos(venta)}</span>}
                </span>
                <input type="number" value={i.cantidad} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className="w-16 rounded border border-black/15 px-2 py-1 text-right" />
                <input type="number" value={i.costo} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, costo: Number(e.target.value) } : x))} className="w-24 rounded border border-black/15 px-2 py-1 text-right" placeholder="costo" />
                <span className="w-24">
                  <input
                    type="number"
                    value={margen}
                    onChange={(e) => setMargenPorSku((m) => ({ ...m, [i.sku]: e.target.value }))}
                    placeholder={info?.margenRubro != null ? String(info.margenRubro) : 'rubro'}
                    title={info?.margenPct != null ? `La última vez se remarcó ${info.margenPct}%` : 'Sin remarcación previa: se usa la del rubro'}
                    className={`w-full rounded border px-2 py-1 text-right ${info?.margenPct != null ? 'border-[#B82D25]/40 bg-[#B82D25]/5' : 'border-black/15'}`}
                  />
                  <AvisoMargen sku={i.sku} />
                </span>
                <input type="date" value={i.vencimiento ?? ''} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, vencimiento: e.target.value } : x))} className="w-36 rounded border border-black/15 px-2 py-1 text-xs" />
                <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/40 hover:text-[#B82D25]">✕</button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 text-sm pt-2 mt-1 border-t border-black/10">
            <span className="flex-1 text-black/60">% de remarcación <span className="text-xs text-black/40">(vacío = usa el del rubro)</span></span>
            <input type="number" value={f.margenPct ?? ''} onChange={(e) => set('margenPct', e.target.value)} placeholder="rubro" className="w-20 rounded border border-black/15 px-2 py-1 text-right" />
            <span className="text-black/40 text-xs">%</span>
          </div>
          {items.length > 0 && <p className="text-right text-sm font-semibold text-black">Total entrada: {pesos(items.reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.costo || 0), 0))}</p>}
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Registrar entrada" disabled={!f.proveedorId || !f.sucursalId || !items.length} onOk={() => post({ accion: 'entradaDirecta', proveedorId: f.proveedorId, sucursalId: f.sucursalId, numeroRemito: f.numeroRemito, margenPct: f.margenPct ? Number(f.margenPct) : undefined, items: items.map((i: any) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: Number(i.costo) || 0, vencimiento: i.vencimiento || undefined, margenPct: margenPorSku[i.sku] ? Number(margenPorSku[i.sku]) : undefined, fijarMargen: !!fijarSku[i.sku] })) })} />
        </>)}

        {t === 'entradaFoto' && (<>
          <h2 className="font-semibold text-black text-lg">📷 Entrada por foto</h2>
          {!foto ? (
            <>
              <p className="text-xs text-black/50">Sacale una foto a la factura o remito que llegó con la mercadería (o subí el PDF, hasta 32MB). La IA (Sonnet 5) lee proveedor, renglones e impuestos y, si algo no se entiende, te lo pregunta para que se lo aclares. Vos revisás y confirmás: la entrada suma stock, fija costo/precio y registra la factura con su desglose fiscal.</p>
              <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/20 px-4 py-10 text-sm text-black/60 cursor-pointer hover:border-[#B82D25] hover:text-[#B82D25]">
                <span className="text-3xl">📷</span>
                {leyendoFoto ? 'Leyendo el comprobante…' : 'Tocar para sacar foto o elegir archivo'}
                <input type="file" accept="image/*,.pdf" capture="environment" className="hidden" disabled={leyendoFoto}
                  onChange={(e) => { const a = e.target.files?.[0]; if (a) leerFoto(a); e.target.value = ''; }} />
              </label>
              <Acciones cerrar={cerrar} okLabel="—" disabled onOk={() => {}} />
            </>
          ) : foto.error ? (
            <>
              <p className="rounded-lg bg-[#B82D25]/10 px-3 py-2 text-sm text-[#932A1F]">{foto.error}</p>
              <Acciones cerrar={cerrar} okLabel="Reintentar" onOk={() => setFoto(null)} />
            </>
          ) : (
            <div className={verOriginal && fotoUrl ? 'grid md:grid-cols-[minmax(0,380px)_1fr] gap-4 items-start' : ''}>
              {/* documento original, para comparar contra lo que leyó la IA */}
              {verOriginal && fotoUrl && (
                <div className="md:sticky md:top-0 rounded-xl border border-black/10 bg-[#F0EBE2]/30 overflow-hidden">
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-black/10 bg-white/70">
                    <span className="text-[11px] font-medium text-black/60">Documento original</span>
                    <div className="flex items-center gap-1">
                      {fotoArchivo?.type !== 'application/pdf' && (<>
                        <button type="button" onClick={() => setFotoZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))} title="Alejar" className="h-6 w-6 rounded text-black/60 hover:bg-black/5 text-sm">−</button>
                        <button type="button" onClick={() => setFotoZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} title="Acercar" className="h-6 w-6 rounded text-black/60 hover:bg-black/5 text-sm">+</button>
                        <button type="button" onClick={() => setFotoRot((r) => (r + 90) % 360)} title="Rotar" className="h-6 w-6 rounded text-black/60 hover:bg-black/5 text-sm">⟳</button>
                        {(fotoZoom !== 1 || fotoRot !== 0) && (
                          <button type="button" onClick={() => { setFotoZoom(1); setFotoRot(0); }} title="Restablecer" className="h-6 px-1.5 rounded text-black/60 hover:bg-black/5 text-[10px]">reset</button>
                        )}
                      </>)}
                      <button type="button" onClick={() => setVerOriginal(false)} title="Ocultar" className="h-6 w-6 rounded text-black/60 hover:bg-black/5 text-sm">✕</button>
                    </div>
                  </div>
                  {fotoArchivo?.type === 'application/pdf' ? (
                    <iframe src={fotoUrl} title="Documento original" className="w-full h-[70vh] bg-white" />
                  ) : (
                    <div className="h-[70vh] overflow-auto bg-[#111] flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fotoUrl}
                        alt="Documento original"
                        className="max-w-none transition-transform"
                        style={{ transform: `rotate(${fotoRot}deg) scale(${fotoZoom})` }}
                      />
                    </div>
                  )}
                </div>
              )}
              {!verOriginal && fotoUrl && (
                <button type="button" onClick={() => setVerOriginal(true)} className="text-xs text-black/50 underline hover:text-[#B82D25]">
                  📄 Mostrar el documento original para comparar
                </button>
              )}
              <div className="space-y-3">
              {/* encabezado detectado */}
              <div className="rounded-lg bg-[#F0EBE2]/70 px-3 py-2 text-xs text-black/70">
                <p><b>{foto.comprobante?.tipo?.replace('_', ' ').toUpperCase() ?? 'COMPROBANTE'}</b> {foto.comprobante?.numero ?? ''} · {foto.comprobante?.fecha ?? 's/f'} {foto.comprobante?.condicionVenta ? `· ${foto.comprobante.condicionVenta}` : ''}</p>
                <p>{foto.proveedor?.detectado?.nombre ?? 'Proveedor no detectado'} {foto.proveedor?.detectado?.cuit ? `· CUIT ${foto.proveedor.detectado.cuit}` : ''} {foto.proveedor?.match ? '· ✓ en el sistema' : '· ⚠ no está en el sistema'}</p>
              </div>

              {/* La IA pregunta lo que no entendió; aclarás y vuelve a leer teniéndolo en cuenta */}
              <div className={'rounded-lg px-3 py-2.5 space-y-2 border ' + (foto.dudas?.length ? 'border-amber-300 bg-amber-50' : 'border-black/10 bg-[#F0EBE2]/40')}>
                {foto.dudas?.length ? (
                  <>
                    <p className="text-xs font-semibold text-amber-900">🤔 La IA tiene {foto.dudas.length === 1 ? 'una duda' : `${foto.dudas.length} dudas`} — mirá el papel y aclarale:</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-amber-900">
                      {foto.dudas.map((d: any, i: number) => (
                        <li key={i}>{d.referencia ? <b>{d.referencia}: </b> : null}{d.pregunta}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-black/55">✓ La IA no tuvo dudas. Si ves algo mal, aclarale y volvé a leer.</p>
                )}
                <textarea value={aclaraciones} onChange={(e) => setAclaraciones(e.target.value)} rows={2}
                  placeholder="Aclaraciones para la IA (ej: el renglón 3 dice 72, no 12; la percepción de IIBB es 4.850)…"
                  className="w-full rounded border border-black/15 bg-white px-2 py-1.5 text-sm text-black outline-none focus:border-[#B82D25]" />
                <button onClick={reLeerConAclaraciones} disabled={leyendoFoto || !aclaraciones.trim()}
                  className="rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#B82D25] disabled:opacity-40">
                  {leyendoFoto ? 'Releyendo…' : '↺ Volver a leer con mis aclaraciones'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
                  <option value="">Proveedor…</option>{provList.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                </select>
                <select className={input + ' bg-white'} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
                  <option value="">Sucursal…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>

              {/* proveedor detectado pero no está en el sistema: alta en el momento */}
              {!f.proveedorId && foto.proveedor?.detectado?.nombre && !foto.proveedor?.match && (
                <button
                  onClick={crearProveedorDetectado}
                  disabled={creandoProv}
                  className="self-start rounded-full border border-[#B82D25] bg-[#B82D25]/5 px-4 py-1.5 text-xs font-semibold text-[#932A1F] hover:bg-[#B82D25]/10 disabled:opacity-50"
                >
                  {creandoProv ? 'Dando de alta…' : `+ Dar de alta "${foto.proveedor.detectado.nombre}"${foto.proveedor.detectado.cuit ? ` · CUIT ${foto.proveedor.detectado.cuit}` : ''}`}
                </button>
              )}
              {provAviso && <p className="text-xs text-[#B82D25]">{provAviso}</p>}

              {/* renglones: cada uno editable — vincular producto, cantidad, remarcación y precio */}
              <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wide text-black/40 px-1">
                <span className="w-5" /><span className="flex-1">Renglón leído → producto</span>
                <span className="w-12 text-right">Cant.</span><span className="w-20 text-right">Costo</span>
                <span className="w-16 text-right">Remar. %</span><span className="w-20 text-right">P. venta</span>
              </div>
              {itemsCalc.map((i: any, idx: number) => (
                <div key={idx} className={'rounded-lg px-2 py-2 ' + (i.sugerido ? 'bg-amber-50 border border-amber-300' : i.incluir ? 'bg-white border border-black/[0.06]' : 'bg-[#F0EBE2]/40')}>
                  {i._esDescuento ? (
                    <div className={'flex items-start gap-2' + (i.noAplicar ? ' opacity-70' : '')}>
                      <span className="shrink-0 text-sm">🏷️</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-black/70">{i.descripcion}</span>
                        <span className="block text-[11px] text-black/50">
                          No es mercadería: es una rebaja de <b>{pesos(Math.abs(numImp(i.cantidad) * numImp(i.precio)))}</b>. No suma stock ni se vincula a ningún producto.
                          {i.noAplicar
                            ? <span className="mt-0.5 block font-medium text-sky-900">
                                ✋ No se aplica: la mercadería queda a <b>precio de lista</b>. La plata igual está pagada, así que se reparte en el costo general de la factura.
                                <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: false } : x))} className="ml-2 text-black/45 underline hover:text-[#B82D25]">aplicar de nuevo</button>
                              </span>
                            : sinAtribuir.some((x) => x.descripcion === i.descripcion)
                            ? <span className="mt-0.5 block font-medium text-[#932A1F]">
                                ⚠ No se pudo saber a qué renglón corresponde{numImp(i.descuentoPct) > 0 ? ` (dice ${numImp(i.descuentoPct)}%, y no cierra con ningún renglón)` : ''},
                                así que NO se descontó de ningún costo. Si es una promoción de toda la factura, cargala en “Desc. del pie”.
                              </span>
                            : grupoDeDescuento.has(idx)
                            ? <span className="mt-0.5 block font-medium text-emerald-800">
                                ✓ Repartido entre los {grupoDeDescuento.get(idx)!.n} renglones de arriba{grupoDeDescuento.get(idx)!.pct ? ` (${grupoDeDescuento.get(idx)!.pct}%)` : ''}, proporcional a cada uno. Baja el costo de todos ellos.
                                <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: true } : x))} className="ml-2 rounded-full border border-black/20 px-2.5 py-0.5 text-[11px] text-black/70 hover:border-[#B82D25] hover:text-[#B82D25]">No aplicar</button>
                              </span>
                            : <> Se descuenta del renglón que nombra.
                                <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: true } : x))} className="ml-2 rounded-full border border-black/20 px-2.5 py-0.5 text-[11px] text-black/70 hover:border-[#B82D25] hover:text-[#B82D25]">No aplicar — dejar a precio de lista</button>
                              </>}
                        </span>
                      </span>
                    </div>
                  ) : (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={i.incluir} disabled={i.sugerido} onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, incluir: e.target.checked } : x))} className="accent-[#B82D25] shrink-0 disabled:opacity-40" />
                    <span className="flex-1 min-w-0">
                      {/* el texto leído SIEMPRE legible, haya o no match */}
                      <span className="block truncate text-sm text-black font-medium">{i.descripcion}</span>
                      {/* Bulto detectado en el renglón: se avisa SIEMPRE, esté
                          vinculado o no, porque el error se paga en el stock y
                          en el precio de venta a la vez. */}
                      {numImp(i._descuento) < 0 && (
                        <span className="mt-0.5 block rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
                          {descuentoDesmedido(i) ? (
                            <>⚠️ El descuento aplicado ({pesos(Math.abs(numImp(i._descuento)))}) es más grande que este renglón
                            ({pesos(Math.abs(baseUnitaria(i) * (numImp(i.cantidad) || 1)))}). No se aplicó: esa rebaja debe corresponder a varios
                            renglones o a toda la factura. Revisalo antes de registrar.</>
                          ) : (
                            <>🏷️ Con el descuento aplicado: {pesos(baseUnitaria(i))} − {pesos(Math.abs(numImp(i._descuento)) / (numImp(i.cantidad) || 1))} = <b>{pesos(precioEfectivo(i))}</b> por {numImp(i.unidadesPorBulto) > 1 ? 'bulto' : 'unidad'}.</>
                          )}
                        </span>
                      )}
                      {precioSegunImporte(i) != null && (
                        <span className="mt-0.5 block rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                          🔎 <b>La cuenta de este renglón no cierra.</b> {numImp(i.cantidad)} × {pesos(numImp(i.precio))} = {pesos(numImp(i.cantidad) * numImp(i.precio))},
                          pero el importe impreso es {pesos(Math.abs(numImp(i.importe)))}. Según ese importe el unitario sería <b>{pesos(precioSegunImporte(i)!)}</b>.
                          {' '}Suele pasar cuando se leyó un número de la fila de al lado: mirá el papel y corregí el que corresponda.
                          <button
                            onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, precio: precioSegunImporte(i)! } : x))}
                            className="ml-2 rounded-full bg-amber-700 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-800">
                            Usar {pesos(precioSegunImporte(i)!)}
                          </button>
                        </span>
                      )}
                      {esSinCargo(i) ? (
                        <span className="mt-0.5 block text-[11px] text-emerald-800">
                          🎁 <b>Sin cargo</b>: entran {numImp(i.cantidad)} que no se pagan. Se reparten entre las que sí se pagaron, y baja el costo de todas.
                        </span>
                      ) : numImp(i.bonificacionPct) > 0 ? (
                        <span className="mt-0.5 block text-[11px] text-emerald-800">
                          🎁 Bonificado {numImp(i.bonificacionPct)}%: se paga {pesos(precioEfectivo(i))} de los {pesos(numImp(i.precio))} de lista.
                        </span>
                      ) : null}
                      {numImp(i.unidadesPorBulto) > 1 && (
                        <span className="mt-0.5 block rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
                          📦 Viene por bulto de <b>{Math.round(numImp(i.unidadesPorBulto))}</b>: {numImp(i.cantidad)} bulto(s) a {pesos(numImp(i.precio))}
                          {' '}= <b>{numImp(i.cantidad) * Math.round(numImp(i.unidadesPorBulto))}</b> unidades a{' '}
                          <b>{pesos(numImp(i.precio) / Math.round(numImp(i.unidadesPorBulto)))}</b> c/u.
                          <button onClick={() => pasarAUnidad(idx)} className="ml-2 rounded-full bg-sky-700 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-800">
                            Pasar a unidad
                          </button>
                          <span className="mt-0.5 block text-sky-800/70">Dejalo como está solo si el producto vinculado es el bulto entero.</span>
                        </span>
                      )}
                      {numImp(i.bultoAplicado) > 1 && (
                        <span className="mt-0.5 block text-[11px] text-sky-800">
                          📦 Convertido: bulto de {Math.round(numImp(i.bultoAplicado))} → unidades.
                          <button onClick={() => volverABulto(idx)} className="ml-2 text-black/45 underline hover:text-[#B82D25]">deshacer</button>
                        </span>
                      )}
                      {medidaVariable(i) && (
                        <span className="mt-0.5 block rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
                          ⚖️ Se factura por <b>peso</b>: el importe del renglón ({pesos(Math.abs(numImp(i.importe)))}) a {pesos(numImp(i.precio))} por kilo da <b>{pesoDelImporte(i).toFixed(3).replace('.', ',')} kg</b>, pero está entrando como {numImp(i.cantidad)} unidad(es) — por eso el costo sale {pesos(costoFinal(i))} en vez de ~{pesos(numImp(i.precio))} el kilo.
                          <button onClick={() => pasarAPeso(idx)} className="ml-2 rounded-full bg-sky-700 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-800">Pasar a kilos</button>
                          <span className="mt-0.5 block text-sky-800/70">Dejalo como está solo si el producto en stock es la horma entera, no el kilo.</span>
                        </span>
                      )}
                      {i.porPeso && numImp(i.cantidad) > 0 && !medidaVariable(i) && (
                        <span className="mt-0.5 block text-[11px] text-sky-800">
                          ⚖️ Por peso: {numImp(i.cantidad).toLocaleString('es-AR')} kg a {pesos(numImp(i.precio))} el kilo.
                          <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: 1, porPeso: false } : x))} className="ml-2 text-black/45 underline hover:text-[#B82D25]">deshacer</button>
                        </span>
                      )}
                      {i.sugerido && i.nombre ? (
                        <span className="block text-xs text-amber-900">
                          💡 La IA cree que es <b>{i.nombre}</b>{i.motivoIa ? ` — ${i.motivoIa}` : ''}. ¿Es este?
                          <span className="mt-1 flex gap-2">
                            <button onClick={() => confirmarSugerencia(idx)} className="rounded-full bg-emerald-600 px-3 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700">Sí, es este</button>
                            <button onClick={() => rechazarSugerencia(idx)} className="rounded-full border border-black/20 px-3 py-0.5 text-[11px] text-black/70 hover:border-[#B82D25] hover:text-[#B82D25]">No, buscar otro</button>
                          </span>
                        </span>
                      ) : i.nombre ? (
                        <span className="block text-xs truncate text-emerald-700">
                          → {i.nombre}{i.variacionPct != null ? ` (costo ${i.variacionPct > 0 ? '+' : ''}${i.variacionPct}%)` : ''}
                          <button onClick={() => setVinculaIdx(idx)} className="ml-2 text-black/40 underline hover:text-[#B82D25]">cambiar</button>
                        </span>
                      ) : (
                        <span className="block text-xs">
                          {i.avisoMedida ? (
                            <>
                              <span className="block text-[#932A1F]">
                                → medida distinta: {i.avisoMedida}. Es otro producto.
                              </span>
                              <button onClick={() => abrirAlta(idx, i)} className="font-medium text-[#B82D25] underline hover:text-[#932A1F]">
                                Darlo de alta como producto nuevo
                              </button>
                              <button onClick={() => setVinculaIdx(vinculaIdx === idx ? null : idx)} className="ml-2 text-black/45 underline">
                                o buscarlo a mano
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setVinculaIdx(vinculaIdx === idx ? null : idx)} className="text-[#932A1F] underline hover:text-[#B82D25]">
                                → sin producto: tocá para vincularlo
                              </button>
                              <button onClick={() => abrirAlta(idx, i)} className="ml-2 text-[#B82D25] underline hover:text-[#932A1F]">
                                o darlo de alta
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                    <input type="number" step="any" min="0" value={i.cantidad} onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className="w-14 rounded border border-black/15 px-1 py-1 text-right text-sm text-black" />
                    <span className="w-20 text-right text-sm tabular-nums text-black/70">
                      {pesos(costoFinal(i))}
                      {Math.abs(costoFinal(i) - numImp(i.precio)) > 0.5 && <span className="block text-[9px] leading-tight text-black/35">leído {pesos(i.precio)}</span>}
                    </span>
                    <span className="w-16">
                      <input type="number" value={i.margenPct} placeholder="rubro" onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, margenPct: e.target.value === '' ? '' : Number(e.target.value) } : x))} className="w-full rounded border border-black/15 px-1 py-1 text-right text-sm text-black" title="Remarcación % (vacío = usa la del rubro)" />
                      <AvisoMargen
                        sku={i.sku}
                        habitualExterno={i.match?.margenPct ?? null}
                        valor={i.margenPct}
                        poner={(v) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, margenPct: v === '' ? '' : Number(v) } : x))}
                      />
                    </span>
                    <span className="w-20 text-right text-sm font-semibold tabular-nums text-black">{i.margenPct === '' || i.margenPct == null ? <span className="text-black/40 font-normal text-xs">s/ rubro</span> : pesos(precioVenta(i))}</span>
                  </div>
                  )}

                  {/* buscador para vincular el producto a este renglón */}
                  {!i._esDescuento && vinculaIdx === idx && (
                    <div className="relative mt-2 ml-6">
                      <input autoFocus value={vinculaBusca} onChange={(e) => setVinculaBusca(e.target.value)} placeholder="Buscar por nombre, código o PLU…" className={input + ' w-full'} />
                      {vinculaSug.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-60 overflow-y-auto">
                          {vinculaSug.map((p: any) => (
                            <button key={p.sku} onClick={() => vincularProducto(idx, p)} className="w-full text-left px-3 py-2 hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-black truncate">{p.nombre}{p.marca ? <span className="text-black/40"> · {p.marca}</span> : null}</span>
                                {p.precio != null && <span className="shrink-0 text-xs font-medium text-emerald-700">{pesos(p.precio)}</span>}
                              </div>
                              <div className="text-[10px] text-black/40">{p.sku}{p.categoria ? ` · ${p.categoria}` : ''}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* alta ahí mismo: el producto no existe todavía en el catálogo */}
                  {altaIdx === idx && (
                    <div className="mt-2 ml-6 rounded-lg border border-[#B82D25]/30 bg-[#B82D25]/5 p-3 space-y-2">
                      <p className="text-xs font-semibold text-black">Dar de alta este producto</p>
                      <p className="text-[11px] text-black/50 -mt-1">
                        Queda creado y vinculado a este renglón. El costo sale de la factura ({pesos(costoFinal(i))}) y se guarda contra este proveedor, así la próxima factura lo reconoce sola.
                      </p>
                      <input autoFocus value={altaForm.nombre} onChange={(e) => setAltaForm((x: any) => ({ ...x, nombre: e.target.value }))} placeholder="Nombre del producto" className={input} />
                      <div className="grid grid-cols-3 gap-2">
                        <input value={altaForm.rubro} onChange={(e) => setAltaForm((x: any) => ({ ...x, rubro: e.target.value }))} placeholder="Rubro" list="rubros-alta" className={input} />
                        <datalist id="rubros-alta">{categorias.map((c: any) => <option key={c.id} value={c.nombre} />)}</datalist>
                        <input value={altaForm.marca} onChange={(e) => setAltaForm((x: any) => ({ ...x, marca: e.target.value }))} placeholder="Marca" className={input} />
                        <input value={altaForm.codigoBarras} onChange={(e) => setAltaForm((x: any) => ({ ...x, codigoBarras: e.target.value }))} placeholder="Código de barras" className={input + ' font-mono'} />
                      </div>
                      {altaError && <p className="text-xs text-[#B82D25]">{altaError}</p>}
                      <div className="flex items-center justify-between">
                        <a href="/productos/nuevo" target="_blank" rel="noreferrer" className="text-[11px] text-black/45 underline">
                          Cargar la ficha completa (se abre aparte)
                        </a>
                        <span className="flex gap-2">
                          <button onClick={() => setAltaIdx(null)} className="text-xs text-black/50 px-2">Cancelar</button>
                          <button
                            onClick={() => crearDesdeFactura(idx, i)}
                            disabled={creandoProd || !altaForm.nombre.trim()}
                            className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-4 py-1.5 disabled:opacity-50"
                          >
                            {creandoProd ? 'Creando…' : 'Crear y vincular'}
                          </button>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {fotoItems.some((i) => i.incluir && !i.sku) && (
                <p className="text-xs text-[#932A1F]">Hay renglones tildados sin producto asignado: vinculalos o destildalos.</p>
              )}
              {fotoItems.some((i) => i.sugerido) && (
                <p className="text-xs text-amber-800">💡 La IA sugirió {fotoItems.filter((i) => i.sugerido).length} vínculo(s): confirmá “¿es este?” en los renglones amarillos para incluirlos.</p>
              )}
              <p className="text-[11px] text-black/45">Al confirmar, cada vínculo y su remarcación quedan guardados: la próxima compra de este proveedor los toma solos.</p>

              {/* impuestos del pie (editables). Percepciones = pago a cuenta, NO costo. */}
              <div className="rounded-lg border border-black/10 p-2 grid grid-cols-4 gap-2 text-xs">
                {[['neto', 'Neto'], ['iva', 'IVA $'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['descuentoGlobal', 'Desc. del pie'], ['otros', 'Otros'], ['total', 'TOTAL']].map(([k, l]) => (
                  <label key={k} className="flex flex-col gap-0.5">
                    <span className="text-black/60 font-medium">{l}{k === 'iva' && alicEfectiva != null ? ` (${(alicEfectiva * 100).toFixed(1).replace('.', ',')}%)` : ''}</span>
                    <input type="number" value={fotoImp?.[k] ?? ''} onChange={(e) => setFotoImp((x: any) => ({ ...x, [k]: e.target.value === '' ? null : Number(e.target.value) }))} className="rounded border border-black/15 bg-white px-2 py-1 text-right text-sm text-black" />
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-black/45">
                El costo a stock prorratea el pie de la factura sobre los renglones leídos. Los impuestos internos <b>siempre</b> son costo.
                Las percepciones (IVA e IIBB) son pago a cuenta de impuestos propios: solo dejan de ser costo si después se usan contra
                ese impuesto. Si se acumulan sin consumir, es plata que salió y no vuelve.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-black items-center">
                {/* Con datos fiscales el costo se reconcilia solo (prorrateo); el checkbox
                    "Sumar IVA" queda solo para remitos sin pie. */}
                {!hayDatosFiscales && foto.comprobante?.tipo === 'factura_a' && (
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sumarIva} onChange={(e) => setSumarIva(e.target.checked)} className="accent-[#B82D25]" /> Sumar IVA al costo (precios netos)</label>
                )}
                {hayDatosFiscales && (
                  <label className="flex items-center gap-1.5" title="Percepciones de IVA e IIBB adentro del costo">
                    <input type="checkbox" checked={percepcionesAlCosto} onChange={(e) => setPercepcionesAlCosto(e.target.checked)} className="accent-[#B82D25]" />
                    Percepciones al costo{percepciones > 0 ? ` (${pesos(percepciones)})` : ''}
                  </label>
                )}
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={pagada} onChange={(e) => setPagada(e.target.checked)} className="accent-[#B82D25]" /> Pagada (contado)</label>
                <label className="flex items-center gap-1.5" title="Se aplica a todos los renglones de la factura">% remarcación general <input type="number" value={f.margenPct ?? ''} onChange={(e) => aplicarRemarcacionGeneral(e.target.value)} placeholder="a todos" className="w-16 rounded border border-black/15 px-1.5 py-0.5 text-right text-black" /></label>
              </div>

              {/* Reconciliación del costo vs la mercadería de la factura */}
              <div className={'rounded-lg px-3 py-2 text-xs ' + (excedeMerc || excedeTotal ? 'bg-[#B82D25]/10 border border-[#B82D25] text-[#932A1F]' : subCosteo ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-[#F0EBE2]/50 text-black/70')}>
                <p>Costo a stock (renglones tildados): <b>{pesos(sumaCostos)}</b>{valorConIva != null && <> · Mercadería c/IVA: <b>{pesos(valorConIva)}</b></>}{totalDoc != null && <> · Total factura: <b>{pesos(totalDoc)}</b></>}</p>
                {/* De dónde sale el costo de cada renglón, escrito. Sin esto, la
                    única forma de saber si falta un impuesto es sacar la cuenta
                    a mano y desconfiar del sistema. */}
                {hayDatosFiscales && sumaRenglones > 0 && (
                  <p className="mt-1 text-black/60">
                    Cada renglón leído <b>× {factorRecon.toFixed(4).replace('.', ',')}</b> — de{' '}
                    {pesos(sumaRenglones)} leídos a {pesos(baseCosto!)}: neto {pesos(netoDoc ?? 0)} + IVA {pesos(ivaDoc ?? 0)}
                    {impIntDoc > 0 ? ` + internos ${pesos(impIntDoc)}` : ''}
                    {descuentoGlobalDoc > 0 ? ` − descuento del pie ${pesos(descuentoGlobalDoc)}` : ''}
                    {percepcionesAlCosto && percepciones > 0 ? ` + percepciones ${pesos(percepciones)}` : ''}
                    {!percepcionesAlCosto && percepciones > 0 ? ` (quedan afuera ${pesos(percepciones)} de percepciones)` : ''}.
                  </p>
                )}
                {(excedeMerc || excedeTotal) && (
                  <p className="mt-1 font-semibold">⚠ El costo a stock supera el valor de la mercadería con IVA de la factura. Los precios ya incluyen impuestos: revisá el neto/IVA del pie. (No se puede registrar hasta corregirlo.)</p>
                )}
                {skusFusionados.length > 0 && (
                  <div className="mt-1 rounded bg-emerald-50 px-2 py-1.5 text-emerald-900">
                    <p>🎁 <b>{skusFusionados.length}</b> producto(s) vienen en más de un renglón. Entran una sola vez y lo que no se paga se reparte entre todo lo que llegó:</p>
                    {skusFusionados.map((i) => (
                      <p key={i.sku} className="mt-0.5">
                        · {i.nombre ?? i.descripcion}:{' '}
                        {i._gratis > 0
                          ? <><b>{i.cantidad - i._gratis}</b> pagadas + <b>{i._gratis}</b> sin cargo = <b>{i.cantidad}</b> a <b>{pesos(i.costoUnitario)}</b> c/u</>
                          : <><b>{i.cantidad}</b> en total a <b>{pesos(i.costoUnitario)}</b> c/u</>}
                        <span className="text-emerald-800/70"> ({i._renglones} renglones)</span>
                      </p>
                    ))}
                  </div>
                )}
                {sinAtribuir.length > 0 && (
                  <p className="mt-1 rounded bg-[#B82D25]/10 px-2 py-1.5 font-medium text-[#932A1F]">
                    ⚠ Hay <b>{sinAtribuir.length}</b> rebaja(s) por <b>{pesos(sinAtribuir.reduce((a, x) => a + x.importe, 0))}</b> que no se pudo saber
                    a qué renglón corresponden, así que no se aplicaron a ningún costo. Si son promociones de toda la factura, cargalas en
                    “Desc. del pie” y se reparten entre todos los renglones.
                  </p>
                )}
                {descuentosDesmedidos > 0 && (
                  <p className="mt-1 rounded bg-[#B82D25]/10 px-2 py-1.5 font-medium text-[#932A1F]">
                    ⚠ <b>{descuentosDesmedidos}</b> renglón/es tienen un descuento más grande que el renglón mismo, así que no se aplicó.
                    Suele pasar cuando la rebaja cubre varios renglones o toda la factura y no uno solo. Revisá a qué corresponde antes de registrar:
                    si se aplicara entero a un renglón, ese producto entraría con el costo por el piso.
                  </p>
                )}
                {bultosSinResolver > 0 && (
                  <p className="mt-1 rounded bg-sky-50 px-2 py-1.5 text-sky-900">
                    📦 <b>{bultosSinResolver}</b> renglón/es vienen por bulto y todavía entran como bulto. Si el producto vinculado es la unidad suelta,
                    tocá “Pasar a unidad” en cada uno: si no, el stock y el costo unitario quedan mal por el factor del pack.
                  </p>
                )}
                {columnaSospechosa && (
                  <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-amber-900">
                    ⚠ Los renglones leídos suman <b>{pesos(sumaRenglones)}</b> y el pie espera <b>{pesos(netoEsperado ?? 0)}</b>
                    {descuentoGlobalDoc > 0 ? ` (neto ${pesos(netoDoc ?? 0)} + descuento del pie ${pesos(descuentoGlobalDoc)})` : ''}
                    {' '}({desvioRenglones! > 0 ? '+' : ''}{(desvioRenglones! * 100).toFixed(1).replace('.', ',')}%).
                    Si tendrían que coincidir, la IA leyó la columna equivocada (la de con IVA, o el total del renglón en vez del precio unitario).
                    Corregilo antes de registrar: el costo de todos los renglones sale de esa proporción.
                  </p>
                )}
                {subCosteo && !excedeMerc && !excedeTotal && (
                  <p className="mt-1">El costo quedó por debajo de lo esperado para los renglones tildados; revisá que no falte ninguno.</p>
                )}
                {!hayDatosFiscales && (
                  <p className="mt-1 text-black/50">Sin datos fiscales para verificar el costo: se toma el precio leído {sumarIva ? '+ IVA' : 'tal cual'}.</p>
                )}
              </div>

              {foto.notasManuscritas && <p className="text-xs text-black/50 italic">✍ Nota manuscrita: {foto.notasManuscritas}</p>}

              {/* la mercadería ya entró por Recepción → solo factura + conciliación */}
              {foto.comprobante?.tipo?.startsWith('factura') && (
                <label className="flex items-center gap-1.5 text-xs text-black">
                  <input type="checkbox" checked={soloFactura} onChange={(e) => setSoloFactura(e.target.checked)} className="accent-[#B82D25]" />
                  La mercadería ya fue recibida con la pistola — solo cargar la factura (va a Conciliación, no mueve stock)
                </label>
              )}

              {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
              {soloFactura ? (
                <Acciones
                  cerrar={cerrar}
                  okLabel="Registrar factura para conciliar"
                  disabled={!f.proveedorId || !(fotoImp?.total > 0)}
                  onOk={() => post({
                    accion: 'factura',
                    proveedorId: f.proveedorId,
                    sucursalId: f.sucursalId || undefined,
                    tipo: 'factura',
                    letra: foto.comprobante?.tipo?.split('_')[1]?.toUpperCase() || undefined,
                    numero: foto.comprobante?.numero ?? 's/n',
                    monto: Number(fotoImp.total),
                    neto: fotoImp.neto, iva: fotoImp.iva,
                    percepcionIva: Number(fotoImp.percepcionIva ?? 0),
                    percepcionIibb: Number(fotoImp.percepcionIibb ?? 0),
                    impuestosInternos: Number(fotoImp.impuestosInternos ?? 0),
                    otros: Number(fotoImp.otros ?? 0),
                    fechaEmision: normFechaIso(foto.comprobante?.fecha),
                    condicionVenta: foto.comprobante?.condicionVenta || undefined,
                    archivoUrl: foto.archivoUrl || undefined,
                    pagada,
                    // TODOS los renglones leídos (con o sin producto): son la base del cruce
                    items: fotoItems.map((i) => ({ sku: i.sku || undefined, descripcion: i.descripcion, cantidad: Number(i.cantidad), precio: numImp(i.precio) })),
                  })}
                />
              ) : (
              <Acciones
                cerrar={cerrar}
                okLabel={`Registrar entrada${foto.comprobante?.tipo?.startsWith('factura') ? ' + factura' : ''}`}
                disabled={!f.proveedorId || !f.sucursalId || !fotoItems.some((i) => i.incluir && i.sku) || fotoItems.some((i) => i.incluir && !i.sku) || costoBloquea}
                onOk={() => post({
                  accion: 'entradaDirecta',
                  proveedorId: f.proveedorId,
                  sucursalId: f.sucursalId,
                  numeroRemito: foto.comprobante?.numero || f.numeroRemito,
                  margenPct: f.margenPct ? Number(f.margenPct) : undefined,
                  items: itemsFusionados.map((i) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: i.costoUnitario, precioLeido: numImp(i.precio), margenPct: i.margenPct === '' ? undefined : Number(i.margenPct), fijarMargen: !!fijarSku[i.sku], descripcionLeida: i.descripcion })),
                  ...(foto.comprobante?.tipo?.startsWith('factura') && fotoImp?.total > 0 ? {
                    factura: {
                      numero: foto.comprobante?.numero ?? 's/n',
                      total: Number(fotoImp.total),
                      neto: fotoImp.neto != null ? Number(fotoImp.neto) : undefined,
                      iva: fotoImp.iva != null ? Number(fotoImp.iva) : undefined,
                      percepcionIva: Number(fotoImp.percepcionIva ?? 0),
                      percepcionIibb: Number(fotoImp.percepcionIibb ?? 0),
                      impuestosInternos: Number(fotoImp.impuestosInternos ?? 0),
                      otros: Number(fotoImp.otros ?? 0),
                      letra: foto.comprobante?.tipo?.split('_')[1]?.toUpperCase() || undefined,
                      fechaEmision: normFechaIso(foto.comprobante?.fecha),
                      condicionVenta: foto.comprobante?.condicionVenta || undefined,
                      archivoUrl: foto.archivoUrl || undefined,
                      pagada,
                    },
                  } : {}),
                })}
              />
              )}
              </div>
            </div>
          )}
        </>)}

        {t === 'ocDetalle' && (
          <OrdenDetalle
            id={modal.ocId}
            numero={modal.numero}
            cerrar={cerrar}
            verFactura={(facturaId: string) => setModal({ tipo: 'facturaDetalle', facturaId, volverA: { tipo: 'ocDetalle', ocId: modal.ocId, numero: modal.numero } })}
          />
        )}

        {t === 'facturaDetalle' && (
          <FacturaDetalle id={modal.facturaId} cerrar={modal.volverA ? () => setModal(modal.volverA) : cerrar} volviendo={!!modal.volverA} />
        )}

        {t === 'proveedor' && (<>
          <h2 className="font-semibold text-black text-lg">{modal.prov?.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
          <input value={f.razon_social ?? f.razonSocial ?? ''} onChange={(e) => set('razonSocial', e.target.value)} placeholder="Razón social" className={input} />
          <div className="grid grid-cols-2 gap-3">
            <input value={f.cuit ?? ''} onChange={(e) => set('cuit', e.target.value)} placeholder="CUIT" className={input} />
            <input value={f.condicion_pago ?? f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición (30 días…)" className={input} />
            <input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="Email" className={input} />
            <input type="number" value={f.lead_time_dias ?? f.leadTimeDias ?? ''} onChange={(e) => set('leadTimeDias', e.target.value)} placeholder="Días de entrega" className={input} />
          </div>
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Guardar" onOk={() => post(modal.prov?.id ? { accion: 'editarProveedor', id: modal.prov.id, razonSocial: f.razonSocial ?? f.razon_social, cuit: f.cuit, condicionPago: f.condicionPago ?? f.condicion_pago, email: f.email, leadTimeDias: f.leadTimeDias ?? f.lead_time_dias } : { accion: 'crearProveedor', razonSocial: f.razonSocial, cuit: f.cuit, condicionPago: f.condicionPago, email: f.email, leadTimeDias: f.leadTimeDias })} />
        </>)}

        {t === 'factura' && (<>
          <h2 className="font-semibold text-black text-lg">Registrar factura de proveedor</h2>
          <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} placeholder="N° de factura" className={input} />
            <input type="number" value={f.monto ?? ''} onChange={(e) => set('monto', e.target.value)} placeholder="Monto $" className={input} />
          </div>
          <input type="date" value={f.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} className={input} />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Registrar" onOk={() => post({ accion: 'factura', proveedorId: f.proveedorId, numero: f.numero, monto: Number(f.monto), vencimiento: f.vencimiento })} />
        </>)}

        {t === 'pagar' && (<>
          <h2 className="font-semibold text-black text-lg">Nueva orden de pago — {modal.prov.proveedor?.razon_social}</h2>
          <p className="text-xs text-black/50">Elegí las facturas. La OP queda <b>pendiente de aprobación del dueño</b> antes de pagarse.</p>
          {modal.prov.facturas.map((fa: any) => (
            <label key={fa.id} className="flex items-center gap-2 text-sm text-black border-b border-black/5 py-1.5">
              <input type="checkbox" checked={facturasSel.includes(fa.id)} onChange={(e) => setFacturasSel((s) => e.target.checked ? [...s, fa.id] : s.filter((x) => x !== fa.id))} className="accent-[#B82D25]" />
              <span className="flex-1">Factura {fa.numero} {fa.vencimiento ? `· vence ${fecha(fa.vencimiento)}` : ''}</span>
              <span className="font-medium">{pesos(fa.monto)}</span>
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <select className={input + ' bg-white'} value={f.medioPago ?? 'transferencia'} onChange={(e) => set('medioPago', e.target.value)}>
              <option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="efectivo">Efectivo</option>
            </select>
            <div><label className="text-[11px] text-black/45 block mb-0.5">Pago programado</label><input type="date" value={f.fechaProgramada ?? ''} onChange={(e) => set('fechaProgramada', e.target.value)} className={input} /></div>
          </div>
          <input value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" className={input} />
          {facturasSel.length > 0 && <p className="text-right text-sm font-semibold">Total OP: {pesos(modal.prov.facturas.filter((x: any) => facturasSel.includes(x.id)).reduce((s: number, x: any) => s + Number(x.monto), 0))}</p>}
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Crear orden de pago" disabled={!facturasSel.length} onOk={() => post({ accion: 'crearOP', facturaIds: facturasSel, medioPago: f.medioPago ?? 'transferencia', fechaProgramada: f.fechaProgramada, observaciones: f.observaciones })} />
        </>)}
      </div>
    </div>
  );
}

// Detalle de una factura de proveedor ya registrada: desglose fiscal + renglones.
// Detalle de una orden de compra: qué se pidió, qué llegó y con qué papeles.
// La factura se abre desde acá — que es donde uno tiene la duda — en lugar de
// mandar a nadie a buscarla a otra pantalla.
function OrdenDetalle({ id, numero, cerrar, verFactura }: { id: string; numero: number; cerrar: () => void; verFactura: (facturaId: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/compras?recurso=orden&id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setD)
      .catch(() => setErr('No se pudo cargar el detalle de la compra'));
  }, [id]);

  const ESTADO_FACT: Record<string, string> = { pendiente: 'pendiente de pago', pagada: 'pagada', en_pago: 'en pago', anulada: 'anulada' };

  return (
    <>
      <h2 className="font-semibold text-black text-lg">OC #{numero}{d?.proveedor?.razon_social ? ` · ${d.proveedor.razon_social}` : ''}</h2>
      {!d && !err && <p className="text-sm text-black/50">Cargando…</p>}
      {err && <p className="text-sm text-[#B82D25]">{err}</p>}
      {d && (
        <div className="space-y-3">
          <div className="rounded-lg bg-[#F0EBE2]/60 px-3 py-2 text-sm text-black/80">
            <p className="text-xs text-black/55">
              {d.sucursal?.nombre} · {fecha(d.creado_en)}
              {d.creador?.nombre ? ` · cargó ${d.creador.nombre}` : ''}
              {d.condicion_pago ? ` · ${d.condicion_pago}` : ''}
              {d.origen === 'directa' ? ' · entrada directa (sin OC previa)' : ''}
            </p>
            {d.observaciones && <p className="text-xs text-black/50 italic mt-0.5">“{d.observaciones}”</p>}
          </div>

          <div className="rounded-lg border border-black/10 divide-y divide-black/5 max-h-64 overflow-y-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-black/40">
              <span className="flex-1">Producto</span><span className="w-20 text-right">Pedido</span><span className="w-20 text-right">Recibido</span><span className="w-24 text-right">Costo</span>
            </div>
            {(d.items ?? []).map((it: any, i: number) => {
              const falta = Number(it.cantidad_recibida ?? 0) < Number(it.cantidad);
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="flex-1 truncate text-black">{it.producto?.nombre ?? '—'} <span className="text-xs text-black/35">{it.producto?.sku}</span></span>
                  <span className="w-20 text-right tabular-nums text-black/70">{it.cantidad}</span>
                  <span className={`w-20 text-right tabular-nums ${falta ? 'text-[#B82D25] font-medium' : 'text-black/70'}`}>{it.cantidad_recibida ?? 0}</span>
                  <span className="w-24 text-right tabular-nums text-black/70">{pesos(it.costo_unitario)}</span>
                </div>
              );
            })}
            <div className="flex justify-between px-3 py-1.5"><span className="font-semibold text-black text-sm">TOTAL</span><span className="font-semibold text-black tabular-nums">{pesos(d.total)}</span></div>
          </div>

          {/* FACTURAS de esta compra: el motivo por el que esto es clickeable */}
          <div>
            <p className="text-xs uppercase tracking-wide text-black/40 mb-1">Facturas de esta compra</p>
            {d.facturas?.length > 0 ? (
              <div className="rounded-lg border border-black/10 divide-y divide-black/5">
                {d.facturas.map((f: any) => (
                  <button
                    key={f.id}
                    onClick={() => verFactura(f.id)}
                    className="w-full text-left px-3 py-2 hover:bg-[#F0EBE2]/50 flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="text-sm text-black block truncate">
                        {f.letra ? `${String(f.tipo ?? 'factura').replace('_', ' ')} ${f.letra}` : 'Factura'} {f.numero}
                        {f.tieneComprobante && <span className="ml-2 text-[10px] rounded-full bg-black/5 px-2 py-0.5 text-black/50">con comprobante</span>}
                      </span>
                      <span className="text-xs text-black/45">
                        {f.fecha_emision ? fecha(f.fecha_emision) : fecha(f.creado_en)} · {ESTADO_FACT[f.estado] ?? f.estado}
                        {f.cargador?.nombre ? ` · cargó ${f.cargador.nombre}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-black tabular-nums">{pesos(f.monto)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-black/45">Todavía no hay factura cargada para esta compra.</p>
            )}
          </div>

          {d.remitos?.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-black/40 mb-1">Remitos</p>
              <div className="rounded-lg border border-black/10 divide-y divide-black/5">
                {d.remitos.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-black/75">
                    <span className="min-w-0 truncate">
                      {r.numero || 'sin número'} <span className="text-xs text-black/45">· {fecha(r.creado_en)} · {String(r.estado ?? '').replace(/_/g, ' ')}</span>
                    </span>
                    <a href={`/api/documento?tipo=remito&id=${r.id}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[#B82D25] underline">acta de recepción</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {/* El papel con folio: es el que se le manda al proveedor y el que
            después respalda el reclamo si lo que llega no coincide. */}
        <a
          href={`/api/documento?tipo=oc&id=${id}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-black/15 px-4 py-2 text-sm font-medium text-black/75 hover:bg-black/5"
        >
          Orden en PDF
        </a>
        <button onClick={cerrar} className="rounded-full bg-black text-white text-sm font-medium px-5 py-2 hover:bg-black/80">Cerrar</button>
      </div>
    </>
  );
}

function FacturaDetalle({ id, cerrar, volviendo }: { id: string; cerrar: () => void; volviendo?: boolean }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/compras?recurso=factura&id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setD)
      .catch(() => setErr('No se pudo cargar el detalle de la factura'));
  }, [id]);
  const ESTADO: Record<string, string> = { pendiente: 'Pendiente de pago', pagada: 'Pagada', en_pago: 'En pago' };
  return (
    <>
      <h2 className="font-semibold text-black text-lg">Factura {d?.numero ?? ''}</h2>
      {!d && !err && <p className="text-sm text-black/50">Cargando…</p>}
      {err && <p className="text-sm text-[#B82D25]">{err}</p>}
      {d && (
        <div className="space-y-3">
          <div className="rounded-lg bg-[#F0EBE2]/60 px-3 py-2 text-sm text-black/80">
            <p><b>{d.proveedor?.razon_social}</b>{d.proveedor?.cuit ? ` · CUIT ${d.proveedor.cuit}` : ''}</p>
            <p className="text-xs text-black/55">{fecha(d.creado_en)} · {ESTADO[d.estado] ?? d.estado}{d.vencimiento ? ` · vence ${fecha(d.vencimiento)}` : ''}</p>
          </div>
          <div className="rounded-lg border border-black/10 p-2.5 space-y-1 text-sm">
            {[['Neto gravado', d.neto], ['IVA', d.iva], ['Percepción IVA', d.percepcion_iva], ['Percepción IIBB', d.percepcion_iibb], ['Impuestos internos', d.impuestos_internos], ['Otros impuestos', d.otros_impuestos]]
              .filter(([, v]: any) => v != null && Number(v) !== 0)
              .map(([l, v]: any) => (
                <div key={l} className="flex justify-between"><span className="text-black/55">{l}</span><span className="text-black tabular-nums">{pesos(v)}</span></div>
              ))}
            <div className="flex justify-between border-t border-black/10 pt-1 mt-1"><span className="font-semibold text-black">TOTAL</span><span className="font-semibold text-black tabular-nums">{pesos(d.monto)}</span></div>
          </div>
          {d.items?.length > 0 ? (
            <div className="rounded-lg border border-black/10 divide-y divide-black/5 max-h-56 overflow-y-auto">
              {d.items.map((it: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="text-black truncate">{it.cantidad}× {it.nombre}</span>
                  {it.costo != null && <span className="shrink-0 text-black/45 text-xs tabular-nums">costo {pesos(it.costo)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-black/45">Sin renglones asociados (factura cargada a mano).</p>
          )}

          {/* El papel original. Es lo que se mira cuando hay una duda: el enlace
              es temporal (lo firma el API, el archivo no es público). */}
          {d.comprobanteUrl ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase tracking-wide text-black/40">Comprobante</p>
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#B82D25] hover:underline">Abrir en grande</a>
              </div>
              {/pdf(\?|$)/i.test(d.archivo_url ?? d.comprobanteUrl) ? (
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className="block rounded-lg border border-black/10 bg-[#F0EBE2]/50 px-3 py-4 text-center text-sm text-black/70 hover:border-black/30">
                  Abrir el comprobante (PDF)
                </a>
              ) : (
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer">
                  <img src={d.comprobanteUrl} alt="Comprobante" className="w-full rounded-lg border border-black/10 max-h-96 object-contain bg-white" />
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-black/45">Esta factura se cargó a mano: no hay foto ni PDF del comprobante.</p>
          )}
        </div>
      )}
      <div className="flex justify-end pt-1"><button onClick={cerrar} className="rounded-full bg-black text-white text-sm font-medium px-5 py-2 hover:bg-black/80">{volviendo ? 'Volver a la compra' : 'Cerrar'}</button></div>
    </>
  );
}

function Acciones({ cerrar, onOk, okLabel, disabled }: any) {
  const [cargando, setCargando] = useState(false);
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button onClick={cerrar} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
      <button onClick={async () => { setCargando(true); try { await onOk(); } finally { setCargando(false); } }} disabled={disabled || cargando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{cargando ? '…' : okLabel}</button>
    </div>
  );
}

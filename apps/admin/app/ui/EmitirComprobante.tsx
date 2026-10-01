'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Entrada, FOCO, FOCO_ADENTRO, IconoCerrar, Modal, Selector, unir } from './kit';
import { pesos } from '../lib/formato';

const TIPOS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'Nota de crédito A', NCB: 'Nota de crédito B', NCC: 'Nota de crédito C',
  NDA: 'Nota de débito A', NDB: 'Nota de débito B', NDC: 'Nota de débito C',
  REM: 'Remito', REC: 'Recibo de cobranza', ANT: 'Anticipo', SIN: 'Comprobante interno',
};

type Item = { sku?: string; descripcion: string; cantidad: number; precioUnitario: number; alicuota: number };
type Sucursal = { id: string; nombre: string };

const esNota = (t: string) => t.startsWith('NC') || t.startsWith('ND');
const llevaItems = (t: string) => ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'REM', 'SIN'].includes(t);
const importeLibre = (t: string) => ['REC', 'ANT', 'NDA', 'NDB', 'NDC', 'SIN'].includes(t);

// Sugerencias que se despliegan debajo de un buscador (clientes, productos)
const LISTA_SUGERENCIAS = 'absolute z-contenido mt-1 w-full overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-flotante';
const SUGERENCIA = unir(
  'block min-h-11 w-full border-b border-black/[0.06] px-3.5 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro',
  FOCO_ADENTRO,
);
const CASILLA = 'flex min-h-11 items-center gap-2.5 text-sm text-tinta';

export function EmitirComprobante({
  sucursales,
  ventaInicial,
}: {
  sucursales: Sucursal[];
  ventaInicial?: { id: string; total: number } | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(!!ventaInicial);
  const [tipo, setTipo] = useState(ventaInicial ? 'FB' : 'FB');
  const [cliente, setCliente] = useState<any>(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [sugClientes, setSugClientes] = useState<any[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [buscaProducto, setBuscaProducto] = useState('');
  const [sugProductos, setSugProductos] = useState<any[]>([]);
  const [importe, setImporte] = useState('');
  const [concepto, setConcepto] = useState('');
  const [condicionPago, setCondicionPago] = useState<'contado' | 'cta_cte'>('contado');
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [moverStock, setMoverStock] = useState(true);
  const [referencias, setReferencias] = useState<any[]>([]);
  const [referenciaId, setReferenciaId] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // sugerencias de clientes
  useEffect(() => {
    if (buscaCliente.trim().length < 2) return setSugClientes([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(buscaCliente)}`);
      if (res.ok) setSugClientes(((await res.json()).clientes ?? []).slice(0, 6));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaCliente]);

  // sugerencias de productos
  useEffect(() => {
    if (buscaProducto.trim().length < 2) return setSugProductos([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/buscar-producto?q=${encodeURIComponent(buscaProducto)}`);
      if (res.ok) setSugProductos((await res.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaProducto]);

  // facturas del cliente para referenciar notas
  useEffect(() => {
    if (!esNota(tipo) || !cliente) return setReferencias([]);
    (async () => {
      const res = await fetch(`/api/facturacion?clienteId=${cliente.id}&tipo=FA,FB,FC&limite=10`);
      if (res.ok) setReferencias(await res.json());
    })();
  }, [tipo, cliente]);

  const total = llevaItems(tipo) && items.length
    ? items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
    : Number(importe) || 0;

  const emitir = async () => {
    setCargando(true);
    setError('');
    try {
      const cuerpo: any = {
        accion: 'emitir',
        tipo,
        clienteId: cliente?.id,
        condicionPago,
        concepto: concepto || undefined,
        referenciaId: referenciaId || undefined,
      };
      if (ventaInicial && ['FA', 'FB', 'FC'].includes(tipo) && !items.length) {
        cuerpo.ventaId = ventaInicial.id;
      } else if (llevaItems(tipo) && items.length) {
        cuerpo.items = items;
      } else {
        cuerpo.importe = Number(importe) || 0;
      }
      if (tipo === 'REM') {
        cuerpo.sucursalId = sucursalId;
        cuerpo.moverStock = moverStock;
      }
      const res = await fetch('/api/facturacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const datos = await res.json();
      if (!res.ok) {
        setError(datos.message ?? 'No se pudo emitir');
        return;
      }
      setAbierto(false);
      router.push(`/facturacion/${datos.id}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <Boton onClick={() => setAbierto(true)} className="w-full sm:w-auto">
        + Emitir comprobante
      </Boton>

      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo="Emitir comprobante"
        descripcion={ventaInicial ? `Facturando la venta de ${pesos(Number(ventaInicial.total) || 0)}` : 'Numeración automática por tipo y punto de venta.'}
        ancho="ancho"
        bloquearCierre={cargando}
        cerrarAlTocarAfuera={false}
        pie={
          <>
            <div className="min-w-full text-sm text-tinta sm:mr-auto sm:min-w-0">
              Total: <strong className="importe text-lg">{pesos(Number(total) || 0)}</strong>
              {tipo.endsWith('A') && total > 0 && <span className="ml-2 text-xs text-tinta/60">(IVA discriminado en el comprobante)</span>}
            </div>
            <Boton variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton onClick={emitir} cargando={cargando} disabled={cargando || total <= 0 && tipo !== 'REM'}>
              {cargando ? 'Emitiendo…' : `Emitir ${TIPOS[tipo]}`}
            </Boton>
            {error && <Aviso tono="error" className="min-w-full">{error}</Aviso>}
          </>
        }
      >
        <div className="space-y-3">
          <Campo etiqueta="Tipo de comprobante">
            <Selector value={tipo} onChange={(e) => { setTipo(e.target.value); setError(''); }}>
              {Object.entries(TIPOS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Selector>
          </Campo>

          {/* receptor */}
          <div className="space-y-2 rounded-2xl bg-crema p-3">
            {cliente ? (
              <div className="flex items-center justify-between gap-2 text-sm text-tinta">
                <span className="min-w-0 break-words">
                  <strong>{cliente.razon_social ?? cliente.nombre}</strong>
                  <span className="ml-2 text-xs text-tinta/60">
                    {cliente.cuit ?? cliente.dni} · {cliente.condicion_iva?.replaceAll('_', ' ') ?? 'consumidor final'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setCliente(null)}
                  aria-label="Quitar el cliente"
                  className={unir('grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo', FOCO)}
                >
                  <IconoCerrar className="size-5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Entrada
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                  placeholder="Cliente (nombre o DNI) — vacío = Consumidor final"
                  aria-label="Buscar cliente"
                />
                {sugClientes.length > 0 && (
                  <div className={LISTA_SUGERENCIAS}>
                    {sugClientes.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCliente(c); setBuscaCliente(''); setSugClientes([]); }}
                        className={SUGERENCIA}
                      >
                        {c.razon_social ?? c.nombre}
                        <span className="ml-2 text-xs text-tinta/60">{c.cuit ?? c.dni} · {(c.condicion_iva ?? '').replaceAll('_', ' ')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'].includes(tipo) && cliente && (
              <label className={CASILLA}>
                <input type="checkbox" checked={condicionPago === 'cta_cte'} onChange={(e) => setCondicionPago(e.target.checked ? 'cta_cte' : 'contado')} className="size-5 shrink-0 accent-marca" />
                A cuenta corriente (queda como deuda del cliente)
              </label>
            )}
          </div>

          {/* referencia para notas */}
          {esNota(tipo) && (
            <Selector value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)} aria-label="Comprobante de referencia">
              <option value="">Sin comprobante de referencia</option>
              {referencias.map((r) => (
                <option key={r.id} value={r.id}>
                  {TIPOS[r.tipo]} {String(r.punto_venta).padStart(4, '0')}-{String(r.numero).padStart(8, '0')} · {pesos(Number(r.total) || 0)}
                </option>
              ))}
            </Selector>
          )}

          {/* renglones */}
          {llevaItems(tipo) && !(ventaInicial && ['FA', 'FB', 'FC'].includes(tipo) && !items.length) && (
            <div className="space-y-2">
              <div className="relative">
                <Entrada
                  value={buscaProducto}
                  onChange={(e) => setBuscaProducto(e.target.value)}
                  placeholder="Agregar producto del catálogo (nombre o SKU)…"
                  aria-label="Buscar producto del catálogo"
                />
                {sugProductos.length > 0 && (
                  <div className={unir(LISTA_SUGERENCIAS, 'max-h-48 overflow-y-auto')}>
                    {sugProductos.map((p) => (
                      <button
                        key={p.sku}
                        type="button"
                        onClick={() => {
                          setItems((xs) => [...xs, { sku: p.sku, descripcion: p.nombre, cantidad: 1, precioUnitario: p.precio ?? 0, alicuota: p.alicuotaIva ?? 21 }]);
                          setBuscaProducto('');
                          setSugProductos([]);
                        }}
                        className={SUGERENCIA}
                      >
                        {p.nombre} <span className="text-xs text-tinta/60">{p.sku} · {p.precio ? pesos(Number(p.precio) || 0) : 'sin precio'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Boton
                variante="fantasma"
                tamano="chico"
                onClick={() => setItems((xs) => [...xs, { descripcion: '', cantidad: 1, precioUnitario: 0, alicuota: 21 }])}
              >
                + renglón libre (sin producto)
              </Boton>
              {items.map((i, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[4rem_minmax(0,1fr)_3.75rem_2.75rem] items-center gap-2 rounded-xl border border-black/[0.06] p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_6.5rem_2.75rem] sm:border-0 sm:p-0"
                >
                  <Entrada
                    value={i.descripcion}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, descripcion: e.target.value } : x)))}
                    placeholder="Descripción"
                    aria-label="Descripción"
                    className="col-span-3 sm:col-span-1"
                  />
                  <Entrada
                    type="number"
                    value={i.cantidad}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, cantidad: Number(e.target.value) } : x)))}
                    aria-label="Cantidad"
                    className="text-right max-sm:order-2"
                  />
                  <Entrada
                    type="number"
                    value={i.precioUnitario}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, precioUnitario: Number(e.target.value) } : x)))}
                    aria-label="Precio unitario"
                    className="text-right max-sm:order-2"
                  />
                  <Selector
                    value={i.alicuota}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, alicuota: Number(e.target.value) } : x)))}
                    aria-label="Alícuota de IVA"
                    className="max-sm:order-2 max-sm:col-span-2"
                  >
                    <option value={21}>21 %</option>
                    <option value={10.5}>10,5 %</option>
                    <option value={0}>Exento</option>
                  </Selector>
                  <button
                    type="button"
                    onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
                    aria-label="Quitar el renglón"
                    className={unir('grid size-11 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo max-sm:order-1', FOCO)}
                  >
                    <IconoCerrar className="size-5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* importe libre */}
          {(importeLibre(tipo) && !items.length) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Entrada value={importe} onChange={(e) => setImporte(e.target.value)} type="number" placeholder="Importe $" aria-label="Importe" />
              <Entrada value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto (interés, anticipo, seña…)" aria-label="Concepto" />
            </div>
          )}

          {/* remito */}
          {tipo === 'REM' && (
            <div className="grid items-center gap-3 sm:grid-cols-2">
              <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} aria-label="Sucursal de salida">
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>Sale de {s.nombre}</option>
                ))}
              </Selector>
              <label className={CASILLA}>
                <input type="checkbox" checked={moverStock} onChange={(e) => setMoverStock(e.target.checked)} className="size-5 shrink-0 accent-marca" />
                Descontar stock al emitir
              </label>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

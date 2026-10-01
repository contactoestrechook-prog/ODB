'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Aviso,
  Boton,
  Campo,
  Entrada,
  Etiqueta,
  FOCO,
  IconoCerrar,
  Modal,
  Selector,
  Tarjeta,
  TarjetaCabecera,
  unir,
  useConfirmar,
} from './kit';

// ✕ de quitar: 44 px de área para el dedo aunque el dibujo sea chico.
const BOTON_QUITAR = unir(
  'grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo',
  FOCO,
);

type Sucursal = { id: string; nombre: string };
type Transferencia = {
  id: string;
  estado: string;
  creado_en: string;
  origen: { nombre: string } | null;
  destino: { nombre: string } | null;
  items: { cantidad: number; producto: { sku: string; nombre: string } | null }[];
};

type Modo = null | 'ajuste' | 'merma' | 'transferencia';

// buscador de producto con sugerencias (usa el catálogo público)
function BuscadorProducto({ onElegir }: { onElegir: (p: any) => void }) {
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState<any[]>([]);

  useEffect(() => {
    if (texto.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/buscar-producto?q=${encodeURIComponent(texto)}`);
      if (res.ok) setSugerencias((await res.json()).items ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [texto]);

  return (
    <div>
      <Entrada
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar producto por nombre o SKU…"
        aria-label="Buscar producto por nombre o SKU"
      />
      {sugerencias.length > 0 && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
          {sugerencias.map((p) => (
            <button
              key={p.sku}
              type="button"
              onClick={() => {
                onElegir(p);
                setTexto('');
                setSugerencias([]);
              }}
              className="block min-h-11 w-full border-b border-black/[0.06] px-3.5 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none"
            >
              <span className="font-medium">{p.nombre}</span>
              <span className="ml-2 text-xs text-tinta/60">{p.sku} · stock {Math.round(p.stockTotal)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccionesStock({
  sucursales,
  transferencias,
}: {
  sucursales: Sucursal[];
  transferencias: Transferencia[];
}) {
  const router = useRouter();
  const { pedirTexto, avisar, dialogo } = useConfirmar();
  const [modo, setModo] = useState<Modo>(null);
  const [producto, setProducto] = useState<any>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [destinoId, setDestinoId] = useState(sucursales[1]?.id ?? '');
  const [items, setItems] = useState<{ sku: string; nombre: string; cantidad: number }[]>([]);
  const [motivoTipo, setMotivoTipo] = useState('Rotura'); // motivo tipificado de merma
  const [pin, setPin] = useState('');
  const [pidePin, setPidePin] = useState(false); // el server pidió autorización de supervisor
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const MOTIVOS_MERMA = ['Rotura', 'Vencimiento', 'Robo/faltante', 'Error de carga', 'Consumo interno', 'Otro'];

  const abrir = (m: Modo) => {
    setModo(m);
    setProducto(null);
    setCantidad('');
    setMotivo('');
    setMotivoTipo('Rotura');
    setItems([]);
    setPin('');
    setPidePin(false);
    setError('');
  };

  const ejecutar = async () => {
    setCargando(true);
    setError('');
    try {
      let cuerpo: any;
      if (modo === 'transferencia') {
        if (!items.length) {
          setError('Agregá al menos un producto');
          return;
        }
        cuerpo = { accion: 'transferencia', origenId: sucursalId, destinoId, items };
      } else {
        if (!producto || !Number(cantidad)) {
          setError('Elegí producto y cantidad');
          return;
        }
        // merma: motivo tipificado (+ detalle opcional) para poder medir POR QUÉ se pierde
        const motivoFinal = modo === 'merma'
          ? (motivo.trim() ? `${motivoTipo}: ${motivo.trim()}` : motivoTipo)
          : (motivo || 'Ajuste manual desde el panel');
        cuerpo = { accion: modo, sku: producto.sku, sucursalId, cantidad: Number(cantidad), motivo: motivoFinal };

        // ajuste/merma grande: el server exige PIN de supervisor
        if (pidePin) {
          if (!pin.trim()) { setError('Ingresá el PIN del supervisor'); return; }
          const ra = await fetch('/api/caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accion: 'autorizar', pin }),
          });
          const da = await ra.json();
          if (!ra.ok) { setError(da.message ?? 'PIN incorrecto'); return; }
          cuerpo.autorizacionToken = da.token;
        }
      }
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      if (!res.ok) {
        const msg = (await res.json()).message ?? 'No se pudo registrar';
        if (/supervisor|PIN/i.test(msg) && !pidePin) setPidePin(true); // muestra el campo PIN y reintenta
        setError(msg);
        return;
      }
      setModo(null);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const recibir = async (id: string) => {
    await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'recibir', transferenciaId: id }),
    });
    router.refresh();
  };

  const anular = async (id: string) => {
    const motivoAnu = await pedirTexto({
      titulo: '¿Anular la transferencia?',
      texto: 'El stock vuelve a la sucursal de origen.',
      campo: { etiqueta: 'Motivo' },
      variante: 'peligro',
      textoConfirmar: 'Anular',
    });
    if (motivoAnu === null) return;
    const res = await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'anular-transferencia', transferenciaId: id, motivo: motivoAnu || undefined }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      await avisar({ titulo: 'No se pudo anular la transferencia', texto: d.message ?? 'No se pudo anular (requiere gerencia)' });
      return;
    }
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* acciones principales */}
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Boton onClick={() => abrir('ajuste')} className="grow sm:grow-0">
          + Ajustar stock
        </Boton>
        <Boton variante="secundario" onClick={() => abrir('merma')} className="grow sm:grow-0">
          Registrar merma
        </Boton>
        <Boton variante="secundario" onClick={() => abrir('transferencia')} className="grow sm:grow-0">
          Transferir entre sucursales
        </Boton>
      </div>

      {/* transferencias en curso */}
      {transferencias.length > 0 && (
        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Transferencias en curso" />
          <div className="divide-y divide-black/[0.06]">
            {transferencias.map((t) => (
              <div key={t.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0 text-sm text-tinta">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    <span className="min-w-0 break-words">{t.origen?.nombre} → {t.destino?.nombre}</span>
                    <Etiqueta tono="atencion">
                      {t.estado === 'pendiente' ? 'En camino' : t.estado}
                    </Etiqueta>
                  </p>
                  <p className="mt-0.5 break-words text-xs text-tinta/60">
                    {t.items.map((i) => `${i.producto?.nombre} × ${Math.round(i.cantidad)}`).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Boton
                    variante="peligro"
                    tamano="chico"
                    onClick={() => anular(t.id)}
                    title="La mercadería no llegó: vuelve al stock de origen"
                    className="grow sm:grow-0"
                  >
                    Anular
                  </Boton>
                  <Boton tamano="chico" onClick={() => recibir(t.id)} className="grow sm:grow-0">
                    Recibir
                  </Boton>
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {/* modal */}
      <Modal
        abierto={modo !== null}
        onCerrar={() => setModo(null)}
        cerrarAlTocarAfuera={false}
        titulo={modo === 'ajuste' ? 'Ajustar stock' : modo === 'merma' ? 'Registrar merma' : 'Transferencia entre sucursales'}
        descripcion={
          modo === 'ajuste'
            ? 'Corrige el stock con un movimiento auditado (positivo suma, negativo resta).'
            : modo === 'merma'
              ? 'Rotura, vencimiento o pérdida: descuenta stock y queda en el historial.'
              : 'La mercadería sale de origen ya; el stock entra a destino cuando la reciben.'
        }
        pie={
          <>
            <Boton variante="secundario" onClick={() => setModo(null)}>
              Cancelar
            </Boton>
            <Boton onClick={ejecutar} cargando={cargando}>
              {cargando ? 'Registrando…' : modo === 'transferencia' ? 'Enviar transferencia' : 'Registrar'}
            </Boton>
          </>
        }
      >
        <div className="space-y-3">
          {modo === 'transferencia' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Origen">
                  <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </Selector>
                </Campo>
                <Campo etiqueta="Destino">
                  <Selector value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                    {sucursales.filter((s) => s.id !== sucursalId).map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </Selector>
                </Campo>
              </div>
              <BuscadorProducto
                onElegir={(p) => setItems((xs) => [...xs.filter((x) => x.sku !== p.sku), { sku: p.sku, nombre: p.nombre, cantidad: 1 }])}
              />
              {items.map((i, idx) => (
                <div key={i.sku} className="flex items-center gap-2 text-sm text-tinta">
                  <span className="min-w-0 flex-1 break-words">{i.nombre}</span>
                  {/* el ancho va en una caja: Entrada ya trae w-full */}
                  <div className="w-24 shrink-0">
                    <Entrada
                      type="number"
                      value={i.cantidad}
                      onChange={(e) =>
                        setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, cantidad: Number(e.target.value) } : x)))
                      }
                      aria-label={`Cantidad de ${i.nombre}`}
                      className="text-right"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
                    aria-label={`Quitar ${i.nombre}`}
                    className={BOTON_QUITAR}
                  >
                    <IconoCerrar className="size-5" />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <>
              {producto ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-crema-claro py-1 pl-3.5 pr-1 text-sm text-tinta">
                  <span className="min-w-0 break-words">{producto.nombre} <span className="text-xs text-tinta/60">({producto.sku})</span></span>
                  <button type="button" onClick={() => setProducto(null)} aria-label="Quitar el producto" className={BOTON_QUITAR}>
                    <IconoCerrar className="size-5" />
                  </button>
                </div>
              ) : (
                <BuscadorProducto onElegir={setProducto} />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Sucursal">
                  <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </Selector>
                </Campo>
                <Campo etiqueta={modo === 'merma' ? 'Cantidad perdida' : 'Cantidad (+ suma / − resta)'}>
                  <Entrada
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    type="number"
                  />
                </Campo>
              </div>
              {modo === 'merma' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Motivo">
                    <Selector value={motivoTipo} onChange={(e) => setMotivoTipo(e.target.value)}>
                      {MOTIVOS_MERMA.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Selector>
                  </Campo>
                  <Campo etiqueta="Detalle (opcional)">
                    <Entrada
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="ej: se cayó del palet"
                    />
                  </Campo>
                </div>
              ) : (
                <Entrada
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo del ajuste (conteo, corrección…)"
                  aria-label="Motivo del ajuste"
                />
              )}
              {pidePin && (
                <Entrada
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="PIN del supervisor (el monto supera el tope)"
                  aria-label="PIN del supervisor"
                  type="password"
                  inputMode="numeric"
                />
              )}
            </>
          )}

          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      </Modal>

      {dialogo}
    </div>
  );
}

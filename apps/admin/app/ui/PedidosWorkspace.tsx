'use client';

import { useEffect, useRef, useState } from 'react';
import { numero, pesos as pesosFmt } from '../lib/formato';
import { AreaTexto, Aviso, Boton, Chips, Entrada, Etiqueta, FOCO, IconoCerrar, Modal, PlacaRoja, Tarjeta, unir, type TonoEtiqueta } from './kit';

const pesos = (n: any) => pesosFmt(Number(n) || 0);
const CANALES: Record<string, { label: string; tono: TonoEtiqueta }> = {
  whatsapp: { label: 'WhatsApp', tono: 'ok' },
  app: { label: 'App', tono: 'neutro' },
  self_checkout: { label: 'App', tono: 'neutro' },
  web: { label: 'Web', tono: 'info' },
  pedidosya: { label: 'PedidosYa', tono: 'error' },
  pickup: { label: 'Pick-up', tono: 'atencion' },
  domicilio: { label: 'Domicilio', tono: 'info' },
  mostrador: { label: 'Mostrador', tono: 'neutro' },
};
const canalDe = (p: any) => p.origen || p.canal;
// Precio unitario de un renglón interpretado del WhatsApp: el análisis
// (apps/api/src/pedidos › analizarWhatsApp) manda el `precio` vigente de cada
// renglón y la Placa roja muestra "2 × $1.500", el subtotal y el total.
type RenglonWa = { cantidad?: unknown; precio?: unknown };
const precioDe = (it: RenglonWa | null | undefined): number | null => {
  const n = Number(it?.precio);
  return it?.precio != null && it.precio !== '' && Number.isFinite(n) && n > 0 ? n : null;
};
const siguiente = (p: any): { estado: string; label: string } | null => {
  if (['recibido', 'pagado'].includes(p.estado)) return { estado: 'en_preparacion', label: 'Preparar' };
  if (p.estado === 'en_preparacion') return { estado: 'listo', label: 'Marcar listo' };
  if (p.estado === 'listo') return canalDe(p) === 'domicilio' ? { estado: 'en_camino', label: 'Enviar a reparto' } : { estado: 'entregado', label: 'Entregado' };
  return null;
};

export function PedidosWorkspace({ inicial }: { inicial: any[] }) {
  const [pedidos, setPedidos] = useState<any[]>(inicial);
  const [filtro, setFiltro] = useState('todos');
  const [aviso, setAviso] = useState('');
  const [wa, setWa] = useState(false);
  const timer = useRef<any>(null);

  const recargar = async () => {
    const r = await fetch('/api/pedidos', { cache: 'no-store' });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) setPedidos(d); }
  };
  useEffect(() => { timer.current = setInterval(recargar, 8000); return () => clearInterval(timer.current); }, []);

  const post = async (body: any) => {
    setAviso('');
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setAviso(d.message ?? 'Error'); return null; }
    await recargar();
    return d;
  };

  const visibles = filtro === 'todos' ? pedidos : pedidos.filter((p) => canalDe(p) === filtro);
  const cols = [
    ['Nuevos', visibles.filter((p) => ['recibido', 'pagado'].includes(p.estado))],
    ['En preparación', visibles.filter((p) => p.estado === 'en_preparacion')],
    ['Listos', visibles.filter((p) => p.estado === 'listo')],
  ] as const;
  const porCanal: Record<string, number> = {};
  for (const p of pedidos) { const c = canalDe(p); porCanal[c] = (porCanal[c] ?? 0) + 1; }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <div><p className="importe text-xl font-bold leading-none text-tinta">{pedidos.length}</p><p className="mt-1 text-xs text-tinta/60">Pedidos activos</p></div>
          {Object.entries(porCanal).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => (
            <div key={c}><p className="importe text-xl font-bold leading-none text-tinta">{n}</p><p className="mt-1 text-xs text-tinta/60">{CANALES[c]?.label ?? c}</p></div>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Boton onClick={() => setWa(true)} className="flex-1 sm:flex-none">Pedido por WhatsApp</Boton>
          <Boton variante="secundario" onClick={() => post({ simular: true })} className="flex-1 sm:flex-none">Simular PedidosYa</Boton>
        </div>
      </div>

      <Chips
        etiquetaAccesible="Canal del pedido"
        valor={filtro}
        onCambiar={setFiltro}
        opciones={['todos', 'whatsapp', 'app', 'web', 'pedidosya', 'pickup', 'domicilio', 'mostrador'].map((c) => ({
          valor: c,
          etiqueta: c === 'todos' ? 'Todos' : CANALES[c]?.label ?? c,
        }))}
      />

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      <div className="grid gap-4 md:grid-cols-3">
        {cols.map(([titulo, lista]) => (
          <div key={titulo} className="min-w-0 space-y-2">
            <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-tinta/70">{titulo}<span className="importe text-xs font-medium text-tinta/60">{lista.length}</span></h2>
            {lista.length === 0 && <p className="rounded-2xl border border-dashed border-black/15 p-5 text-center text-xs text-tinta/60">Vacío</p>}
            {lista.map((p) => {
              const c = canalDe(p); const sig = siguiente(p); const tarde = p.minutos > 20;
              return (
                <Tarjeta key={p.id}>
                  <div className="flex items-center justify-between gap-2">
                    <Etiqueta tono={CANALES[c]?.tono ?? 'neutro'}>{CANALES[c]?.label ?? c}</Etiqueta>
                    <span className={unir('importe text-xs', tarde ? 'font-semibold text-marca-hondo' : 'text-tinta/60')}>{p.minutos}′</span>
                  </div>
                  <p className="mt-2 break-words text-sm font-medium text-tinta">{p.cliente?.dni ? `Cliente ${p.cliente.dni}` : 'Consumidor final'}{p.cliente?.tipo ? ` · ${p.cliente.tipo}` : ''}</p>
                  <p className="mt-0.5 break-words text-sm leading-snug text-tinta/70">
                    {(p.items ?? []).slice(0, 3).map((it: any) => `${Math.round(Number(it.cantidad))}× ${it.producto?.nombre ?? ''}`).join(' · ')}
                    {(p.items ?? []).length > 3 && ` +${p.items.length - 3}`}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="importe text-sm font-semibold text-tinta">{pesos(p.total)}</span>
                    {sig && <Boton tamano="chico" onClick={() => post({ pedidoId: p.id, estado: sig.estado })}>{sig.label}</Boton>}
                  </div>
                </Tarjeta>
              );
            })}
          </div>
        ))}
      </div>

      {wa && <ModalWhatsApp cerrar={() => setWa(false)} post={post} />}
    </div>
  );
}

function ModalWhatsApp({ cerrar, post }: { cerrar: () => void; post: (b: any) => Promise<any> }) {
  const [texto, setTexto] = useState('');
  const [escuchando, setEscuchando] = useState(false);
  const [analisis, setAnalisis] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');

  const dictar = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setAviso('Tu navegador no soporta dictado. Pegá el mensaje.'); return; }
    const rec = new SR(); rec.lang = 'es-AR'; rec.interimResults = true; rec.continuous = false;
    setEscuchando(true);
    rec.onresult = (e: any) => setTexto(Array.from(e.results).map((r: any) => r[0].transcript).join(' '));
    rec.onerror = () => setEscuchando(false); rec.onend = () => setEscuchando(false);
    rec.start();
  };
  const analizar = async () => {
    if (!texto.trim()) return;
    setCargando(true); setAviso('');
    try {
      const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'waAnalizar', texto: texto.trim() }) });
      const d = await r.json();
      if (!r.ok) setAviso(d.message ?? 'Error'); else setAnalisis(d);
    } catch {
      setAviso('No se pudo conectar. Reintentá.');
    } finally {
      setCargando(false);
    }
  };
  const crear = async () => {
    setCargando(true);
    try {
      const items = (analisis.items ?? []).map((i: any) => ({ producto_id: i.producto_id, cantidad: i.cantidad }));
      const d = await post({ accion: 'waCrear', items, nombre: analisis.nombre, notas: analisis.notas });
      if (d) cerrar();
    } finally {
      setCargando(false);
    }
  };
  // el total de la placa, solo si todos los renglones tienen precio: uno sin precio lo dejaría corto
  const renglonesWa: RenglonWa[] = analisis?.items ?? [];
  const totalConPrecios = renglonesWa.length > 0 && renglonesWa.every((it) => precioDe(it) != null)
    ? renglonesWa.reduce((t, it) => t + (Number(it.cantidad) || 0) * (precioDe(it) ?? 0), 0)
    : null;

  return (
    <Modal
      abierto
      onCerrar={cerrar}
      titulo="Pedido por WhatsApp"
      descripcion="Pegá (o dictá) el mensaje del cliente. La IA arma el pedido y lo matchea con el catálogo."
      bloquearCierre={cargando}
      cerrarAlTocarAfuera={false}
      pie={
        !analisis ? (
          <>
            <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
            <Boton onClick={analizar} cargando={cargando} disabled={cargando || !texto.trim()}>{cargando ? 'Leyendo…' : 'Interpretar'}</Boton>
          </>
        ) : (
          <>
            <Boton variante="secundario" onClick={() => setAnalisis(null)}>Volver</Boton>
            <Boton onClick={crear} cargando={cargando} disabled={cargando || !analisis.items.length}>{cargando ? 'Creando…' : 'Crear pedido'}</Boton>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Boton
            variante={escuchando ? 'primario' : 'secundario'}
            tamano="chico"
            onClick={dictar}
            disabled={escuchando}
            className={escuchando ? 'animate-pulse motion-reduce:animate-none' : undefined}
            icono={
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0014 0M12 18v3" />
              </svg>
            }
          >
            {escuchando ? 'Escuchando…' : 'Dictar'}
          </Boton>
          <span className="text-xs text-tinta/60">o pegá abajo</span>
        </div>
        <AreaTexto value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="ej: Hola! me mandás 6 quilmes litro, 2 coca de 2.25 y un fernet? Para Av. Mate 123, pago en efectivo" aria-label="Mensaje del cliente" />

        {analisis && (
          <div className="space-y-3">
            {analisis.items.length > 0 ? (
              // Lo reconocido como Placa roja RESUMEN (2/10/2026): el mismo paquete
              // gráfico de los pedidos del bot. La cantidad se sigue corrigiendo en
              // cada renglón y el círculo rojo la acompaña mientras se escribe.
              <PlacaRoja
                titulo="RESUMEN"
                sub={[
                  analisis.nombre ? `Cliente: ${analisis.nombre}` : null,
                  analisis.items.length === 1 ? '1 producto reconocido' : `${analisis.items.length} productos reconocidos`,
                ].filter(Boolean).join(' · ')}
                renglones={analisis.items.map((it: any, i: number) => {
                  const cantidad = Number(it.cantidad) || 0;
                  const unitario = precioDe(it);
                  return {
                    clave: String(i),
                    cantidad,
                    nombre: it.match,
                    detalle: [`pidió: ${it.pedido}`, unitario != null ? `${numero(cantidad, 2)} × ${pesos(unitario)}` : null].filter(Boolean).join(' · '),
                    importe: unitario != null ? pesos(cantidad * unitario) : undefined,
                    acciones: (
                      <div className="flex items-center gap-2">
                        <div className="w-24 shrink-0">
                          <Entrada type="number" inputMode="decimal" value={it.cantidad} onChange={(e) => setAnalisis((a: any) => ({ ...a, items: a.items.map((x: any, j: number) => j === i ? { ...x, cantidad: Number(e.target.value) } : x) }))} aria-label={`Cantidad de ${it.match}`} className="text-right" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setAnalisis((a: any) => ({ ...a, items: a.items.filter((_: any, j: number) => j !== i) }))}
                          aria-label={`Quitar ${it.match}`}
                          className={unir('ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-marca-suave hover:text-marca-hondo', FOCO)}
                        >
                          <IconoCerrar className="size-5" />
                        </button>
                      </div>
                    ),
                  };
                })}
                total={totalConPrecios != null ? { etiqueta: 'Total', valor: pesos(totalConPrecios) } : undefined}
                recuadro={analisis.notas ? <p className="break-words text-tinta/70"><b className="font-semibold text-tinta">Nota:</b> {analisis.notas}</p> : undefined}
              />
            ) : (
              <div className="space-y-2 rounded-xl border border-black/[0.06] bg-crema-claro p-3">
                {analisis.nombre && <p className="text-sm text-tinta"><b className="font-semibold">Cliente:</b> {analisis.nombre}</p>}
                <p className="text-xs text-tinta/60">0 productos reconocidos.</p>
                {analisis.notas && <p className="text-sm text-tinta/70"><b className="font-semibold">Nota:</b> {analisis.notas}</p>}
              </div>
            )}
            {analisis.sinMatch?.length > 0 && <Aviso tono="atencion">No encontré en el catálogo: {analisis.sinMatch.join(', ')}</Aviso>}
            {aviso && <Aviso tono="error">{aviso}</Aviso>}
          </div>
        )}
        {aviso && !analisis && <Aviso tono="error">{aviso}</Aviso>}
      </div>
    </Modal>
  );
}

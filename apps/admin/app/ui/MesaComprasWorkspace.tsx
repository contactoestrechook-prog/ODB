'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { prepararComprobante } from './comprimirImagen';
import { AbastecimientoPanel } from './AbastecimientoPanel';
import { Aviso, Boton, CLASES_ENTRADA, Cargando, FOCO, Pestanas, PlacaRoja, Tarjeta, TarjetaCabecera, Vacio, unir, useConfirmar, type DetallePlaca } from './kit';
import { numero, pesos } from '../lib/formato';

// Mesa de compras: el comprador negocia con el proveedor y acá saca el costo
// real. El sistema hace las cuentas; el analista razona, pregunta y arma la
// propuesta. Nada se aplica hasta que el dueño aprueba.
// detalle: los costeos y productos que el analista detalló, como Placa roja
type Mensaje = { rol: 'usuario' | 'asistente'; texto: string; imagen?: string; mimeType?: string; nombre?: string; detalle?: DetallePlaca };

// el clip de los adjuntos (antes, el emoji 📎)
function IconoClip({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.5 11.5l-8.3 8.3a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" />
    </svg>
  );
}

export function MesaComprasWorkspace({ esDueno, tabInicial }: { esDueno: boolean; tabInicial?: string }) {
  // "Qué comprar" (el agente de abastecimiento, 1/10/2026) va primero
  const [tab, setTab] = useState<'abastecer' | 'costear' | 'aprobar'>(tabInicial === 'costear' || tabInicial === 'aprobar' ? tabInicial : 'abastecer');
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState<{ base64: string; mimeType: string; nombre: string } | null>(null);
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [trabajando, setTrabajando] = useState('');
  const finRef = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const { pedirTexto, dialogo } = useConfirmar();

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes, pensando]);

  async function cargarPropuestas() {
    try {
      const r = await fetch('/api/mesa-compras');
      if (r.ok) setPropuestas(await r.json());
    } catch { /* se reintenta al cambiar de pestaña */ }
  }
  useEffect(() => { cargarPropuestas(); }, []);
  useEffect(() => { if (tab === 'aprobar') cargarPropuestas(); }, [tab]);

  async function elegirFoto(f: File | null) {
    if (!f) return;
    setError('');
    try {
      // las fotos se achican en el navegador; planillas y PDF viajan tal cual
      const esImagen = /^image\//.test(f.type);
      const listo = esImagen ? await prepararComprobante(f) : f;
      const buffer = await listo.arrayBuffer();
      let binario = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
      setFoto({ base64: btoa(binario), mimeType: listo.type || (esImagen ? 'image/jpeg' : 'application/octet-stream'), nombre: f.name });
    } catch {
      setError('No pude leer ese archivo. Probá con otro.');
    }
  }

  async function enviar(textoDirecto?: string) {
    const cuerpo = (textoDirecto ?? texto).trim();
    if ((!cuerpo && !foto) || pensando) return;

    const mio: Mensaje = { rol: 'usuario', texto: cuerpo, imagen: foto?.base64, mimeType: foto?.mimeType, nombre: foto?.nombre };
    const conversacion = [...mensajes, mio];
    setMensajes(conversacion);
    setTexto('');
    setFoto(null);
    setPensando(true);
    setError('');

    try {
      const r = await fetch('/api/mesa-compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: conversacion.map((m) => ({
            rol: m.rol,
            texto: m.texto,
            imagenBase64: m.imagen,
            mimeType: m.mimeType,
            nombreArchivo: m.nombre,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.message ?? 'No pude procesar la consulta'); return; }
      setMensajes((xs) => [...xs, { rol: 'asistente', texto: j.respuesta ?? '', detalle: j.detalle ?? undefined }]);
      // si armó una propuesta, la bandeja del dueño cambió
      if ((j.herramientas ?? []).includes('crear_propuesta')) cargarPropuestas();
    } catch {
      setError('Se cortó la conexión. Probá de nuevo.');
    } finally {
      setPensando(false);
    }
  }

  async function decidir(id: string, accion: 'aprobar' | 'rechazar') {
    if (trabajando) return;
    let motivo = '';
    if (accion === 'rechazar') {
      motivo = (await pedirTexto({ titulo: '¿Por qué se rechaza? Queda registrado.', campo: { etiqueta: 'Motivo', multilinea: true }, variante: 'peligro', textoConfirmar: 'Rechazar' })) ?? '';
      if (motivo === null) return;
    }
    setTrabajando(id);
    setError('');
    try {
      const r = await fetch('/api/mesa-compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, id, motivo }),
      });
      const j = await r.json();
      if (!r.ok) setError(j?.message ?? 'No se pudo aplicar');
      await cargarPropuestas();
    } catch {
      setError('No se pudo aplicar');
    } finally {
      setTrabajando('');
    }
  }

  return (
    <div className="space-y-4">
      <Pestanas
        aLoAncho
        etiquetaAccesible="Mesa de compras"
        valor={tab}
        onCambiar={setTab}
        opciones={[
          { valor: 'abastecer', etiqueta: 'Qué comprar' },
          { valor: 'costear', etiqueta: 'Costear una compra' },
          { valor: 'aprobar', etiqueta: 'Para aprobar', cuenta: propuestas.length || undefined },
        ]}
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {tab === 'abastecer' && <AbastecimientoPanel />}

      {tab === 'costear' && (
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera
            titulo="Analista de compras"
            sub="Contale la oferta como se la dijo el proveedor. Las cuentas las hace el sistema, no la IA."
          />

          <div className="max-h-[52dvh] space-y-3 overflow-y-auto p-4 sm:p-5">
            {mensajes.length === 0 && (
              <div className="space-y-2 text-sm text-tinta/60">
                <p>Por ejemplo:</p>
                <p className="italic">
                  «Cepas me ofrece el Malbec en caja de 6 a $54.000 sin IVA. Me hace 10% y después
                  otro 5% por volumen. El flete son $25.000. Pago a 30 días.»
                </p>
                <p>También podés dictarlo con el micrófono, o adjuntarle la lista del proveedor: foto, PDF o planilla de Excel.</p>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.rol === 'usuario' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.rol === 'usuario' ? 'bg-tinta text-crema' : 'bg-crema text-tinta'}`}>
                  {m.imagen && <p className="mb-1 flex items-center gap-1 text-xs opacity-70"><IconoClip className="size-3.5 shrink-0" /><span className="min-w-0 break-words">{m.nombre ?? 'Adjunto'}</span></p>}
                  {m.texto}
                </div>
                {m.detalle && <PlacaRoja {...m.detalle} className="mt-2 w-full" />}
              </div>
            ))}
            {pensando && <Cargando texto="Sacando cuentas…" />}
            <div ref={finRef} />
          </div>

          <div className="space-y-2 border-t border-black/[0.06] p-3">
            {foto && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-tinta/70">
                <span className="flex min-w-0 items-center gap-1"><IconoClip className="size-3.5 shrink-0" /><span className="min-w-0 break-words">{foto.nombre}</span></span>
                <button onClick={() => setFoto(null)} className={unir('inline-flex min-h-9 items-center rounded-full px-2 underline', FOCO)}>quitar</button>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <input ref={archivoRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.xlsm,.csv" className="hidden"
                onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                rows={2}
                placeholder="Contale la oferta…"
                aria-label="Mensaje para el analista de compras"
                className={unir(CLASES_ENTRADA, 'order-first basis-full resize-none sm:order-none sm:basis-0 sm:flex-1')}
              />
              <button onClick={() => archivoRef.current?.click()} title="Adjuntar la lista del proveedor (foto, PDF o Excel)"
                aria-label="Adjuntar la lista del proveedor (foto, PDF o Excel)"
                className={unir('grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-tinta/70 transition-colors hover:bg-crema-claro hover:text-tinta sm:order-first', FOCO)}>
                <IconoClip className="size-5" />
              </button>
              <span className="sm:order-first"><BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Dictarle al analista" /></span>
              <Boton onClick={() => enviar()} disabled={pensando || (!texto.trim() && !foto)} className="ml-auto sm:ml-0">
                Enviar
              </Boton>
            </div>
          </div>
        </Tarjeta>
      )}

      {tab === 'aprobar' && (
        <div className="space-y-3">
          {propuestas.length === 0 && (
            <Vacio titulo="No hay nada esperando aprobación." texto="Las propuestas que arme el analista de compras aparecen acá." />
          )}
          {/* Cada propuesta, como Placa roja (pedido de Leandro, 2/10/2026:
              "siempre que se detallen productos vamos a usar el paquete gráfico
              de pedidos y lista de precio"). A la derecha va el precio que
              quedaría en góndola; en gris, de dónde sale (costo y margen) y el
              precio de antes; en rojo, lo que el dueño tiene que mirar antes
              de aprobar. */}
          {propuestas.map((p) => (
            <PlacaRoja
              key={p.id}
              titulo="Precios nuevos"
              sub={
                <>
                  <span className="block">{p.titulo}</span>
                  <span className="block">{p.proveedor?.razon_social ?? 'Sin proveedor'} · lo armó {p.autor?.nombre ?? 'alguien'}</span>
                </>
              }
              renglones={(p.items ?? []).map((i: any, n: number) => {
                const sube = Number(i.costo_nuevo) > Number(i.costo_anterior ?? 0);
                const avisos = [!i.aplicar_precio && 'no se toca el precio', i.detalle?.vendeBajoCosto && 'queda bajo costo'].filter(Boolean);
                return {
                  clave: i.producto?.sku ?? String(n),
                  nombre: (
                    <>
                      {i.producto?.nombre}{' '}
                      <span className="whitespace-nowrap text-xs font-normal text-tinta/60">· {i.producto?.sku}</span>
                    </>
                  ),
                  detalle: (
                    <>
                      <span className="block">
                        costo {pesos(i.costo_anterior)} → <span className={sube ? 'font-medium text-marca-hondo' : 'font-medium text-ok'}>{pesos(i.costo_nuevo)}</span>
                        {' · '}margen {numero(i.margen_pct, 2)} %
                      </span>
                      {i.aplicar_precio && <span className="block">antes {pesos(i.precio_anterior)}</span>}
                    </>
                  ),
                  // si el precio no se toca no hay precio nuevo que mostrar: lo dice el renglón en rojo
                  importe: i.aplicar_precio ? pesos(i.precio_sugerido) : undefined,
                  destacado: avisos.length ? avisos.join(' · ') : undefined,
                };
              })}
              recuadro={p.notas ? <span className="text-tinta/70">{p.notas}</span> : undefined}
              acciones={
                <>
                  <Boton variante="peligro" onClick={() => decidir(p.id, 'rechazar')} disabled={!!trabajando}>
                    Rechazar
                  </Boton>
                  {esDueno ? (
                    <Boton variante="ok" onClick={() => decidir(p.id, 'aprobar')} disabled={!!trabajando}>
                      {trabajando === p.id ? 'Aplicando…' : 'Aprobar y aplicar'}
                    </Boton>
                  ) : (
                    <span className="text-xs text-tinta/60">Solo el dueño puede aprobar</span>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
      {dialogo}
    </div>
  );
}

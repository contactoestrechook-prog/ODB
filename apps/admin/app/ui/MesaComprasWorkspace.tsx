'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { prepararComprobante } from './comprimirImagen';

// Mesa de compras: el comprador negocia con el proveedor y acá saca el costo
// real. El sistema hace las cuentas; el analista razona, pregunta y arma la
// propuesta. Nada se aplica hasta que el dueño aprueba.
type Mensaje = { rol: 'usuario' | 'asistente'; texto: string; imagen?: string; mimeType?: string; nombre?: string };

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));

export function MesaComprasWorkspace({ esDueno }: { esDueno: boolean }) {
  const [tab, setTab] = useState<'costear' | 'aprobar'>('costear');
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState<{ base64: string; mimeType: string; nombre: string } | null>(null);
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [trabajando, setTrabajando] = useState('');
  const finRef = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

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
      setMensajes((xs) => [...xs, { rol: 'asistente', texto: j.respuesta ?? '' }]);
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
      motivo = window.prompt('¿Por qué se rechaza? Queda registrado.') ?? '';
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
      <div className="flex gap-1.5 border-b border-black/10">
        {([['costear', 'Costear una compra'], ['aprobar', `Para aprobar${propuestas.length ? ` (${propuestas.length})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>
            {l}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-[#B82D25]/10 border border-[#B82D25]/30 px-3 py-2 text-sm text-[#932A1F]">{error}</p>}

      {tab === 'costear' && (
        <div className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10">
            <p className="text-sm font-medium text-black">Analista de compras</p>
            <p className="text-xs text-black/50 mt-0.5">
              Contale la oferta como se la dijo el proveedor. Las cuentas las hace el sistema, no la IA.
            </p>
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-4 space-y-3">
            {mensajes.length === 0 && (
              <div className="text-sm text-black/45 space-y-2">
                <p>Por ejemplo:</p>
                <p className="italic">
                  «Cepas me ofrece el Malbec en caja de 6 a $54.000 sin IVA. Me hace 10% y después
                  otro 5% por volumen. El flete son $25.000. Pago a 30 días.»
                </p>
                <p>También podés dictarlo con el micrófono, o adjuntarle la lista del proveedor: foto, PDF o planilla de Excel.</p>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex ${m.rol === 'usuario' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.rol === 'usuario' ? 'bg-black text-[#F0EBE2]' : 'bg-[#F0EBE2] text-black'}`}>
                  {m.imagen && <p className="text-xs opacity-70 mb-1">📎 {m.nombre ?? 'Adjunto'}</p>}
                  {m.texto}
                </div>
              </div>
            ))}
            {pensando && <p className="text-sm text-black/40">Sacando cuentas…</p>}
            <div ref={finRef} />
          </div>

          <div className="border-t border-black/10 p-3 space-y-2">
            {foto && (
              <div className="flex items-center gap-2 text-xs text-black/60">
                <span>📎 {foto.nombre}</span>
                <button onClick={() => setFoto(null)} className="underline">quitar</button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={archivoRef} type="file" accept="image/*,.pdf,.xlsx,.xls,.xlsm,.csv" className="hidden"
                onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
              <button onClick={() => archivoRef.current?.click()} title="Adjuntar la lista del proveedor (foto, PDF o Excel)"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm hover:bg-[#F0EBE2]">📎</button>
              <BotonMicrofono onTexto={setTexto} titulo="Dictarle al analista" />
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                rows={2}
                placeholder="Contale la oferta…"
                className="flex-1 resize-none rounded-lg border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
              />
              <button onClick={() => enviar()} disabled={pensando || (!texto.trim() && !foto)}
                className="rounded-lg bg-[#B82D25] px-4 py-2.5 text-sm font-medium text-white active:scale-95 disabled:opacity-40">
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'aprobar' && (
        <div className="space-y-3">
          {propuestas.length === 0 && (
            <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-black/45">
              No hay nada esperando aprobación.
            </p>
          )}
          {propuestas.map((p) => (
            <div key={p.id} className="rounded-xl bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-black/10">
                <p className="text-sm font-semibold text-black">{p.titulo}</p>
                <p className="text-xs text-black/50 mt-0.5">
                  {p.proveedor?.razon_social ?? 'Sin proveedor'} · lo armó {p.autor?.nombre ?? 'alguien'}
                </p>
                {p.notas && <p className="text-sm text-black/70 mt-2">{p.notas}</p>}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F0EBE2] text-black/60">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Producto</th>
                      <th className="text-right px-3 py-2 font-medium">Costo</th>
                      <th className="text-right px-3 py-2 font-medium">Precio de venta</th>
                      <th className="text-right px-4 py-2 font-medium">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(p.items ?? []).map((i: any) => {
                      const sube = Number(i.costo_nuevo) > Number(i.costo_anterior ?? 0);
                      return (
                        <tr key={i.producto?.sku} className="border-t border-black/5">
                          <td className="px-4 py-2.5">
                            <span className="text-black">{i.producto?.nombre}</span>
                            <span className="text-black/40 text-xs"> · {i.producto?.sku}</span>
                            {i.detalle?.vendeBajoCosto && (
                              <span className="ml-2 rounded-full bg-[#B82D25]/10 px-2 py-0.5 text-[10px] font-bold text-[#B82D25] uppercase">
                                queda bajo costo
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            <span className="text-black/40">{pesos(i.costo_anterior)}</span>
                            <span className="text-black/30"> → </span>
                            <span className={sube ? 'text-[#B82D25] font-medium' : 'text-emerald-700 font-medium'}>
                              {pesos(i.costo_nuevo)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {i.aplicar_precio ? (
                              <>
                                <span className="text-black/40">{pesos(i.precio_anterior)}</span>
                                <span className="text-black/30"> → </span>
                                <span className="text-black font-medium">{pesos(i.precio_sugerido)}</span>
                              </>
                            ) : (
                              <span className="text-black/40">no se toca</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-black/60">{i.margen_pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-black/10 flex items-center justify-end gap-2">
                <button onClick={() => decidir(p.id, 'rechazar')} disabled={!!trabajando}
                  className="rounded-lg border border-black/15 px-4 py-2 text-sm hover:bg-[#F0EBE2] disabled:opacity-40">
                  Rechazar
                </button>
                {esDueno ? (
                  <button onClick={() => decidir(p.id, 'aprobar')} disabled={!!trabajando}
                    className="rounded-lg bg-[#B82D25] px-5 py-2 text-sm font-medium text-white active:scale-95 disabled:opacity-40">
                    {trabajando === p.id ? 'Aplicando…' : 'Aprobar y aplicar'}
                  </button>
                ) : (
                  <span className="text-xs text-black/45">Solo el dueño puede aprobar</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

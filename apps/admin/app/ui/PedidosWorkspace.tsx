'use client';

import { useEffect, useRef, useState } from 'react';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const CANALES: Record<string, { label: string; cls: string }> = {
  whatsapp: { label: 'WhatsApp', cls: 'bg-emerald-100 text-emerald-800' },
  app: { label: 'App', cls: 'bg-black text-white' },
  self_checkout: { label: 'App', cls: 'bg-black text-white' },
  web: { label: 'Web', cls: 'bg-blue-100 text-blue-800' },
  pedidosya: { label: 'PedidosYa', cls: 'bg-[#B82D25] text-white' },
  pickup: { label: 'Pick-up', cls: 'bg-amber-100 text-amber-900' },
  domicilio: { label: 'Domicilio', cls: 'bg-purple-100 text-purple-800' },
  mostrador: { label: 'Mostrador', cls: 'bg-[#F0EBE2] text-black/60' },
};
const canalDe = (p: any) => p.origen || p.canal;
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-7 flex-wrap">
          <div><p className="text-xl font-semibold leading-none text-black">{pedidos.length}</p><p className="text-[11px] text-black/45 mt-1">Pedidos activos</p></div>
          {Object.entries(porCanal).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => (
            <div key={c}><p className="text-xl font-semibold leading-none text-black">{n}</p><p className="text-[11px] text-black/45 mt-1">{CANALES[c]?.label ?? c}</p></div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setWa(true)} className="rounded-full bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-emerald-700">📱 Pedido por WhatsApp</button>
          <button onClick={() => post({ simular: true })} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2.5 hover:border-black/40">Simular PedidosYa</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {['todos', 'whatsapp', 'app', 'web', 'pedidosya', 'pickup', 'domicilio', 'mostrador'].map((c) => (
          <button key={c} onClick={() => setFiltro(c)} className={`text-xs font-medium rounded-full px-3 py-1.5 border ${filtro === c ? 'bg-[#B82D25] text-white border-[#B82D25]' : 'bg-white border-black/10 text-black/60 hover:border-black/30'}`}>
            {c === 'todos' ? 'Todos' : CANALES[c]?.label ?? c}
          </button>
        ))}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      <div className="grid md:grid-cols-3 gap-4">
        {cols.map(([titulo, lista]) => (
          <div key={titulo} className="space-y-2">
            <h2 className="text-sm font-medium text-black/70 px-1 flex items-center justify-between">{titulo}<span className="text-xs text-black/40">{lista.length}</span></h2>
            {lista.length === 0 && <p className="rounded-xl bg-white/60 p-5 text-center text-black/35 text-xs">Vacío</p>}
            {lista.map((p) => {
              const c = canalDe(p); const sig = siguiente(p); const tarde = p.minutos > 20;
              return (
                <div key={p.id} className="rounded-xl bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${CANALES[c]?.cls ?? 'bg-[#F0EBE2] text-black/60'}`}>{CANALES[c]?.label ?? c}</span>
                    <span className={`text-[11px] ${tarde ? 'text-[#B82D25] font-semibold' : 'text-black/40'}`}>{p.minutos}′</span>
                  </div>
                  <p className="text-sm font-medium text-black mt-1.5">{p.cliente?.dni ? `Cliente ${p.cliente.dni}` : 'Consumidor final'}{p.cliente?.tipo ? ` · ${p.cliente.tipo}` : ''}</p>
                  <p className="text-xs text-black/55 mt-0.5 leading-snug">
                    {(p.items ?? []).slice(0, 3).map((it: any) => `${Math.round(Number(it.cantidad))}× ${it.producto?.nombre ?? ''}`).join(' · ')}
                    {(p.items ?? []).length > 3 && ` +${p.items.length - 3}`}
                  </p>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="font-semibold text-sm text-black">{pesos(p.total)}</span>
                    {sig && <button onClick={() => post({ pedidoId: p.id, estado: sig.estado })} className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-3.5 py-1.5 hover:bg-[#932A1F]">{sig.label}</button>}
                  </div>
                </div>
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
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'waAnalizar', texto: texto.trim() }) });
    const d = await r.json();
    if (!r.ok) setAviso(d.message ?? 'Error'); else setAnalisis(d);
    setCargando(false);
  };
  const crear = async () => {
    setCargando(true);
    const items = (analisis.items ?? []).map((i: any) => ({ producto_id: i.producto_id, cantidad: i.cantidad }));
    const d = await post({ accion: 'waCrear', items, nombre: analisis.nombre, notas: analisis.notas });
    setCargando(false);
    if (d) cerrar();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto">
        <h2 className="font-semibold text-black text-lg">Pedido por WhatsApp</h2>
        <p className="text-xs text-black/50">Pegá (o dictá) el mensaje del cliente. La IA arma el pedido y lo matchea con el catálogo.</p>
        <div className="flex items-center gap-2">
          <button onClick={dictar} disabled={escuchando} className={`rounded-full text-xs font-medium px-3 py-1.5 border ${escuchando ? 'bg-[#B82D25] text-white border-[#B82D25] animate-pulse' : 'border-black/15 hover:bg-black/[0.03]'}`}>{escuchando ? '● Escuchando…' : '🎤 Dictar'}</button>
          <span className="text-[11px] text-black/40">o pegá abajo</span>
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="ej: Hola! me mandás 6 quilmes litro, 2 coca de 2.25 y un fernet? Para Av. Mate 123, pago en efectivo" className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" />
        {!analisis && <div className="flex justify-end gap-3"><button onClick={cerrar} className="text-sm text-black/60 px-4 py-2">Cancelar</button><button onClick={analizar} disabled={cargando || !texto.trim()} className="rounded-full bg-black text-white text-sm font-medium px-5 py-2 disabled:opacity-50">{cargando ? 'Leyendo…' : 'Interpretar'}</button></div>}

        {analisis && (
          <div className="rounded-xl border border-black/10 p-3 space-y-2">
            {analisis.nombre && <p className="text-sm"><b>Cliente:</b> {analisis.nombre}</p>}
            <p className="text-xs text-black/50">{analisis.items.length} producto(s) reconocido(s):</p>
            {analisis.items.map((it: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <input type="number" value={it.cantidad} onChange={(e) => setAnalisis((a: any) => ({ ...a, items: a.items.map((x: any, j: number) => j === i ? { ...x, cantidad: Number(e.target.value) } : x) }))} className="w-14 rounded border border-black/15 px-2 py-1 text-right" />
                <span className="flex-1">{it.match} <span className="text-xs text-black/40">(pidió: {it.pedido})</span></span>
                <button onClick={() => setAnalisis((a: any) => ({ ...a, items: a.items.filter((_: any, j: number) => j !== i) }))} className="text-black/30 hover:text-[#B82D25]">✕</button>
              </div>
            ))}
            {analisis.sinMatch?.length > 0 && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">No encontré en el catálogo: {analisis.sinMatch.join(', ')}</p>}
            {analisis.notas && <p className="text-xs text-black/50"><b>Nota:</b> {analisis.notas}</p>}
            {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setAnalisis(null)} className="text-sm text-black/60 px-4 py-2">Volver</button>
              <button onClick={crear} disabled={cargando || !analisis.items.length} className="rounded-full bg-emerald-600 text-white text-sm font-medium px-5 py-2 hover:bg-emerald-700 disabled:opacity-50">{cargando ? 'Creando…' : 'Crear pedido'}</button>
            </div>
          </div>
        )}
        {aviso && !analisis && <p className="text-xs text-[#B82D25]">{aviso}</p>}
      </div>
    </div>
  );
}

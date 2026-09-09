'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Dictado } from './Dictado';

// "Esto está mal": desde cualquier pantalla, la persona cuenta (escrito o
// dictado) qué esperaba. El sistema adjunta solo la pantalla, la dirección y
// el texto visible; la IA clasifica en el acto (dato / sistema / duda) y
// contesta. Los de sistema le llegan a Leandro como tarea y, al resolverse,
// la persona recibe el aviso en su campanita. Pedido de Leandro, 2026-09-09.
const SIN_BOTON = ['/login', '/olvide-clave', '/restablecer', '/whatsapp'];

export function ReportarProblema() {
  const ruta = usePathname() ?? '';
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: string; respuesta: string } | null>(null);
  const [error, setError] = useState('');
  if (SIN_BOTON.some((p) => ruta.startsWith(p))) return null;

  const enviar = async () => {
    if (texto.trim().length < 3 || enviando) return;
    setEnviando(true); setError('');
    try {
      const main = document.querySelector('main') ?? document.body;
      const r = await fetch('/api/reportes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto.trim(),
          pantalla: document.title.replace(/\s*[·—-]\s*O\.D\.B.*$/i, '').trim() || document.title,
          url: location.href,
          contexto: { texto: (main as HTMLElement).innerText.slice(0, 4000), ancho: window.innerWidth, navegador: navigator.userAgent.slice(0, 120), hora: new Date().toISOString() },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? 'No se pudo enviar');
      setResultado({ tipo: d.tipo, respuesta: d.respuesta });
      setTexto('');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar'); }
    setEnviando(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setAbierto(true); setResultado(null); setError(''); }}
        title="Contanos qué está mal en esta pantalla"
        className="fixed bottom-4 left-4 z-40 rounded-full border border-black/10 bg-white/95 px-3 py-2 text-xs font-semibold text-black/70 shadow-lg backdrop-blur hover:text-[#B82D25] hover:border-[#B82D25]/40 print:hidden"
      >
        Esto está mal
      </button>
      {abierto && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => !enviando && setAbierto(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {!resultado ? (
              <>
                <p className="text-[11px] uppercase tracking-wider text-black/45">Esta pantalla</p>
                <h2 className="mt-0.5 text-lg font-bold text-black">¿Qué está mal?</h2>
                <p className="mt-1 text-sm text-black/60">Contá qué esperabas ver o qué hizo distinto el sistema. La pantalla y los datos se adjuntan solos.</p>
                <textarea
                  value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} autoFocus
                  placeholder="ej. leyó 12 unidades y en la factura dice 72 · el total del renglón no coincide · no me deja cobrar con tarjeta"
                  className="mt-3 w-full rounded-xl border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Dictado onTexto={(t) => setTexto((v) => (v ? v + ' ' : '') + t)} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setAbierto(false)} disabled={enviando} className="rounded-xl border border-black/10 px-3 py-2 text-sm text-black/60">Cancelar</button>
                    <button type="button" onClick={enviar} disabled={enviando || texto.trim().length < 3} className="rounded-xl bg-[#B82D25] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {enviando ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                </div>
                {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-wider text-black/45">
                  {resultado.tipo === 'sistema' ? 'Le llega a Leandro' : resultado.tipo === 'dato' ? 'Se resuelve acá' : 'Respuesta'}
                </p>
                <h2 className="mt-0.5 text-lg font-bold text-black">Gracias por avisar</h2>
                <p className="mt-2 text-sm leading-relaxed text-black">{resultado.respuesta}</p>
                <button type="button" onClick={() => setAbierto(false)} className="mt-4 w-full rounded-xl bg-black py-2.5 text-sm font-semibold text-white">Listo</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

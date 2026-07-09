'use client';

import { useEffect, useRef, useState } from 'react';

type Turno = { de: 'cliente' | 'bot'; texto: string; hora: string };

const telAlAzar = () => `11${Math.floor(10000000 + Math.random() * 89999999)}`;
const hora = () => new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

// Simulador del bot de WhatsApp: habla con el MISMO cerebro que atiende a los
// clientes (Opus + herramientas + memoria). Ojo: los pedidos que confirmes acá
// son pedidos REALES en el sistema.
export default function BotSimulador() {
  const [linea, setLinea] = useState<'pedidos' | 'proveedores'>('pedidos');
  const [telefono, setTelefono] = useState(telAlAzar());
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turnos, pensando]);

  async function enviar() {
    const msj = texto.trim();
    if (!msj || pensando) return;
    setTexto('');
    setError('');
    setTurnos((t) => [...t, { de: 'cliente', texto: msj, hora: hora() }]);
    setPensando(true);
    try {
      const r = await fetch('/api/bot-charla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linea, telefono, mensaje: msj }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'El bot no pudo responder');
      setTurnos((t) => [...t, { de: 'bot', texto: d.respuesta, hora: hora() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El bot no pudo responder');
    } finally {
      setPensando(false);
      inputRef.current?.focus();
    }
  }

  async function nuevaConversacion() {
    const nuevo = telAlAzar();
    await fetch(`/api/bot-charla?linea=${linea}&telefono=${telefono}`, { method: 'DELETE' }).catch(() => {});
    setTelefono(nuevo);
    setTurnos([]);
    setError('');
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10">
      {/* controles del simulador */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-black/10 bg-white p-1">
          {(['pedidos', 'proveedores'] as const).map((l) => (
            <button
              key={l}
              onClick={() => { setLinea(l); setTurnos([]); setTelefono(telAlAzar()); }}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize ${linea === l ? 'bg-black text-white' : 'text-black/60'}`}
            >
              Línea {l}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-black/60">
          Teléfono simulado
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))}
            className="w-32 rounded-lg border border-black/10 bg-white px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <button
          onClick={nuevaConversacion}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-black/70 hover:bg-black/5"
        >
          ↺ Nueva conversación
        </button>
        <span className="text-xs text-black/40">Los pedidos confirmados acá son reales.</span>
      </div>

      {/* el "teléfono" */}
      <div className="overflow-hidden rounded-2xl border border-black/10 shadow-sm">
        <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg">
            {linea === 'pedidos' ? '🍷' : '📄'}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">
              O.D.B {linea === 'pedidos' ? 'Pedidos' : 'Proveedores'}
            </p>
            <p className="text-xs text-white/70">{pensando ? 'escribiendo…' : 'en línea'}</p>
          </div>
        </div>

        <div className="h-[52vh] space-y-2 overflow-y-auto bg-[#ECE5DD] p-4">
          {turnos.length === 0 && !pensando && (
            <p className="pt-16 text-center text-sm text-black/40">
              Escribile como si fueras un {linea === 'pedidos' ? 'cliente' : 'proveedor'} —
              {linea === 'pedidos'
                ? ' probá "hola, ¿qué fernet tenés?" o "recomendame un vino para un asado"'
                : ' probá "hola, les mando la factura de esta semana"'}
            </p>
          )}
          {turnos.map((t, i) => (
            <div key={i} className={`flex ${t.de === 'cliente' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[15px] leading-snug shadow-sm ${
                  t.de === 'cliente' ? 'rounded-br-sm bg-[#DCF8C6]' : 'rounded-bl-sm bg-white'
                }`}
              >
                {t.texto}
                <span className="mt-1 block text-right text-[10px] text-black/35">{t.hora}</span>
              </div>
            </div>
          ))}
          {pensando && (
            <div className="flex justify-start">
              <div className="rounded-xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
                <span className="inline-flex gap-1">
                  <i className="h-2 w-2 animate-bounce rounded-full bg-black/30 [animation-delay:0ms]" />
                  <i className="h-2 w-2 animate-bounce rounded-full bg-black/30 [animation-delay:150ms]" />
                  <i className="h-2 w-2 animate-bounce rounded-full bg-black/30 [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          {error && <p className="text-center text-sm text-[#B82D25]">{error}</p>}
          <div ref={finRef} />
        </div>

        <div className="flex items-center gap-2 bg-[#F0F0F0] px-3 py-2">
          <input
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar()}
            placeholder="Escribí un mensaje"
            autoFocus
            className="flex-1 rounded-full border border-black/10 bg-white px-4 py-2.5 text-[15px] outline-none"
          />
          <button
            onClick={enviar}
            disabled={pensando || !texto.trim()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-40"
            aria-label="Enviar"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

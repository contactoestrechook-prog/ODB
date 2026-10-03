'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { Boton, Chips, Entrada, FOCO, Tarjeta, unir } from './kit';

// La tarjeta Placa roja que acompaña la respuesta (resumen, pedido, precios):
// la misma imagen y el mismo epígrafe que le llegan al cliente por WhatsApp.
// Desde el 3/10/2026 son páginas cuadradas: una, o varias si el pedido es largo.
type TarjetaWhatsapp = { imagenes: string[]; pie: string };
type Turno = { de: 'cliente' | 'bot'; texto: string; hora: string; tarjeta?: TarjetaWhatsapp | null };

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
      const imagenes: string[] = Array.isArray(d.tarjeta?.imagenes) && d.tarjeta.imagenes.length
        ? d.tarjeta.imagenes.map(String)
        : d.tarjeta?.imagenUrl ? [String(d.tarjeta.imagenUrl)] : [];
      const tarjeta: TarjetaWhatsapp | null = imagenes.length ? { imagenes, pie: String(d.tarjeta.pie ?? '') } : null;
      setTurnos((t) => [...t, { de: 'bot', texto: d.respuesta, hora: hora(), tarjeta }]);
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
    <div className="space-y-3">
      {/* controles del simulador */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Chips
          etiquetaAccesible="Línea del bot"
          valor={linea}
          onCambiar={(l) => { setLinea(l); setTurnos([]); setTelefono(telAlAzar()); }}
          opciones={(['pedidos', 'proveedores'] as const).map((l) => ({ valor: l, etiqueta: <span className="capitalize">Línea {l}</span> }))}
        />
        <label className="flex items-center gap-2 text-sm text-tinta/70">
          Teléfono simulado
          <span className="block w-40">
            <Entrada
              value={telefono}
              onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              className="font-mono"
            />
          </span>
        </label>
        <Boton variante="secundario" tamano="chico" onClick={nuevaConversacion}>
          Nueva conversación
        </Boton>
      </div>
      <p className="text-sm font-medium text-atencion">Los pedidos confirmados acá son reales.</p>

      {/* el "teléfono" */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <div className="flex items-center gap-3 bg-tinta px-4 py-3 text-white">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold tracking-wide" aria-hidden="true">
            ODB
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              O.D.B {linea === 'pedidos' ? 'Pedidos' : 'Proveedores'}
            </p>
            <p className="text-xs text-white/70">{pensando ? 'escribiendo…' : 'en línea'}</p>
          </div>
        </div>

        <div className="h-[52dvh] min-h-72 space-y-2 overflow-y-auto bg-crema p-3 sm:p-4" aria-live="polite">
          {turnos.length === 0 && !pensando && (
            <p className="px-2 pt-16 text-center text-sm text-tinta/60">
              Escribile como si fueras un {linea === 'pedidos' ? 'cliente' : 'proveedor'} —
              {linea === 'pedidos'
                ? ' probá "hola, ¿qué fernet tenés?" o "recomendame un vino para un asado"'
                : ' probá "hola, les mando la factura de esta semana"'}
            </p>
          )}
          {turnos.map((t, i) => (
            <div key={i} className={`flex ${t.de === 'cliente' ? 'justify-end' : 'justify-start'}`}>
              {t.tarjeta ? (
                // Como le llega al cliente (2/10/2026): la tarjeta Placa roja con su
                // epígrafe, no el texto. El texto que escribió el bot queda a mano
                // para revisarlo.
                <div className="w-80 max-w-[85%] rounded-2xl rounded-bl-md bg-white p-1 text-base leading-snug text-tinta shadow-tarjeta">
                  {t.tarjeta.imagenes.map((url, k) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={unir('block overflow-hidden rounded-xl', k > 0 && 'mt-1', FOCO)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={t.tarjeta!.imagenes.length > 1
                          ? `Tarjeta que recibe el cliente por WhatsApp, página ${k + 1} de ${t.tarjeta!.imagenes.length} (abrir en grande)`
                          : 'Tarjeta que recibe el cliente por WhatsApp (abrir en grande)'}
                        className="block h-auto w-full"
                        onLoad={() => i === turnos.length - 1 && finRef.current?.scrollIntoView({ behavior: 'smooth' })}
                      />
                    </a>
                  ))}
                  <div className="px-2 pb-1 pt-1.5">
                    {t.tarjeta.pie && <p className="whitespace-pre-wrap break-words">{t.tarjeta.pie}</p>}
                    <details className="mt-1">
                      <summary className={unir('cursor-pointer text-xs font-medium text-tinta/60', FOCO)}>Texto que escribió el bot</summary>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-tinta/70">{t.texto}</p>
                    </details>
                    <span className="mt-1 block text-right text-xs text-tinta/60">{t.hora}</span>
                  </div>
                </div>
              ) : (
                <div
                  className={unir(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-base leading-snug text-tinta shadow-tarjeta sm:max-w-[80%]',
                    t.de === 'cliente' ? 'rounded-br-md bg-ok-suave' : 'rounded-bl-md bg-white',
                  )}
                >
                  {t.texto}
                  <span className="mt-1 block text-right text-xs text-tinta/60">{t.hora}</span>
                </div>
              )}
            </div>
          ))}
          {pensando && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-tarjeta">
                <span className="inline-flex gap-1" aria-label="El bot está escribiendo">
                  <i className="size-2 animate-bounce rounded-full bg-tinta/30 [animation-delay:0ms]" />
                  <i className="size-2 animate-bounce rounded-full bg-tinta/30 [animation-delay:150ms]" />
                  <i className="size-2 animate-bounce rounded-full bg-tinta/30 [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          {error && <p className="text-center text-sm font-medium text-marca-hondo" role="alert">{error}</p>}
          <div ref={finRef} />
        </div>

        <div className="flex items-center gap-2 border-t border-black/[0.06] bg-white px-3 py-2">
          <Entrada
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar()}
            placeholder="Escribí un mensaje o hablá 🎤"
            aria-label="Mensaje para el bot"
            autoFocus
            className="min-w-0 flex-1"
          />
          <BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Hablar" />
          <button
            onClick={enviar}
            disabled={pensando || !texto.trim()}
            className={unir(
              'flex size-11 shrink-0 items-center justify-center rounded-full bg-marca text-white transition-colors hover:bg-marca-hondo disabled:opacity-40',
              FOCO,
            )}
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </Tarjeta>
    </div>
  );
}

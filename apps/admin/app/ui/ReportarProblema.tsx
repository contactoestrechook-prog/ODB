'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Dictado } from './Dictado';
import { llevaFlotantes } from '../lib/rutas';
import { AreaTexto, Aviso, Boton, Modal } from './kit';

// "Esto está mal": desde cualquier pantalla, la persona cuenta (escrito o
// dictado) qué esperaba. El sistema adjunta solo la pantalla, la dirección y
// el texto visible; la IA clasifica en el acto (dato / sistema / duda) y
// contesta. Los de sistema le llegan a Leandro como tarea y, al resolverse,
// la persona recibe el aviso en su campanita. Pedido de Leandro, 2026-09-09.
//
// Capas (A7): el botón va en z-barra-inferior, debajo de la barra negra y del
// menú; se esconde si la pantalla tiene una BarraInferior (Cobrar, Guardar) o
// si hay un modal o el cajón abiertos (globals.css). En escritorio se corre a
// la derecha de la barra lateral, que si no lo tapa.
export function ReportarProblema() {
  const ruta = usePathname() ?? '';
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: string; respuesta: string } | null>(null);
  const [error, setError] = useState('');
  if (!llevaFlotantes(ruta)) return null;

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

  const cerrar = () => { if (!enviando) setAbierto(false); };
  const rotulo = !resultado
    ? 'Esta pantalla'
    : resultado.tipo === 'sistema' ? 'Le llega a Leandro' : resultado.tipo === 'dato' ? 'Se resuelve acá' : 'Respuesta';

  return (
    <>
      <button
        type="button"
        onClick={() => { setAbierto(true); setResultado(null); setError(''); }}
        title="Contanos qué está mal en esta pantalla"
        className="flotante-reportar flotante-ocultable fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-barra-inferior inline-flex min-h-10 items-center rounded-full border border-black/10 bg-white/95 px-4 text-xs font-semibold text-tinta/70 shadow-flotante backdrop-blur transition-colors hover:border-marca/40 hover:text-marca focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marca/15 print:hidden lg:left-68"
      >
        Esto está mal
      </button>

      <Modal
        abierto={abierto}
        onCerrar={cerrar}
        bloquearCierre={enviando}
        ancho="chico"
        titulo={
          <>
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">{rotulo}</span>
            {resultado ? 'Gracias por avisar' : '¿Qué está mal?'}
          </>
        }
        pie={
          resultado ? (
            <Boton anchoCompleto onClick={() => setAbierto(false)}>Listo</Boton>
          ) : (
            <>
              <Boton variante="secundario" onClick={cerrar} disabled={enviando}>Cancelar</Boton>
              <Boton onClick={enviar} cargando={enviando} disabled={texto.trim().length < 3}>
                {enviando ? 'Enviando…' : 'Enviar'}
              </Boton>
            </>
          )
        }
      >
        {resultado ? (
          <p className="text-sm leading-relaxed text-tinta">{resultado.respuesta}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-tinta/70">
              Contá qué esperabas ver o qué hizo distinto el sistema. La pantalla y los datos se adjuntan solos.
            </p>
            <AreaTexto
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              autoFocus
              aria-label="Qué está mal"
              placeholder="ej. leyó 12 unidades y en la factura dice 72 · el total del renglón no coincide · no me deja cobrar con tarjeta"
            />
            <Dictado onTexto={(t) => setTexto((v) => (v ? v + ' ' : '') + t)} />
            {error && <Aviso tono="error">{error}</Aviso>}
          </div>
        )}
      </Modal>
    </>
  );
}

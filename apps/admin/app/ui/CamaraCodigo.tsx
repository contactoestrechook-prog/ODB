'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Modal } from './kit';

// El escáner de códigos con la cámara, en un solo lugar: lo usan el arqueo y
// la carga de facturas (vincular el renglón por código de barras, 9/11/2026).
export const vibrar = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* no todos vibran */ } };

// Cámara del celular: usa el lector de códigos que trae el navegador (Chrome en
// Android). Donde no existe (iPhone), se avisa y se usa el lector o el nombre.
export function CamaraCodigo({ onCodigo, onCerrar }: { onCodigo: (c: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // la pantalla de atrás se redibuja seguido (la factura recalcula todo): la
  // cámara no se reinicia por eso, lee siempre el último onCodigo
  const avisar = useRef(onCodigo);
  avisar.current = onCodigo;
  useEffect(() => {
    let flujo: MediaStream | null = null; let vivo = true; let t: any;
    const Detector = (globalThis as any).BarcodeDetector;
    if (!Detector) { setError('Este celular no lee códigos con la cámara desde el navegador (pasa en iPhone). Usá el lector de mano o escribí el nombre.'); return; }
    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current) return;
        video.current.srcObject = flujo; await video.current.play();
        const det = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
        const mirar = async () => {
          if (!vivo || !video.current) return;
          try {
            const r = await det.detect(video.current);
            const c = r?.[0]?.rawValue;
            if (c) { vibrar(60); avisar.current(String(c)); return; }
          } catch { /* cuadro sin código */ }
          t = setTimeout(mirar, 180);
        };
        mirar();
      } catch {
        setError('No pude abrir la cámara. Fijate que el navegador tenga permiso de cámara para esta página.');
      }
    })();
    return () => { vivo = false; clearTimeout(t); flujo?.getTracks().forEach((x) => x.stop()); };
  }, []);
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Apuntá al código de barras" ancho="chico" pie={<Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>}>
      {error ? <Aviso tono="atencion">{error}</Aviso> : (
        <div className="relative overflow-hidden rounded-xl bg-tinta">
          <video ref={video} playsInline muted className="aspect-[3/4] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-marca" />
        </div>
      )}
    </Modal>
  );
}


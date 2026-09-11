"use client";

import { useEffect, useState } from "react";

type Aviso = { prompt: () => void; userChoice: Promise<{ outcome: string }> };

// Botón para instalar la tienda como app en el celular o la compu.
// - Chrome, Edge y Android: se instala con un toque (usa el aviso que guardó RegistroApp).
// - iPhone (Safari): Apple no deja instalar con un botón; se muestran los dos pasos.
// - Si ya está instalada, lo dice en vez de ofrecerla de nuevo.
export function InstalarApp() {
  const [instalada, setInstalada] = useState(false);
  const [lista, setLista] = useState(false);
  const [pasos, setPasos] = useState(false);
  const [iphone, setIphone] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) { setInstalada(true); return; }
    setIphone(/iPhone|iPad|iPod/.test(navigator.userAgent));
    if ((window as unknown as { __odbInstalar?: Aviso }).__odbInstalar) setLista(true);
    const alListo = () => setLista(true);
    const alInstalar = () => setInstalada(true);
    window.addEventListener("odb-instalable", alListo);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("odb-instalable", alListo);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  if (instalada) {
    return <p className="text-[14px] font-bold text-white/90">Ya tenés la app instalada en este dispositivo.</p>;
  }

  const instalar = async () => {
    const aviso = (window as unknown as { __odbInstalar?: Aviso }).__odbInstalar;
    if (!aviso || iphone) { setPasos((v) => !v); return; }
    aviso.prompt();
    await aviso.userChoice.catch(() => null);
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={instalar}
        className="inline-flex items-center gap-2.5 rounded-full bg-white px-6 h-12 text-[14px] font-extrabold text-ink hover:bg-crema transition-colors"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
        {lista && !iphone ? "Instalar la app ODB" : "Cómo instalar la app ODB"}
      </button>
      {pasos && (
        <ol className="mt-4 space-y-1.5 text-[14px] text-white/85 list-decimal pl-5 max-w-[46ch]">
          {iphone ? (
            <>
              <li>Tocá el botón Compartir de Safari, el cuadrado con la flecha hacia arriba.</li>
              <li>Elegí “Agregar a inicio”. Queda el ícono de ODB junto a tus apps.</li>
            </>
          ) : (
            <>
              <li>Abrí el menú del navegador, los tres puntos.</li>
              <li>Elegí “Instalar app” o “Agregar a la pantalla principal”.</li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}

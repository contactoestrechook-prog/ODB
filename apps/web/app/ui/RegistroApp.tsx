"use client";

import { useEffect } from "react";

// Registra el service worker mínimo (sw.js) y guarda el aviso del navegador de
// que la tienda se puede instalar, para que el botón "Instalar la app" lo use
// cuando la persona quiera, y no cuando el navegador decida.
export function RegistroApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const guardar = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __odbInstalar?: Event }).__odbInstalar = e;
      window.dispatchEvent(new Event("odb-instalable"));
    };
    window.addEventListener("beforeinstallprompt", guardar);
    return () => window.removeEventListener("beforeinstallprompt", guardar);
  }, []);
  return null;
}

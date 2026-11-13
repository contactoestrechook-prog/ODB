"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IDIOMAS, MONEDAS, t, usePreferencias, type Idioma, type Moneda } from "./lib/textos";

// La barra de arriba de todas las pantallas del cliente: «Volver» siempre a
// la vista, y el idioma y la moneda a un toque.
export function Barra() {
  const path = usePathname();
  const router = useRouter();
  const { idioma, moneda, setIdioma, setMoneda } = usePreferencias();
  const esInicio = path === "/";

  // dentro de una mesa, «Volver» lleva al inicio de esa mesa; si no, atrás
  const mesa = path.match(/^\/mesa\/([^/]+)\/.+/);
  function volver() {
    if (mesa) router.push(`/mesa/${mesa[1]}`);
    else if (window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-line">
      <div className="max-w-md mx-auto px-4 h-12 flex items-center gap-2">
        {esInicio || /^\/mesa\/[^/]+$/.test(path) ? (
          <Link href={path} className="display font-bold text-[15px] flex-1 truncate">Gran Caminito</Link>
        ) : (
          <button onClick={volver} className="flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-md border border-line bg-card text-[13px] font-semibold">
            <span aria-hidden className="text-base leading-none">←</span> {t("volver", idioma)}
          </button>
        )}
        {!(esInicio || /^\/mesa\/[^/]+$/.test(path)) && <span className="flex-1" />}
        <select value={idioma} onChange={(e) => setIdioma(e.target.value as Idioma)} aria-label="Idioma / Language" className="selector">
          {IDIOMAS.map((i) => <option key={i.valor} value={i.valor}>{i.texto}</option>)}
        </select>
        <select value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)} aria-label="Moneda / Currency" className="selector">
          {MONEDAS.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
        </select>
      </div>
    </header>
  );
}

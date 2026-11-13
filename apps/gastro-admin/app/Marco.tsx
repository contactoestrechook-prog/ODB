"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cerrarSesion } from "./lib/api";
import { INICIO, ORDEN_ZONAS, PANTALLAS, ZONAS, buscarPantallas, pantallaDe, type Pantalla } from "./lib/pantallas";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const PILA = "gc_pila";

function leerPila(): string[] {
  try {
    return JSON.parse(window.sessionStorage.getItem(PILA) ?? "[]");
  } catch {
    return [];
  }
}

// El marco de todo el panel. Tres cosas siempre a la vista, en cualquier pantalla:
//   1. «← Volver a …» — a la pantalla de la que se vino (la app instalada en
//      el teléfono no tiene botón atrás).
//   2. «Todas las pantallas» — el mapa completo, con buscador.
//   3. Los atajos: en computadora el menú del costado; en el teléfono la barra de abajo.
export function Marco({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [anterior, setAnterior] = useState<string | null>(null);
  const [mapa, setMapa] = useState(false);
  const [demo, setDemo] = useState(false);

  // La pila de pantallas por las que se pasó (vive mientras dure la pestaña).
  useEffect(() => {
    const actual = window.location.pathname + window.location.search;
    let pila = leerPila();
    if (pila[pila.length - 1] !== actual) {
      // si se volvió con el atrás del navegador, se saca en vez de apilar
      if (pila[pila.length - 2] === actual) pila = pila.slice(0, -1);
      else pila = [...pila, actual].slice(-30);
      window.sessionStorage.setItem(PILA, JSON.stringify(pila));
    }
    setAnterior(pila.length > 1 ? pila[pila.length - 2] : null);
    setMapa(false);
  }, [path]);

  useEffect(() => {
    fetch(`${API}/salud`).then((r) => r.json()).then((s) => setDemo(!!s.demo)).catch(() => {});
  }, []);

  // «/» o Ctrl+K abren el mapa; son atajos, el botón está siempre.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const escribiendo = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if ((e.key === "/" && !escribiendo) || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setMapa(true);
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  function volver() {
    const pila = leerPila();
    const destino = pila.length > 1 ? pila[pila.length - 2] : "/";
    window.sessionStorage.setItem(PILA, JSON.stringify(pila.slice(0, -1)));
    router.push(destino);
  }

  const actual = pantallaDe(path);
  const esInicio = path === "/";
  const destinoVolver = anterior ? pantallaDe(anterior) : INICIO;

  return (
    <div className="lg:grid lg:grid-cols-[212px_1fr] min-h-screen">
      {/* ── menú del costado (computadora) ── */}
      <aside className="no-imprimir hidden lg:flex flex-col border-r border-line bg-card sticky top-0 h-screen overflow-y-auto">
        <Link href="/" className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line">
          <span className="w-7 h-7 rounded-md bg-accent text-white font-bold display text-sm grid place-items-center">GC</span>
          <span>
            <span className="block display font-bold text-[13px] leading-tight">Gran Caminito</span>
            <span className="block text-faint text-[10.5px] leading-tight">Panel del restaurante</span>
          </span>
        </Link>
        <nav className="flex-1 px-2 py-2.5">
          <Atajo p={INICIO} activo={esInicio} />
          {ORDEN_ZONAS.map((z) => (
            <div key={z} className="mt-3">
              <p className={`px-2 mb-1 text-[10px] font-bold uppercase tracking-[0.1em] ${ZONAS[z].tinta}`}>{ZONAS[z].titulo}</p>
              {PANTALLAS.filter((p) => p.zona === z).map((p) => (
                <Atajo key={p.href} p={p} activo={actual.href === p.href && !esInicio} />
              ))}
            </div>
          ))}
        </nav>
        <button
          onClick={() => { cerrarSesion(); window.location.reload(); }}
          className="m-2 px-2 py-2 text-left text-xs text-faint rounded-md hover:bg-card-2"
        >
          Salir del panel
        </button>
      </aside>

      <div className="min-w-0 flex flex-col">
        {demo && (
          <p className="no-imprimir bg-warn/20 text-ink text-[11.5px] text-center px-3 py-1 border-b border-line">
            <b>Datos de muestra.</b> Esta versión no tiene base: nada de lo que toques se guarda.
          </p>
        )}

        {/* ── barra de arriba: Volver · dónde estoy · Todas las pantallas ── */}
        <header className="no-imprimir sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-line">
          <div className="max-w-5xl mx-auto px-3 sm:px-5 h-12 flex items-center gap-2">
            {!esInicio ? (
              <button
                onClick={volver}
                className="flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-md border border-line bg-card text-[12.5px] font-semibold whitespace-nowrap max-w-[52vw] sm:max-w-none"
              >
                <span aria-hidden className="text-base leading-none">←</span>
                <span className="truncate">
                  Volver<span className="hidden sm:inline text-dim font-normal"> a {destinoVolver.titulo}</span>
                </span>
              </button>
            ) : (
              <span className="lg:hidden flex items-center gap-2">
                <span className="w-7 h-7 rounded-md bg-accent text-white font-bold display text-sm grid place-items-center">GC</span>
              </span>
            )}

            <div className="min-w-0 flex-1 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-sm flex-none ${esInicio ? "bg-accent" : ZONAS[actual.zona].fondo}`} />
              <span className="truncate text-[12.5px] text-dim">
                {!esInicio && <span className="hidden sm:inline">{ZONAS[actual.zona].titulo} · </span>}
                <b className="text-ink font-semibold">{actual.titulo}</b>
              </span>
            </div>

            {!esInicio && (
              <Link href="/" className="hidden sm:flex items-center h-8 px-3 rounded-md border border-line bg-card text-[12.5px] font-semibold">
                Inicio
              </Link>
            )}
            <button
              onClick={() => setMapa(true)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-ink text-bg text-[12.5px] font-semibold whitespace-nowrap"
            >
              <span aria-hidden className="grid grid-cols-2 gap-[2px]">
                {[0, 1, 2, 3].map((i) => <span key={i} className="w-[5px] h-[5px] rounded-[1px] bg-bg" />)}
              </span>
              <span className="hidden sm:inline">Todas las pantallas</span>
              <span className="sm:hidden">Ir a…</span>
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-5 pt-4 pb-24 lg:pb-10">{children}</main>

        {/* ── barra de abajo (teléfono): lo que más se toca, con el pulgar ── */}
        <nav className="no-imprimir lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
          {[INICIO, ...["/piso-vivo", "/caja", "/reservas"].map((h) => PANTALLAS.find((p) => p.href === h)!)].map((p) => {
            const activo = p.href === "/" ? esInicio : actual.href === p.href && !esInicio;
            return (
              <Link key={p.href} href={p.href} className={`flex flex-col items-center justify-center gap-1 h-[52px] text-[10.5px] font-semibold ${activo ? "text-ink" : "text-faint"}`}>
                <span className={`w-5 h-[3px] rounded-full ${activo ? (p.href === "/" ? "bg-accent" : ZONAS[p.zona].fondo) : "bg-transparent"}`} />
                {p.href === "/reservas" ? "Reservas" : p.titulo}
              </Link>
            );
          })}
          <button onClick={() => setMapa(true)} className="flex flex-col items-center justify-center gap-1 h-[52px] text-[10.5px] font-semibold text-faint">
            <span className="w-5 h-[3px] rounded-full bg-transparent" />
            Todas
          </button>
        </nav>
      </div>

      {mapa && <Mapa actual={esInicio ? "/" : actual.href} cerrar={() => setMapa(false)} />}
    </div>
  );
}

function Atajo({ p, activo }: { p: Pantalla; activo: boolean }) {
  return (
    <Link
      href={p.href}
      title={p.que}
      className={`flex items-center gap-2 px-2 h-[30px] rounded-md text-[12.5px] ${activo ? "bg-card-2 font-semibold text-ink" : "text-dim hover:bg-card-2"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-sm flex-none ${activo ? (p.href === "/" ? "bg-accent" : ZONAS[p.zona].fondo) : "bg-line"}`} />
      <span className="truncate">{p.titulo}</span>
    </Link>
  );
}

// El mapa: todas las pantallas en una sola vista, con buscador. Se abre desde
// cualquier lado y lleva a cualquier lado en un toque.
function Mapa({ actual, cerrar }: { actual: string; cerrar: () => void }) {
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const encontradas = buscarPantallas(texto);

  useEffect(() => {
    campo.current?.focus();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cerrar]);

  return (
    <div className="no-imprimir fixed inset-0 z-50 bg-bg overflow-y-auto" role="dialog" aria-label="Todas las pantallas">
      <div className="max-w-4xl mx-auto px-3 sm:px-5 py-3">
        <div className="flex items-center gap-2 mb-4 sticky top-0 bg-bg py-1">
          <button onClick={cerrar} className="flex items-center gap-1.5 h-9 pl-2 pr-3 rounded-md border border-line bg-card text-[12.5px] font-semibold whitespace-nowrap">
            <span aria-hidden className="text-base leading-none">←</span> Volver
          </button>
          <input
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && encontradas[0]) { router.push(encontradas[0].href); cerrar(); }
            }}
            placeholder="Buscar una pantalla"
            aria-label="Buscar una pantalla"
            className="campo flex-1 !h-9"
          />
        </div>

        <h1 className="display text-[21px] font-bold mb-0.5">Todas las pantallas</h1>
        <p className="text-dim text-[13px] mb-4">Tocá a dónde querés ir.</p>

        {!texto && (
          <Link href="/" onClick={cerrar} className={`block rounded-lg border px-3 py-2.5 mb-4 ${actual === "/" ? "border-accent bg-card" : "border-line bg-card"}`}>
            <span className="font-semibold text-[13.5px]">Inicio</span>
            <span className="block text-dim text-[12px]">{INICIO.que}</span>
          </Link>
        )}

        {encontradas.length === 0 && <p className="text-dim text-sm">No hay ninguna pantalla con ese nombre.</p>}

        {ORDEN_ZONAS.map((z) => {
          const suyas = encontradas.filter((p) => p.zona === z);
          if (!suyas.length) return null;
          return (
            <section key={z} className="mb-5">
              <h2 className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] mb-2 ${ZONAS[z].tinta}`}>
                <span className={`w-2 h-2 rounded-sm ${ZONAS[z].fondo}`} /> {ZONAS[z].titulo}
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {suyas.map((p) => (
                  <Link
                    key={p.href}
                    href={p.href}
                    onClick={cerrar}
                    className={`rounded-lg border bg-card px-3 py-2.5 hover:bg-card-2 ${actual === p.href ? ZONAS[z].borde : "border-line"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[13.5px]">{p.titulo}</span>
                      {actual === p.href && <span className="text-[10px] font-bold uppercase text-faint">Estás acá</span>}
                    </span>
                    <span className="block text-dim text-[12px] leading-snug mt-0.5">{p.que}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <button onClick={() => { cerrarSesion(); window.location.reload(); }} className="mt-2 mb-8 text-xs text-faint underline">
          Salir del panel
        </button>
      </div>
    </div>
  );
}

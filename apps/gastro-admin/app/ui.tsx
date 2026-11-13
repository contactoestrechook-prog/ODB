"use client";

import { useEffect, useRef, useState } from "react";

// Las piezas comunes del panel. Reglas que cumplen:
//  · todo botón que espera al servidor contesta en el mismo lugar donde se tocó
//    (◔ haciendo → ● listo / ■ el motivo del error);
//  · lo que no se puede deshacer pide un segundo toque;
//  · los montos se escriben con puntos de miles mientras se tipea.

type Variante = "principal" | "normal" | "suave" | "peligro" | "bien";
const VARIANTE: Record<Variante, string> = {
  principal: "bg-ink text-bg border-ink",
  normal: "bg-card text-ink border-line hover:bg-card-2",
  suave: "bg-transparent text-dim border-transparent hover:bg-card-2",
  peligro: "bg-card text-loss border-loss/40 hover:bg-loss/10",
  bien: "bg-good text-white border-good",
};
const TAMANO = { chico: "h-[28px] px-2.5 text-[12px]", normal: "h-[34px] px-3 text-[13px]", grande: "h-11 px-4 text-[14px]" };

export function Boton({
  children, variante = "normal", tamano = "normal", className = "", ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: keyof typeof TAMANO }) {
  return (
    <button
      {...resto}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed ${VARIANTE[variante]} ${TAMANO[tamano]} ${className}`}
    >
      {children}
    </button>
  );
}

// Botón para una acción que va al servidor.
export function Accion({
  children, hacer, variante = "normal", tamano = "normal", haciendo = "Haciendo…", listo = "Listo",
  confirmar, className = "", disabled, ancho,
}: {
  children: React.ReactNode;
  hacer: () => Promise<unknown> | unknown;
  variante?: Variante;
  tamano?: keyof typeof TAMANO;
  haciendo?: string;
  listo?: string;
  confirmar?: string; // texto del segundo toque, para lo que no se deshace
  className?: string;
  disabled?: boolean;
  ancho?: boolean;
}) {
  const [estado, setEstado] = useState<"quieto" | "confirmando" | "haciendo" | "listo" | "error">("quieto");
  const [motivo, setMotivo] = useState("");
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  async function tocar() {
    if (estado === "haciendo") return;
    if (confirmar && estado !== "confirmando") {
      setEstado("confirmando");
      setTimeout(() => vivo.current && setEstado((e) => (e === "confirmando" ? "quieto" : e)), 4000);
      return;
    }
    setEstado("haciendo");
    try {
      await hacer();
      if (!vivo.current) return;
      setEstado("listo");
      setTimeout(() => vivo.current && setEstado("quieto"), 1600);
    } catch (e: any) {
      if (!vivo.current) return;
      setMotivo(e?.message || "No se pudo");
      setEstado("error");
    }
  }

  const texto =
    estado === "haciendo" ? <>◔ {haciendo}</>
    : estado === "listo" ? <>● {listo}</>
    : estado === "confirmando" ? <>{confirmar}</>
    : estado === "error" ? <>Volver a intentar</>
    : children;

  return (
    <span className={`inline-flex flex-col gap-1 ${ancho ? "w-full" : ""}`}>
      <Boton
        onClick={tocar}
        disabled={disabled || estado === "haciendo"}
        variante={estado === "confirmando" ? "peligro" : estado === "listo" ? "bien" : variante}
        tamano={tamano}
        className={`${ancho ? "w-full" : ""} ${className}`}
      >
        {texto}
      </Boton>
      {estado === "error" && <span className="text-loss text-[11.5px] leading-snug max-w-[280px]">■ {motivo}</span>}
    </span>
  );
}

// Título de pantalla: nombre en palabras comunes + una línea que explica.
export function Titulo({ children, bajada, acciones }: { children: React.ReactNode; bajada?: React.ReactNode; acciones?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-4">
      <div className="min-w-0">
        <h1 className="display text-[21px] font-bold leading-tight">{children}</h1>
        {bajada && <p className="text-dim text-[13px] mt-0.5 max-w-[62ch]">{bajada}</p>}
      </div>
      {acciones && <div className="no-imprimir flex flex-wrap items-center gap-1.5">{acciones}</div>}
    </div>
  );
}

export function Seccion({ titulo, bajada, acciones, children, className = "" }: {
  titulo: React.ReactNode; bajada?: React.ReactNode; acciones?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`mb-7 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 mb-2">
        <div className="min-w-0">
          <h2 className="display text-[15px] font-bold leading-tight">{titulo}</h2>
          {bajada && <p className="text-dim text-[12.5px] mt-0.5 max-w-[66ch]">{bajada}</p>}
        </div>
        {acciones && <div className="no-imprimir flex flex-wrap items-center gap-1.5">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

// Un renglón de detalle: qué es a la izquierda, cuánto a la derecha.
export function Fila({ que, cuanto, nota, fuerte, tinta = "", onClick }: {
  que: React.ReactNode; cuanto: React.ReactNode; nota?: React.ReactNode; fuerte?: boolean; tinta?: string; onClick?: () => void;
}) {
  const contenido = (
    <>
      <span className={`min-w-0 text-left ${fuerte ? "font-semibold text-ink" : "text-dim"}`}>
        {que}
        {nota && <span className="block text-faint text-[11.5px] font-normal">{nota}</span>}
      </span>
      <span className={`num text-right whitespace-nowrap ${fuerte ? "font-bold" : "font-medium"} ${tinta}`}>{cuanto}</span>
    </>
  );
  const clase = "w-full flex items-baseline justify-between gap-4 py-[7px] border-b border-line last:border-b-0 text-[13.5px]";
  return onClick ? <button onClick={onClick} className={`${clase} hover:bg-card-2`}>{contenido}</button> : <div className={clase}>{contenido}</div>;
}

export function Caja({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-card ${className}`}>{children}</div>;
}

// Etiqueta de estado: siempre con palabra, el color acompaña.
export function Marca({ children, tono = "gris" }: { children: React.ReactNode; tono?: "gris" | "bien" | "mal" | "ojo" | "salon" | "puerta" | "plata" | "negocio" | "cocina" }) {
  const TONO: Record<string, string> = {
    gris: "bg-card-2 text-dim", bien: "bg-good/15 text-good", mal: "bg-loss/15 text-loss", ojo: "bg-warn/20 text-warn",
    salon: "bg-salon/15 text-salon", puerta: "bg-puerta/15 text-puerta", plata: "bg-plata/20 text-plata",
    negocio: "bg-negocio/15 text-negocio", cocina: "bg-cocina/15 text-cocina",
  };
  return <span className={`inline-flex items-center h-[20px] px-1.5 rounded text-[11px] font-semibold whitespace-nowrap ${TONO[tono]}`}>{children}</span>;
}

// Elegir una entre pocas opciones, todas a la vista.
export function Opciones<T extends string | number>({ valor, opciones, alElegir, chico }: {
  valor: T | null; opciones: { valor: T; texto: React.ReactNode }[]; alElegir: (v: T) => void; chico?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1" role="radiogroup">
      {opciones.map((o) => (
        <button
          key={String(o.valor)}
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => alElegir(o.valor)}
          className={`rounded-md border font-semibold whitespace-nowrap ${chico ? "h-[28px] px-2.5 text-[12px]" : "h-[34px] px-3 text-[13px]"} ${
            valor === o.valor ? "bg-ink text-bg border-ink" : "bg-card text-dim border-line hover:bg-card-2"
          }`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Campo({ etiqueta, ayuda, children, className = "" }: { etiqueta: string; ayuda?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[12px] font-semibold text-dim">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-[11.5px] text-faint">{ayuda}</span>}
    </label>
  );
}

// Campo de plata: los puntos de miles se ponen solos mientras se escribe.
// Entrega un número (o null). Con `decimales` acepta coma (reales, dólares).
export function Monto({ valor, alCambiar, decimales = false, prefijo = "$", className = "", ...resto }: {
  valor: number | null; alCambiar: (n: number | null) => void; decimales?: boolean; prefijo?: string; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const aTexto = (n: number | null) =>
    n == null ? "" : decimales ? n.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : Math.round(n).toLocaleString("es-AR");
  const [texto, setTexto] = useState(aTexto(valor));
  const ultimo = useRef(valor);
  useEffect(() => {
    if (valor !== ultimo.current) { setTexto(aTexto(valor)); ultimo.current = valor; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  function escribir(crudo: string) {
    let limpio = crudo.replace(decimales ? /[^\d,]/g : /\D/g, "");
    let entero = limpio;
    let dec: string | null = null;
    if (decimales && limpio.includes(",")) {
      const [a, ...b] = limpio.split(",");
      entero = a;
      dec = b.join("").slice(0, 2);
    }
    entero = entero.replace(/^0+(?=\d)/, "");
    const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    setTexto(dec != null ? `${conPuntos},${dec}` : conPuntos);
    const n = entero === "" && !dec ? null : Number(`${entero || "0"}${dec ? `.${dec}` : ""}`);
    ultimo.current = n;
    alCambiar(n);
  }

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <span className="absolute left-2.5 text-faint text-[13px] pointer-events-none">{prefijo}</span>
      <input {...resto} inputMode={decimales ? "decimal" : "numeric"} value={texto} onChange={(e) => escribir(e.target.value)} className="campo num !pl-9 text-right" />
    </span>
  );
}

// Hoja de detalle: se abre al costado (o desde abajo en el teléfono) y siempre
// tiene su «Cerrar». Esc también la cierra.
export function Hoja({ titulo, bajada, cerrar, children, pie }: {
  titulo: React.ReactNode; bajada?: React.ReactNode; cerrar: () => void; children: React.ReactNode; pie?: React.ReactNode;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
  }, [cerrar]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end items-end sm:items-stretch" role="dialog">
      <button aria-label="Cerrar" onClick={cerrar} className="absolute inset-0 bg-black/45 cursor-default" />
      <div className="hoja relative w-full sm:w-[440px] max-h-[92vh] sm:max-h-none bg-bg border-t sm:border-t-0 sm:border-l border-line rounded-t-xl sm:rounded-none flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="display text-[16px] font-bold leading-tight">{titulo}</h2>
            {bajada && <p className="text-dim text-[12.5px] mt-0.5">{bajada}</p>}
          </div>
          <Boton onClick={cerrar} tamano="chico">← Cerrar</Boton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {pie && <div className="border-t border-line px-4 py-3 bg-card">{pie}</div>}
      </div>
    </div>
  );
}

export function Cargando() {
  return <p className="text-faint text-[13px] py-6">◔ Cargando…</p>;
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-dim text-[13px] py-3">{children}</p>;
}

// «De dónde sale»: la explicación de un número, plegada para no ensuciar.
export function DeDondeSale({ children, titulo = "De dónde sale" }: { children: React.ReactNode; titulo?: string }) {
  return (
    <details className="mt-2 text-[12.5px] text-dim">
      <summary className="font-semibold text-faint hover:text-dim select-none">{titulo}</summary>
      <div className="mt-1.5 max-w-[68ch] leading-relaxed">{children}</div>
    </details>
  );
}

// Trae datos y los refresca cada tanto. Devuelve también `recargar`.
export function useDatos<T>(traer: () => Promise<T>, cadaMs?: number, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fn = useRef(traer);
  fn.current = traer;
  const recargar = useRef(async () => {
    try {
      setDatos(await fn.current());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar");
    }
  }).current;
  useEffect(() => {
    recargar();
    if (!cadaMs) return;
    const t = setInterval(recargar, cadaMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { datos, error, recargar, setDatos };
}

export function ErrorCarga({ error, reintentar }: { error: string; reintentar: () => void }) {
  return (
    <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2.5 text-[13px] flex flex-wrap items-center justify-between gap-2">
      <span>■ {error}</span>
      <Boton tamano="chico" onClick={reintentar}>Volver a intentar</Boton>
    </div>
  );
}

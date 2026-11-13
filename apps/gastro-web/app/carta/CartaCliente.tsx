"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LlamarMozoBoton } from "../LlamarMozoBoton";
import { API, alergeno, plata, precioEn, t, usePreferencias, type Cambio, type Clave, type Idioma } from "../lib/textos";

type Item = {
  id: string; nombre: string; nombrePt: string | null; nombreEn: string | null;
  descripcion: string | null; descripcionPt: string | null; descripcionEn: string | null;
  precio: number; imagenUrl: string | null; alergenos: string[]; etiquetas: string[]; agotado: boolean;
};
type Categoria = { id: string; nombre: string; nombrePt: string | null; nombreEn: string | null; items: Item[] };
type Carta = { cambio: Cambio; categorias: Categoria[] };

const en = (es: string | null, pt: string | null, ing: string | null, idioma: Idioma) => (idioma === "pt" ? pt : idioma === "en" ? ing : es) || es || "";

// Filtros de la carta: cada uno dice qué platos deja pasar.
const FILTROS: { clave: Clave; pasa: (i: Item) => boolean }[] = [
  { clave: "todos", pasa: () => true },
  { clave: "sin_tacc", pasa: (i) => i.etiquetas.includes("sin_tacc") },
  { clave: "vegetariano", pasa: (i) => i.etiquetas.includes("vegetariano") || i.etiquetas.includes("vegano") },
  { clave: "sinLactosa", pasa: (i) => !i.alergenos.includes("lacteos") },
];

export function CartaCliente({ mesa }: { mesa?: string }) {
  const { idioma, moneda, listo } = usePreferencias();
  const [carta, setCarta] = useState<Carta | null>(null);
  const [error, setError] = useState(false);
  const [filtro, setFiltro] = useState<Clave>("todos");

  useEffect(() => {
    fetch(`${API}/carta`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setCarta).catch(() => setError(true));
  }, []);

  if (error) return <p className="text-dim text-sm">{t("cartaVacia", idioma)}</p>;
  if (!carta || !listo) return <p className="text-faint text-sm">◔</p>;

  const pasa = FILTROS.find((f) => f.clave === filtro)!.pasa;
  const categorias = carta.categorias.map((c) => ({ ...c, items: c.items.filter(pasa) })).filter((c) => c.items.length);

  return (
    <div className="entrar pb-24">
      <h1 className="display text-[28px] font-bold leading-tight">{t("carta", idioma)}</h1>
      <p className="text-faint text-[13px] mb-4">{t("lugar", idioma)} · {t("aceptamosPix", idioma)}</p>

      <div className="flex flex-col gap-2 mb-5">
        <Link href="/anfitrion" className="boton !min-h-[40px] !text-[13.5px]">{t("anfitrion", idioma)}</Link>
        {mesa && <Link href={`/mesa/${mesa}/cuenta`} className="boton !min-h-[40px] !text-[13.5px]">{t("miCuenta", idioma)}</Link>}
      </div>

      {/* categorías: salto directo */}
      <nav className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-2 mb-2" aria-label={t("carta", idioma)}>
        {carta.categorias.map((c) => (
          <a key={c.id} href={`#c-${c.id}`} className="flex-none h-8 px-3 rounded-full border border-line bg-card text-[12.5px] font-semibold grid place-items-center whitespace-nowrap">
            {en(c.nombre, c.nombrePt, c.nombreEn, idioma)}
          </a>
        ))}
      </nav>
      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-3 mb-4 border-b border-line">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            onClick={() => setFiltro(f.clave)}
            aria-pressed={filtro === f.clave}
            className={`flex-none h-8 px-3 rounded-full border text-[12.5px] font-semibold whitespace-nowrap ${filtro === f.clave ? "bg-ink text-bg border-ink" : "border-line text-dim"}`}
          >
            {t(f.clave, idioma)}
          </button>
        ))}
      </div>

      {carta.categorias.length === 0 && <p className="text-dim text-sm">{t("cartaVacia", idioma)}</p>}
      {carta.categorias.length > 0 && categorias.length === 0 && <p className="text-dim text-sm">{t("nadaConFiltro", idioma)}</p>}

      <div className="flex flex-col gap-8">
        {categorias.map((cat) => (
          <section key={cat.id} id={`c-${cat.id}`} className="scroll-mt-16">
            <h2 className="text-[11px] tracking-[0.14em] uppercase text-accent font-bold mb-3">{en(cat.nombre, cat.nombrePt, cat.nombreEn, idioma)}</h2>
            <div className="flex flex-col">
              {cat.items.map((item) => {
                const desc = en(item.descripcion, item.descripcionPt, item.descripcionEn, idioma);
                return (
                  <article key={item.id} className={`flex gap-3 border-b border-line py-3.5 ${item.agotado ? "opacity-50" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {item.imagenUrl && <img src={item.imagenUrl} alt="" loading="lazy" className="w-[84px] h-[84px] flex-none rounded-lg object-cover" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="display text-[17px] font-bold leading-snug">{en(item.nombre, item.nombrePt, item.nombreEn, idioma)}</h3>
                        <span className="num font-bold text-[14.5px] whitespace-nowrap">{precioEn(item.precio, moneda, carta.cambio)}</span>
                      </div>
                      {moneda !== "ARS" && carta.cambio[moneda] && <p className="num text-faint text-[11.5px] text-right -mt-0.5">{plata(item.precio, "ARS")}</p>}
                      {desc && <p className="text-dim text-[13px] leading-snug mt-1">{desc}</p>}
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11.5px]">
                        {item.agotado && <span className="font-bold text-loss">{t("agotado", idioma)}</span>}
                        {item.etiquetas.map((e) => <span key={e} className="font-semibold text-good">{t(e as Clave, idioma)}</span>)}
                        {item.alergenos.length > 0 && <span className="text-faint">{t("contiene", idioma)}: {item.alergenos.map((a) => alergeno(a, idioma)).join(", ")}</span>}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {moneda !== "ARS" && <p className="text-faint text-[11.5px] mt-6">{t("cambioNota", idioma)}</p>}
      {mesa && <LlamarMozoBoton token={mesa} flotante />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { IcoUva } from "./Iconos";

export function NotaCata({ sku, esAlcohol }: { sku: string; esAlcohol?: boolean }) {
  const [data, setData] = useState<{ nota: string | null; maridaje: string | null } | null>(null);
  const [cargando, setCargando] = useState(!!esAlcohol);

  useEffect(() => {
    if (!esAlcohol) return;
    let vivo = true;
    fetch(`/api/nota?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => vivo && setData(d))
      .catch(() => vivo && setData({ nota: null, maridaje: null }))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [sku, esAlcohol]);

  if (!esAlcohol) return null;
  if (!cargando && !data?.nota) return null;

  return (
    <section
      className="mt-14 bg-ink text-crema rounded-xl p-7 sm:p-10 relative overflow-hidden"
      style={{ backgroundImage: "radial-gradient(110% 90% at 100% 0%, rgba(147,42,31,0.6), transparent 55%)" }}
    >
      <div className="flex items-center gap-2.5">
        <IcoUva size={20} className="text-dorado" />
        <p className="kicker text-dorado">Nota del Somelier ODB</p>
      </div>
      {cargando ? (
        <p className="mt-5 text-crema/40 text-sm animate-pulse">El Somelier está probando esta etiqueta…</p>
      ) : (
        <>
          <p className="display text-xl sm:text-[26px] mt-5 leading-relaxed text-crema/90 italic">“{data!.nota}”</p>
          {data!.maridaje && (
            <p className="mt-6 text-sm text-crema/60 max-w-2xl">
              <span className="kicker text-dorado-claro mr-2">Marida con</span>
              {data!.maridaje}
            </p>
          )}
        </>
      )}
    </section>
  );
}

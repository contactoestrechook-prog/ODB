"use client";

import Link from "next/link";
import { useEffect } from "react";
import { t, usePreferencias } from "../../lib/textos";

// A dónde llega quien escanea el QR de un hotel, guía o agencia. Se guarda de
// quién vino para que la reserva que haga quede a su nombre.
export function Recomendado({ codigo, nombre }: { codigo: string; nombre: string | null }) {
  const { idioma } = usePreferencias();

  useEffect(() => {
    if (nombre) window.localStorage.setItem("gc_derivador", JSON.stringify({ codigo, nombre }));
  }, [codigo, nombre]);

  return (
    <div className="entrar pt-4">
      {nombre && <p className="text-[12px] tracking-[0.1em] uppercase text-lapacho font-bold mb-2">{t("recomendadoPor", idioma)} {nombre}</p>}
      <h1 className="display text-[30px] font-bold leading-tight mb-1">{t("bienvenido", idioma)}</h1>
      <p className="text-faint text-[13px] mb-7">{t("lugar", idioma)} · {t("aceptamosPix", idioma)}</p>
      <div className="flex flex-col gap-2.5">
        <Link href="/reservar" className="boton boton-fuerte">{t("reservar", idioma)}</Link>
        <Link href="/carta" className="boton">{t("verCarta", idioma)}</Link>
      </div>
    </div>
  );
}

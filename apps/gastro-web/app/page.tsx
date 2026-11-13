"use client";

import Link from "next/link";
import { t, usePreferencias } from "./lib/textos";

export default function Home() {
  const { idioma } = usePreferencias();
  return (
    <div className="entrar pt-6">
      <h1 className="display text-[34px] font-bold leading-none mb-2">Gran Caminito</h1>
      <p className="text-faint text-[13px] mb-8">{t("lugar", idioma)} · {t("aceptamosPix", idioma)}</p>
      <div className="flex flex-col gap-2.5">
        <Link href="/carta" className="boton boton-fuerte">{t("verCarta", idioma)}</Link>
        <Link href="/reservar" className="boton">{t("reservar", idioma)}</Link>
        <Link href="/anfitrion" className="boton">{t("anfitrion", idioma)}</Link>
      </div>
      <p className="text-dim text-[13px] mt-8">{t("escaneaQr", idioma)}</p>
    </div>
  );
}

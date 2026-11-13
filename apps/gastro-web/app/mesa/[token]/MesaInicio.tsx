"use client";

import Link from "next/link";
import { LlamarMozoBoton } from "../../LlamarMozoBoton";
import { CanjeCafe } from "../../CanjeCafe";
import { t, usePreferencias } from "../../lib/textos";

export function MesaInicio({ token, mesa }: { token: string; mesa: { numero: number; sector: string | null } | null }) {
  const { idioma } = usePreferencias();

  if (!mesa) {
    return (
      <div className="entrar text-center pt-10">
        <p className="text-loss font-semibold">{t("codigoInvalido", idioma)}</p>
        <p className="text-faint text-sm mt-2">{t("pediQr", idioma)}</p>
        <Link href="/carta" className="boton mt-6">{t("verCarta", idioma)}</Link>
      </div>
    );
  }

  return (
    <div className="entrar pt-2">
      <p className="text-[11px] tracking-[0.14em] uppercase text-accent font-bold mb-1">
        {t("mesa", idioma)} {mesa.numero}{mesa.sector ? ` · ${mesa.sector}` : ""}
      </p>
      <h1 className="display text-[28px] font-bold leading-tight mb-6">{t("bienvenido", idioma)}</h1>

      <div className="flex flex-col gap-2.5">
        <Link href={`/carta?mesa=${token}`} className="boton boton-fuerte">{t("verCarta", idioma)}</Link>
        <Link href={`/mesa/${token}/cuenta`} className="boton">{t("miCuenta", idioma)}</Link>
        <LlamarMozoBoton token={token} />
        <Link href="/anfitrion" className="boton">{t("anfitrion", idioma)}</Link>
        <CanjeCafe token={token} />
        <Link href={`/opinar/${token}`} className="boton">{t("opinar", idioma)}</Link>
      </div>
    </div>
  );
}

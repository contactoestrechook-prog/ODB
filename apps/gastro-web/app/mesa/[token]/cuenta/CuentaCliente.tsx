"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API, plata, t, usePreferencias, type Cambio, type Clave, type Moneda } from "../../../lib/textos";

type Metodo = "pix" | "qr" | "tarjeta" | "efectivo";
type Cuenta = {
  mesa: { numero: number; sector: string | null };
  abierta: boolean;
  estado?: string;
  renglones?: { id: string; nombre: string; cantidad: number; total: number }[];
  total?: number;
  totalEn?: Record<Moneda, number | null>;
  pagado?: number;
  saldo?: number;
  saldoEn?: Record<Moneda, number | null>;
  pagada?: boolean;
  preferido?: { metodo: Metodo; moneda: Moneda } | null;
  cambio: Cambio;
};

const METODOS: Metodo[] = ["pix", "qr", "tarjeta", "efectivo"];
// en qué moneda se cobra cada medio (el efectivo, en la que el cliente tenga elegida)
const monedaDe = (m: Metodo, elegida: Moneda): Moneda => (m === "pix" ? "BRL" : m === "efectivo" ? elegida : "ARS");

// La cuenta de la mesa, en vivo, en las tres monedas. El cliente la divide,
// elige cómo paga y pide la cuenta: el mozo recibe el aviso con ese dato.
export function CuentaCliente({ token }: { token: string }) {
  const { idioma, moneda, listo } = usePreferencias();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [falla, setFalla] = useState(false);
  const [partes, setPartes] = useState(1);
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [estado, setEstado] = useState<"quieto" | "pidiendo" | "pedida" | "error">("quieto");

  async function cargar() {
    try {
      const r = await fetch(`${API}/mesas/${token}/cuenta`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setCuenta(await r.json());
      setFalla(false);
    } catch {
      setFalla(true);
    }
  }
  useEffect(() => {
    cargar();
    const tm = setInterval(cargar, 8000);
    return () => clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // por defecto: Pix si lee en portugués
  useEffect(() => {
    if (listo && !metodo) setMetodo(idioma === "pt" ? "pix" : "tarjeta");
  }, [listo, idioma, metodo]);

  async function pedir() {
    if (!metodo) return;
    setEstado("pidiendo");
    try {
      const r = await fetch(`${API}/mesas/${token}/pedir-cuenta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo, moneda: monedaDe(metodo, moneda) }),
      });
      if (!r.ok) throw new Error();
      setEstado("pedida");
      cargar();
    } catch {
      setEstado("error");
    }
  }

  if (falla && !cuenta) {
    return (
      <div className="entrar text-center pt-10">
        <p className="text-loss font-semibold">{t("codigoInvalido", idioma)}</p>
        <p className="text-faint text-sm mt-2">{t("pediQr", idioma)}</p>
      </div>
    );
  }
  if (!cuenta || !listo) return <p className="text-faint text-sm">◔</p>;

  const titulo = (
    <>
      <p className="text-[11px] tracking-[0.14em] uppercase text-accent font-bold mb-1">{t("mesa", idioma)} {cuenta.mesa.numero}</p>
      <h1 className="display text-[28px] font-bold leading-tight mb-5">{t("cuenta", idioma)}</h1>
    </>
  );

  if (!cuenta.abierta || !cuenta.renglones?.length) {
    return (
      <div className="entrar">
        {titulo}
        <p className="text-dim text-[14px] mb-6">{t("sinMesaAbierta", idioma)}</p>
        <Link href={`/carta?mesa=${token}`} className="boton boton-fuerte">{t("verCarta", idioma)}</Link>
      </div>
    );
  }

  const saldoEn = cuenta.saldoEn!;
  const mostrar = moneda !== "ARS" && saldoEn[moneda] != null ? moneda : "ARS";
  const pagada = cuenta.pagada || cuenta.estado === "pago";
  const yaPidio = estado === "pedida" || cuenta.estado === "pidio_cuenta";
  const monedaPago = metodo ? monedaDe(metodo, moneda) : mostrar;
  const aPagar = saldoEn[monedaPago] ?? cuenta.saldo!;
  const monedaAPagar: Moneda = saldoEn[monedaPago] != null ? monedaPago : "ARS";

  return (
    <div className="entrar pb-10">
      {titulo}

      <div className="mb-4">
        {cuenta.renglones.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between gap-4 py-2 border-b border-line text-[14px]">
            <span className="text-dim">{r.cantidad} × {r.nombre}</span>
            <span className="num whitespace-nowrap">{plata(r.total, "ARS")}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 pt-3">
          <span className="font-bold text-[15px]">{t("total", idioma)}</span>
          <span className="num font-bold text-[22px] display">{plata(cuenta.totalEn![mostrar], mostrar)}</span>
        </div>
        <p className="num text-faint text-[12.5px] text-right">
          {(["ARS", "BRL", "USD"] as Moneda[]).filter((m) => m !== mostrar && cuenta.totalEn![m] != null).map((m) => plata(cuenta.totalEn![m], m)).join(" · ")}
        </p>
        {cuenta.pagado! > 0 && !pagada && (
          <>
            <div className="flex justify-between text-[13.5px] text-good mt-2"><span>{t("yaPagado", idioma)}</span><span className="num">{plata(cuenta.pagado!, "ARS")}</span></div>
            <div className="flex justify-between text-[14px] font-bold mt-1"><span>{t("falta", idioma)}</span><span className="num">{plata(saldoEn[mostrar], mostrar)}</span></div>
          </>
        )}
      </div>

      {pagada ? (
        <p className="rounded-lg border border-good/40 bg-good/10 p-4 text-center text-good font-semibold">{t("pagada", idioma)}</p>
      ) : (
        <>
          <div className="mb-5">
            <p className="text-[12.5px] font-semibold text-dim mb-2">{t("dividir", idioma)}</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} onClick={() => setPartes(n)} aria-pressed={partes === n} className={`flex-1 h-10 rounded-lg border text-[14px] font-bold ${partes === n ? "bg-ink text-bg border-ink" : "border-line text-dim"}`}>
                  {n}
                </button>
              ))}
            </div>
            {partes > 1 && (
              <p className="text-[14px] mt-2.5">
                {t("cadaUno", idioma)}: <b className="num">{plata(Math.round((aPagar / partes) * 100) / 100, monedaAPagar)}</b>
                <span className="text-faint"> · {partes} {t("personas", idioma)}</span>
              </p>
            )}
          </div>

          <p className="text-[12.5px] font-semibold text-dim mb-2">{t("comoPagar", idioma)}</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {METODOS.map((m) => (
              <button key={m} onClick={() => { setMetodo(m); if (estado === "pedida") setEstado("quieto"); }} aria-pressed={metodo === m} className={`min-h-[46px] px-2 rounded-lg border text-[13.5px] font-semibold ${metodo === m ? "border-accent bg-accent/15 text-ink" : "border-line text-dim"}`}>
                {t(m as Clave, idioma)}
              </button>
            ))}
          </div>

          {yaPidio && estado !== "quieto" || (cuenta.estado === "pidio_cuenta" && estado === "quieto" && cuenta.preferido?.metodo === metodo) ? (
            <p className="rounded-lg border border-good/40 bg-good/10 p-4 text-[14px] text-good font-semibold">
              ● {t("cuentaPedida", idioma)}{metodo === "pix" ? ` ${t("conPix", idioma)}` : ""}
            </p>
          ) : (
            <button onClick={pedir} disabled={estado === "pidiendo" || !metodo} className="boton boton-fuerte">
              {estado === "pidiendo" ? `◔ ${t("pidiendo", idioma)}` : `${t("pedirCuenta", idioma)} · ${plata(aPagar, monedaAPagar)}`}
            </button>
          )}
          {estado === "error" && <p className="text-loss text-[13px] mt-2">■ {t("noSePudo", idioma)}</p>}
          {monedaAPagar !== "ARS" && <p className="text-faint text-[11.5px] mt-3">{t("cambioNota", idioma)}</p>}
        </>
      )}
    </div>
  );
}

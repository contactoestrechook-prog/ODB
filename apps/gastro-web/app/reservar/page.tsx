"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API, t, usePreferencias } from "../lib/textos";

const hoy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

// Pedido de reserva del cliente. Entra como «sin confirmar»: la confirma
// alguien del salón por WhatsApp. Si llegó por el link de un hotel o guía,
// la reserva queda a su nombre.
export default function ReservarPage() {
  const { idioma } = usePreferencias();
  const [f, setF] = useState({ nombre: "", telefono: "", personas: 2, fecha: hoy(), hora: "21:00", notas: "" });
  const [derivador, setDerivador] = useState<{ codigo: string; nombre: string } | null>(null);
  const [estado, setEstado] = useState<"quieto" | "enviando" | "lista">("quieto");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const d = JSON.parse(window.localStorage.getItem("gc_derivador") ?? "null");
      if (d?.codigo) setDerivador(d);
    } catch {}
  }, []);

  async function enviar() {
    setEstado("enviando");
    setError(null);
    try {
      const r = await fetch(`${API}/reservas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, idioma, derivador: derivador?.codigo }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(data.message) ? data.message.join(". ") : data.message);
      setEstado("lista");
    } catch (e: any) {
      setEstado("quieto");
      setError(e?.message || t("noSePudo", idioma));
    }
  }

  if (estado === "lista") {
    return (
      <div className="entrar text-center pt-8">
        <h1 className="display text-[26px] font-bold leading-tight mb-2">{t("reservaLista", idioma)}</h1>
        <p className="text-[15px] mb-1 num">{f.fecha.split("-").reverse().join("/")} · {f.hora} · {t("para", idioma)} {f.personas}</p>
        <p className="text-dim text-[14px] mb-8">{t("reservaConfirmamos", idioma)}</p>
        <div className="flex flex-col gap-2.5">
          <Link href="/carta" className="boton boton-fuerte">{t("verCarta", idioma)}</Link>
          <button onClick={() => setEstado("quieto")} className="boton">{t("otraReserva", idioma)}</button>
        </div>
      </div>
    );
  }

  const falta = !f.nombre.trim() || f.telefono.replace(/\D/g, "").length < 8;
  return (
    <div className="entrar">
      <h1 className="display text-[28px] font-bold leading-tight mb-1">{t("reservar", idioma)}</h1>
      <p className="text-faint text-[13px] mb-5">{t("lugar", idioma)}</p>
      {derivador && <p className="text-[13px] text-lapacho font-semibold mb-4">{t("recomendadoPor", idioma)} {derivador.nombre}</p>}

      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-dim">
          {t("tuNombre", idioma)}
          <input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-dim">
          {t("tuWhatsapp", idioma)}
          <input className="campo num" type="tel" inputMode="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} autoComplete="tel" />
        </label>
        <div>
          <p className="text-[13px] font-semibold text-dim mb-1.5">{t("cuantos", idioma)}</p>
          <div className="grid grid-cols-6 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <button key={n} onClick={() => setF({ ...f, personas: n })} aria-pressed={f.personas === n} className={`h-10 rounded-lg border text-[14px] font-bold ${f.personas === n ? "bg-ink text-bg border-ink" : "border-line text-dim"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-dim">
            {t("dia", idioma)}
            <input className="campo num" type="date" min={hoy()} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-dim">
            {t("hora", idioma)}
            <input className="campo num" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-dim">
          {t("notas", idioma)}
          <textarea className="campo" rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
        </label>
        <button onClick={enviar} disabled={falta || estado === "enviando"} className="boton boton-fuerte">
          {estado === "enviando" ? `◔ ${t("enviando", idioma)}` : t("enviarReserva", idioma)}
        </button>
        {error && <p className="text-loss text-[13px]">■ {error}</p>}
      </div>
    </div>
  );
}

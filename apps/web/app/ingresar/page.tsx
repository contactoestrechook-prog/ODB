"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Ingresar() {
  const router = useRouter();
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const ruta = modo === "login" ? "/api/ingresar" : "/api/registro";
    const body = modo === "login" ? { email, clave } : { email, nombre, clave, codigoReferido: codigo.trim() || undefined };
    try {
      const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "No se pudo continuar");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setCargando(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-black/15 px-4 py-3 text-[#2A201C] outline-none focus:border-[#B82D25]";

  return (
    <div className="min-h-[70vh] grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <p className="text-lg font-bold tracking-[0.3em] text-[#1A1412]">O.D.B</p>
          <p className="text-[10px] tracking-[0.2em] text-[#B82D25] font-semibold">PREMIUM MARKET</p>
        </div>

        <div className="bg-white rounded-3xl border border-black/5 p-6 sm:p-8 shadow-sm">
          <div className="flex rounded-full bg-[#f4eee4] p-1 mb-6">
            {(["login", "registro"] as const).map((m) => (
              <button key={m} onClick={() => { setModo(m); setError(null); }} className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${modo === m ? "bg-[#1A1412] text-white" : "text-[#5f554d]"}`}>
                {m === "login" ? "Entrar" : "Crear cuenta"}
              </button>
            ))}
          </div>

          <form onSubmit={enviar} className="space-y-3">
            {modo === "registro" && (
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" required className={inputCls} />
            )}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Tu email" required className={inputCls} />
            <input value={clave} onChange={(e) => setClave(e.target.value)} type="password" placeholder="Clave (mín. 6)" required className={inputCls} />
            {modo === "registro" && (
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de invitación (opcional)" className={inputCls} />
            )}
            {error && <p className="text-sm text-[#B82D25]">{error}</p>}
            <button disabled={cargando} className="w-full rounded-full bg-[#B82D25] text-white font-semibold py-3 hover:bg-[#932A1F] disabled:opacity-60">
              {cargando ? "Un momento…" : modo === "login" ? "Entrar" : "Crear mi cuenta"}
            </button>
          </form>

          <p className="text-xs text-[#9B9088] text-center mt-5 leading-relaxed">
            Al continuar aceptás los términos y la política de privacidad de O.D.B Premium Market.
          </p>
        </div>

        <p className="text-center mt-5">
          <Link href="/" className="text-sm text-[#5f554d] hover:text-[#B82D25]">← Seguir mirando sin cuenta</Link>
        </p>
      </div>
    </div>
  );
}

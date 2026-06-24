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

  const input = "w-full bg-transparent border-b border-tinta/20 focus:border-dorado transition-colors px-0 py-3 text-[15px] outline-none placeholder:text-humo/70";

  return (
    <div className="min-h-[78vh] grid place-items-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-9">
          <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-20 w-auto" />
        </div>

        <div className="bg-crema border border-linea rounded-xl p-7 sm:p-9">
          <div className="flex gap-7 justify-center mb-8 text-sm">
            {(["login", "registro"] as const).map((m) => (
              <button key={m} onClick={() => { setModo(m); setError(null); }} className={`pb-1 transition-colors ${modo === m ? "text-ink font-semibold border-b-2 border-dorado" : "text-humo hover:text-tinta"}`}>
                {m === "login" ? "Ingresar" : "Crear cuenta"}
              </button>
            ))}
          </div>

          <form onSubmit={enviar} className="space-y-5">
            {modo === "registro" && <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" required className={input} />}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Tu email" required className={input} />
            <input value={clave} onChange={(e) => setClave(e.target.value)} type="password" placeholder="Clave (mín. 6)" required className={input} />
            {modo === "registro" && <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de invitación (opcional)" className={input} />}
            {error && <p className="text-sm text-rojo">{error}</p>}
            <button disabled={cargando} className="w-full rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors disabled:opacity-60 mt-2">
              {cargando ? "Un momento…" : modo === "login" ? "Ingresar" : "Crear mi cuenta"}
            </button>
          </form>

          <p className="text-xs text-humo text-center mt-6 leading-relaxed">
            Al continuar aceptás los términos y la política de privacidad de O.D.B Premium Market.
          </p>
        </div>

        <p className="text-center mt-6">
          <Link href="/" className="text-sm text-humo subraya">Seguir mirando sin cuenta</Link>
        </p>
      </div>
    </div>
  );
}

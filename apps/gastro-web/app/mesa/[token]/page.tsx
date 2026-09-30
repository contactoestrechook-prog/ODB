import Link from "next/link";
import { LlamarMozoBoton } from "../../LlamarMozoBoton";
import { CanjeCafe } from "../../CanjeCafe";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

async function validarMesa(token: string) {
  const res = await fetch(`${API}/mesas/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json() as Promise<{ numero: number; sector: string | null }>;
}

export default async function MesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const mesa = await validarMesa(token);

  if (!mesa) {
    return (
      <div className="entrar text-center pt-12">
        <p className="text-loss font-semibold">Este código no es válido.</p>
        <p className="text-faint text-sm mt-2">Pedile al mozo que te acerque el QR de la mesa.</p>
      </div>
    );
  }

  return (
    <div className="entrar text-center pt-8">
      <p className="text-[10px] tracking-[0.14em] uppercase text-accent font-bold mb-2">
        Mesa {mesa.numero}{mesa.sector ? ` · ${mesa.sector}` : ""}
      </p>
      <h1 className="display text-2xl font-bold mb-8">¡Bienvenido a Gran Caminito!</h1>

      <div className="flex flex-col gap-3">
        <Link
          href={`/carta?mesa=${token}`}
          className="block text-center font-semibold text-sm py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206]"
        >
          Ver la carta
        </Link>
        <Link
          href="/anfitrion"
          className="block text-center font-semibold text-sm py-3 rounded-xl border border-line"
        >
          Preguntale al Anfitrión 🥩
        </Link>
        <LlamarMozoBoton token={token} />
        <CanjeCafe token={token} />
        <Link
          href={`/opinar/${token}`}
          className="block text-center font-semibold text-sm py-3 rounded-xl border border-line"
        >
          Contanos cómo estuvo todo
        </Link>
      </div>
    </div>
  );
}

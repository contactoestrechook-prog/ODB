import { MesaInicio } from "./MesaInicio";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

async function validarMesa(token: string) {
  try {
    const res = await fetch(`${API}/mesas/${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { numero: number; sector: string | null };
  } catch {
    return null;
  }
}

export default async function MesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MesaInicio token={token} mesa={await validarMesa(token)} />;
}

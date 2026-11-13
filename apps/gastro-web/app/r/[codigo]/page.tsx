import { Recomendado } from "./Recomendado";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export default async function RecomendadoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  let nombre: string | null = null;
  try {
    const res = await fetch(`${API}/r/${encodeURIComponent(codigo)}`, { cache: "no-store" });
    if (res.ok) nombre = (await res.json()).nombre;
  } catch {}
  return <Recomendado codigo={codigo} nombre={nombre} />;
}

import { Asistente } from "../ui/Asistente";

export const metadata = { title: "Comprá con ayuda — O.D.B Premium Market" };

// La compra guiada con IA. Se puede entrar con una búsqueda ya escrita
// (/comprar?q=picada para 6) desde la portada.
export default async function Comprar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <Asistente inicial={(sp.q ?? "").slice(0, 300)} />;
}

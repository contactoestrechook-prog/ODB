import { CartaCliente } from "./CartaCliente";

export default async function CartaPage({ searchParams }: { searchParams: Promise<{ mesa?: string }> }) {
  const { mesa } = await searchParams;
  return <CartaCliente mesa={mesa} />;
}

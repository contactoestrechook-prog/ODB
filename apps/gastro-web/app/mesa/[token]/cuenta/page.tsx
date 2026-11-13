import { CuentaCliente } from "./CuentaCliente";

export default async function CuentaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CuentaCliente token={token} />;
}

import { OpinarFlujo } from "./OpinarFlujo";

export default async function OpinarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OpinarFlujo token={token} />;
}

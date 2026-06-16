import { cookies } from "next/headers";

export type Cliente = {
  id: string;
  nombre?: string;
  email?: string;
  dni?: string;
  verificado?: boolean;
};

// Lee el cliente desde el JWT guardado en la cookie (sin verificar firma: solo
// para pintar la UI; la API valida el token en cada request).
export async function sesion(): Promise<Cliente | null> {
  const t = (await cookies()).get("odb_cliente")?.value;
  if (!t) return null;
  try {
    const p = JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8"));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return { id: p.sub, nombre: p.nombre, email: p.email, dni: p.dni, verificado: p.verificado };
  } catch {
    return null;
  }
}

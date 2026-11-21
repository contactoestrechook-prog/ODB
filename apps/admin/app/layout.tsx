import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { BannerInstalarApp } from "./ui/BannerInstalarApp";
import { AvisoActualizacion } from "./ui/AvisoActualizacion";
import { ReportarProblema } from "./ui/ReportarProblema";
import { AvisoPedidosSinAviso } from "./ui/AvisoPedidosSinAviso";
import { AvisoPedidoNuevo } from "./ui/AvisoPedidoNuevo";
import { AvisoTeTocaArmar } from "./ui/AvisoTeTocaArmar";
import { AvisoFiambreria } from "./ui/AvisoFiambreria";
import { cookies } from "next/headers";
import { esEncerrado, rolesDesdeToken, sucursalDesdeToken } from "./lib/permisos";

// Quién ve la ventana de "Llegó un pedido" (6/10/2026): los que pueden tomarlo
// y prepararlo. Administración lo recibe por WhatsApp, con el link para tomarlo.
const ATIENDEN_PEDIDOS = ["dueno", "gerente", "cajero", "deposito"];
// A quién se le puede asignar un armado y tiene más pantallas que Salón: le sale
// «Te toca armar» donde esté (los mismos roles que la API deja leer /salon/pedidos).
const PUEDEN_ARMAR = ["dueno", "gerente", "cajero", "deposito", "op_salon"];

// La letra del panel (decisión del dueño, octubre 2026): más suave que Arial y
// angosta, así no aparecen desbordes nuevos. next/font la sirve desde el mismo
// dominio (no pide nada a Google en el navegador) y la deja en --font-figtree,
// que globals.css usa como --font-sans.
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "O.D.B Premium Market",
  description: "Panel de gestión de O.D.B Premium Market",
  // PWA: con esto el panel se puede instalar como app (escritorio y celular)
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "O.D.B",
    statusBarStyle: "black-translucent",
  },
};

// themeColor: el negro único del sistema (tinta). viewportFit 'cover': la app
// instalada en el iPhone dibuja también debajo de la barra de estado y del
// gesto de inicio; las barras usan env(safe-area-inset-*) para no quedar tapadas.
export const viewport: Viewport = {
  themeColor: "#141414",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = (await cookies()).get("odb_token")?.value;
  // todos sus roles (19/11/2026)
  const roles = rolesDesdeToken(token);
  const encerrado = esEncerrado(roles);
  return (
    <html lang="es" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* op salón y fiambrería: solo su pantalla, sin avisos ni botones del resto del sistema (5/11/2026) */}
        {!encerrado && <AvisoPedidosSinAviso />}
        {children}
        {/* La pila de avisos de pedidos: en el celular baja debajo de la barra negra,
            a lo ancho; en escritorio, abajo a la derecha (arriba tapaba los botones
            de cada pantalla). La caja vacía no se ve ni frena los toques. */}
        <div className="flotante-ocultable pointer-events-none fixed inset-x-0 top-(--alto-barra-movil) z-aviso flex flex-col gap-2 px-3 pt-2 *:pointer-events-auto lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-auto lg:w-[21rem] lg:px-0 lg:pt-0">
          {/* a quien le asignan un pedido para armar, en cualquier pantalla (21/11/2026) */}
          {!encerrado && roles.some((r) => PUEDEN_ARMAR.includes(r)) && <AvisoTeTocaArmar />}
          {roles.some((r) => ATIENDEN_PEDIDOS.includes(r)) && <AvisoPedidoNuevo sucursalId={sucursalDesdeToken(token)} />}
        </div>
        {/* fiambrería: la ventana de lo que tiene que preparar de cada pedido (19/11/2026) */}
        {roles.includes("fiambreria") && <AvisoFiambreria />}
        <AvisoActualizacion />
        <BannerInstalarApp />
        {!encerrado && <ReportarProblema />}
      </body>
    </html>
  );
}

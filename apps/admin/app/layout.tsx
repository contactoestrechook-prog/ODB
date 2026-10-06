import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { BannerInstalarApp } from "./ui/BannerInstalarApp";
import { AvisoActualizacion } from "./ui/AvisoActualizacion";
import { ReportarProblema } from "./ui/ReportarProblema";
import { AvisoPedidosSinAviso } from "./ui/AvisoPedidosSinAviso";
import { AvisoPedidoNuevo } from "./ui/AvisoPedidoNuevo";
import { cookies } from "next/headers";
import { rolDesdeToken } from "./lib/permisos";

// Quién ve la ventana de "Llegó un pedido" (6/10/2026): los que pueden tomarlo
// y prepararlo. Administración lo recibe por WhatsApp, con el link para tomarlo.
const ATIENDEN_PEDIDOS = ["dueno", "gerente", "cajero", "deposito"];

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
  const rol = rolDesdeToken((await cookies()).get("odb_token")?.value);
  return (
    <html lang="es" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AvisoPedidosSinAviso />
        {children}
        {rol && ATIENDEN_PEDIDOS.includes(rol) && <AvisoPedidoNuevo />}
        <AvisoActualizacion />
        <BannerInstalarApp />
        <ReportarProblema />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BannerInstalarApp } from "./ui/BannerInstalarApp";
import { AvisoActualizacion } from "./ui/AvisoActualizacion";

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

export const viewport: Viewport = {
  themeColor: "#141010",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <AvisoActualizacion />
        <BannerInstalarApp />
      </body>
    </html>
  );
}

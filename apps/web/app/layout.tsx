import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, Montserrat, Kaushan_Script } from "next/font/google";
import "./globals.css";
import { CarritoProvider } from "../lib/carrito";
import { Nav } from "./ui/Nav";
import { Footer } from "./ui/Footer";
import { sesion } from "../lib/sesion";
import { RegistroApp } from "./ui/RegistroApp";

const display = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
// Tipografía de marca, la del logo: "O.D.B" y "PREMIUM" son una sans geométrica
// pesada, de O redonda y M de lados rectos. La más cercana es Montserrat en sus
// pesos gruesos (antes estaba Baloo 2, redondeada tipo globo: no era la del logo;
// Leandro lo marcó el 11/9/2026). El script de "Market" sigue siendo Kaushan.
const marca = Montserrat({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-marca", display: "swap" });
const script = Kaushan_Script({ subsets: ["latin"], weight: "400", variable: "--font-script", display: "swap" });

export const metadata: Metadata = {
  title: "O.D.B Premium Market — Vinos, fiambrería y almacén",
  description:
    "La tienda de O.D.B Premium Market. Almacén gourmet, fiambrería, bebidas y bodega en Canning. Envío a domicilio, pick-up con estacionamiento y Compra Fácil.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "O.D.B", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#b82d25" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cliente = await sesion();
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} ${marca.variable} ${script.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-papel text-tinta">
        <CarritoProvider>
          <RegistroApp />
          <Nav cliente={cliente} />
          <main className="flex-1">{children}</main>
          <Footer />
        </CarritoProvider>
      </body>
    </html>
  );
}

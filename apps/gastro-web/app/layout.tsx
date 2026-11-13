import type { Metadata, Viewport } from "next";
import { Archivo, Spectral } from "next/font/google";
import "./globals.css";
import { Barra } from "./Barra";

// Spectral para los nombres de los platos y los títulos (carta impresa);
// Archivo para todo lo que se toca.
const display = Spectral({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-spectral", display: "swap" });
const sans = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "Gran Caminito",
  description: "Carta, cuenta y reservas de Gran Caminito, Puerto Iguazú.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <Barra />
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

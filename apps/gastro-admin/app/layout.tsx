import type { Metadata, Viewport } from "next";
import { Archivo, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AdminGate } from "./AdminGate";
import { Marco } from "./Marco";

// Archivo con el eje de ancho: el mismo dibujo sirve para el texto (normal) y
// para los títulos (ensanchada). Roboto Mono para los números.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const mono = Roboto_Mono({ subsets: ["latin"], variable: "--font-roboto-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Gran Caminito · Panel",
  description: "Panel de NÚCLEO Gastro para Gran Caminito.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${archivo.variable} ${mono.variable} h-full`}>
      <body className="min-h-full">
        <AdminGate>
          <Marco>{children}</Marco>
        </AdminGate>
      </body>
    </html>
  );
}

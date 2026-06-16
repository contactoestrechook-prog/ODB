import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";
import { CarritoProvider } from "../lib/carrito";
import { Nav } from "./ui/Nav";
import { Footer } from "./ui/Footer";
import { sesion } from "../lib/sesion";

const display = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "O.D.B Premium Market — Vinos, fiambrería y almacén",
  description:
    "La tienda de O.D.B Premium Market. Vinos, destilados, fiambrería de autor y almacén selecto. Envío a domicilio y retiro en el local.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cliente = await sesion();
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-papel text-tinta">
        <CarritoProvider>
          <Nav cliente={cliente} />
          <main className="flex-1">{children}</main>
          <Footer />
        </CarritoProvider>
      </body>
    </html>
  );
}

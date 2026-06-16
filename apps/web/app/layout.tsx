import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { CarritoProvider } from "../lib/carrito";
import { Nav } from "./ui/Nav";
import { sesion } from "../lib/sesion";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "O.D.B Premium Market — Bebidas, fiambrería y almacén",
  description:
    "La tienda online de O.D.B Premium Market. Vinos, bebidas, fiambrería y almacén con envío a domicilio y retiro en el local.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cliente = await sesion();
  return (
    <html lang="es" className={`${geist.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans">
        <CarritoProvider>
          <Nav cliente={cliente} />
          <main className="flex-1">{children}</main>
          <footer className="bg-[#1A1412] text-white/60 mt-16">
            <div className="max-w-6xl mx-auto px-4 py-10 grid gap-6 sm:grid-cols-3 text-sm">
              <div>
                <p className="text-white font-bold tracking-[0.3em]">O.D.B</p>
                <p className="text-[#C9A96E] text-[10px] tracking-[0.2em] mt-1">PREMIUM MARKET</p>
                <p className="mt-3 text-white/50 leading-relaxed">Bebidas, fiambrería y almacén. Envío a domicilio y retiro en el local.</p>
              </div>
              <div>
                <p className="text-white/80 font-medium mb-2">Comprar</p>
                <ul className="space-y-1">
                  <li><a href="/catalogo" className="hover:text-white">Catálogo</a></li>
                  <li><a href="/catalogo?filtro=promo" className="hover:text-white">Ofertas</a></li>
                  <li><a href="/cuenta" className="hover:text-white">Mi cuenta</a></li>
                </ul>
              </div>
              <div>
                <p className="text-white/80 font-medium mb-2">Comunidad ODB</p>
                <p className="text-white/50 leading-relaxed">Verificá tu identidad y accedé a precios de socio, prioridad en envíos y puntos en cada compra.</p>
              </div>
            </div>
            <div className="border-t border-white/10 py-4 text-center text-xs text-white/40">© {new Date().getFullYear()} O.D.B Premium Market</div>
          </footer>
        </CarritoProvider>
      </body>
    </html>
  );
}

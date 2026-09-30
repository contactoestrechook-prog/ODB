import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";
import { AdminGate } from "./AdminGate";
import { NavAdmin } from "./NavAdmin";

const display = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Gran Caminito · Panel",
  description: "Panel de NÚCLEO Gastro para Gran Caminito.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full">
        <AdminGate>
          <div className="max-w-2xl mx-auto w-full px-5 py-6">
            <NavAdmin />
            <main className="mt-6">{children}</main>
          </div>
        </AdminGate>
      </body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solo las fotos propias (11/11/2026, auditoría). Antes decía hostname "**":
  // el optimizador de imágenes aceptaba bajar y procesar una imagen de
  // CUALQUIER dominio, que es la puerta de dos fallas críticas publicadas de
  // Next. La tienda no usa el optimizador (las fotos salen directo de la base
  // con <img>), así que esto no cambia nada a la vista.
  images: { remotePatterns: [{ protocol: "https", hostname: "utemmsmuwocerhmuxrbs.supabase.co" }] },
};

export default nextConfig;

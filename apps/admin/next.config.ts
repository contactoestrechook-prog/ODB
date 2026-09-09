import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cada deploy versiona sus archivos estáticos (?dpl=…): el navegador de un
  // usuario que quedó abierto de un deploy anterior nunca mezcla JS viejo con
  // HTML nuevo. Railway define RAILWAY_DEPLOYMENT_ID al compilar (2026-09-09).
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || undefined,
};

export default nextConfig;

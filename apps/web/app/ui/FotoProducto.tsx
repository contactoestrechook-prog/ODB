"use client";

import { useState } from "react";

// Imagen del producto con cascada: foto propia → fotos del tipo → tile de marca.
// Si una imagen falla (404 / no existe), prueba la siguiente y, al agotarse, el tile.
export function FotoProducto({
  imagenUrl,
  fotos = [],
  className = "",
  logoH = "h-9",
}: {
  imagenUrl?: string | null;
  fotos?: string[];
  className?: string;
  logoH?: string;
}) {
  const cadena = [imagenUrl, ...fotos].filter(Boolean) as string[];
  const [i, setI] = useState(0);
  const src = cadena[i];

  if (!src) {
    return (
      <div className="w-full h-full grid place-items-center bg-crema-prof/60">
        <img src="/odb-logo.png" alt="" className={`${logoH} w-auto opacity-35`} />
      </div>
    );
  }
  // La foto propia del producto (i === 0) se muestra ENTERA: son packshots
  // verticales sobre fondo blanco y, recortadas para llenar el cuadro, les
  // cortaba el cuello y la base a las botellas. Los tiles decorativos que vienen
  // después no son el producto: esos sí llenan el cuadro.
  const esLaFoto = i === 0 && !!imagenUrl;
  return (
    <img
      src={src}
      alt=""
      onError={() => setI((n) => n + 1)}
      className={`w-full h-full ${esLaFoto ? "object-contain p-4 sm:p-5" : "object-cover"} ${className}`}
    />
  );
}

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
      <div className="w-full h-full grid place-items-center bg-crema">
        <img src="/odb-logo.png" alt="" className={`${logoH} w-auto opacity-35`} />
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setI((n) => n + 1)} className={`w-full h-full object-cover ${className}`} />;
}

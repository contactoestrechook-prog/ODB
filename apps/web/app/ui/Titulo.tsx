// Títulos de la tienda: la tipografía del logo (Montserrat pesada, como
// "O.D.B / PREMIUM"), en UN solo color. Leandro lo dijo explícito el 11/9/2026:
// nada de títulos en dos colores. `a` y `b` se aceptan para poder armar el
// texto en dos partes, pero se pintan igual.
type Tono = "claro" | "rojo" | "oscuro";

const COLOR: Record<Tono, string> = {
  claro: "text-ink",
  rojo: "text-white",
  oscuro: "text-crema",
};

export function Titulo({
  a,
  b,
  tono = "claro",
  como: Etiqueta = "h2",
  className = "",
}: {
  a: string;
  b?: string;
  tono?: Tono;
  como?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <Etiqueta className={`marca font-black leading-[1.04] tracking-[-0.02em] [text-wrap:balance] ${COLOR[tono]} ${className}`}>
      {b ? `${a} ${b}` : a}
    </Etiqueta>
  );
}

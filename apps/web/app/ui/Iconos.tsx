type P = { className?: string; size?: number };
const base = (size = 20) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export const IcoBuscar = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const IcoUsuario = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
);
export const IcoBolsa = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>
);
export const IcoCarrito = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M3 4h2l2.2 11.2a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L20 7H6" /><circle cx="9" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></svg>
);
export const IcoLocal = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 9l1.2-4.5A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .5L20 9M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M4 9h16" /></svg>
);
export const IcoMoto = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8.5 17h7l-2-7h3M11 10l-1-3H8" /></svg>
);
export const IcoTarjeta = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></svg>
);
export const IcoMedalla = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="9" r="5" /><path d="M9 13.5L7.5 21l4.5-2.5L16.5 21 15 13.5" /></svg>
);
export const IcoCheck = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 12.5l5 5L20 6.5" /></svg>
);
export const IcoFlecha = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IcoMas = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IcoMenos = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M5 12h14" /></svg>
);
export const IcoUva = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3v3M10.5 5.5h3" /><circle cx="9" cy="11" r="2" /><circle cx="15" cy="11" r="2" /><circle cx="12" cy="14.5" r="2" /><circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" /></svg>
);

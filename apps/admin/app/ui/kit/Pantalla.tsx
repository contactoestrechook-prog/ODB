import type { ReactNode } from 'react';
import { Header } from '../Header';
import { unir } from './clases';

// Ojo: este componente NO está en kit/index.ts porque arrastra la cabecera,
// que lee la sesión en el servidor. Se importa directo, solo desde page.tsx:
//   import { Pantalla } from '../ui/kit/Pantalla';

export type AnchoPantalla = 'angosto' | 'normal' | 'ancho';

const ANCHOS: Record<AnchoPantalla, string> = {
  angosto: 'max-w-3xl', // formularios, una sola columna (cambiar clave, pedido a proveedor)
  normal: 'max-w-5xl', // la mayoría
  ancho: 'max-w-7xl', // tablas anchas y tableros (compras, stock, estadísticas)
};

type PropsPantalla = {
  /** La ruta de la sección, para el menú y el título: "/ventas". */
  activo: string;
  ancho?: AnchoPantalla;
  /** Título propio (si no, el de la sección en la cabecera). Para fichas: "Malbec Reserva 750". */
  titulo?: string;
  /** Bajada propia debajo del título (escritorio). */
  bajada?: string;
  /** Sin la cabecera blanca (título + buscador). La usa Inicio. */
  sinCabecera?: boolean;
  /** Clases extra para el contenedor del contenido. */
  className?: string;
  children: ReactNode;
};

/**
 * El marco de cada pantalla del panel: menú, cabecera y el contenido centrado
 * con los márgenes del sistema (16 px en el celular). Deja lugar abajo para el
 * botón "Esto está mal" y separa los bloques hijos con el espacio estándar.
 *
 * Reemplaza en cada page.tsx:
 *   <main className="min-h-screen bg-[#F0EBE2] lg:pl-64"><Header activo="/x" /><div className="max-w-5xl mx-auto p-6">…</div></main>
 */
export function Pantalla({ activo, ancho = 'normal', titulo, bajada, sinCabecera, className, children }: PropsPantalla) {
  return (
    <main className="min-h-dvh bg-crema lg:pl-64">
      <Header activo={activo} titulo={titulo} bajada={bajada} sinCabecera={sinCabecera} />
      <div
        className={unir(
          'mx-auto w-full space-y-4 px-4 pt-4 pb-24 sm:space-y-6 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10',
          ANCHOS[ancho],
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
}

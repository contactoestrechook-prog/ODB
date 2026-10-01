import type { ReactNode } from 'react';
import { ROTULO, unir } from './kit';

// El marco de las pantallas de acceso (entrar, recuperar la clave, elegir una
// nueva y cambiarla): fondo crema, una tarjeta blanca centrada con el logo y
// el formulario. Las cuatro se ven igual; sin menú ni cabecera porque se usan
// sin sesión (o antes de poder usar el panel). En el celular la tarjeta llega
// a 16 px del borde y respeta la muesca y el gesto del iPhone.
export function PantallaAcceso({
  rotulo,
  titulo,
  bajada,
  children,
}: {
  /** La línea en mayúsculas debajo del logo: "Panel administrativo". */
  rotulo?: string;
  /** Título grande (h1). Si no hay, el rótulo hace de título de la página. */
  titulo?: string;
  /** Una línea debajo del título. */
  bajada?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-crema px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm min-w-0 rounded-2xl border border-black/[0.06] bg-white p-6 shadow-flotante sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo.png" alt="O.D.B Premium Market" className="mx-auto h-14 w-auto sm:h-16" />
        {rotulo &&
          (titulo ? (
            <p className={unir(ROTULO, 'mt-3 text-center tracking-[0.25em]')}>{rotulo}</p>
          ) : (
            <h1 className={unir(ROTULO, 'mt-3 text-center tracking-[0.25em]')}>{rotulo}</h1>
          ))}
        {titulo && <h1 className="mt-3 text-center text-xl font-bold tracking-tight text-tinta">{titulo}</h1>}
        {bajada && <p className="mt-1 text-center text-sm text-tinta/60">{bajada}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

/** El "Mostrar la clave": casilla con zona táctil de 44 px. */
export const CLASE_CASILLA = 'flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-tinta/70';

/** Enlace de texto al pie de la tarjeta ("Olvidé mi contraseña", "Volver al ingreso"). */
export const CLASE_ENLACE_ACCESO =
  'mt-3 flex min-h-11 items-center justify-center rounded-full text-sm text-tinta/70 underline underline-offset-2 hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca';

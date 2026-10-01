import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { FOCO, unir } from './clases';

// 36 px de alto; en el celular la zona táctil se estira a 44 con un ::before.
// max-w-full + el texto con truncate: un chip con un nombre larguísimo se
// corta con "…" en vez de estirar la pantalla.
const BASE = unir(
  'relative inline-flex min-h-9 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium',
  'transition-[background-color,border-color,color,transform] active:scale-[0.98]',
  'before:absolute before:inset-x-0 before:-inset-y-1 sm:before:hidden',
  FOCO,
);

const ACTIVO = 'border-tinta bg-tinta text-white';
const INACTIVO = 'border-black/15 bg-white text-tinta/70 hover:border-black/25 hover:text-tinta';

function Cuenta({ n, activo }: { n: number; activo: boolean }) {
  return (
    <span className={unir('importe rounded-full px-1.5 text-xs font-semibold leading-5', activo ? 'bg-white/20 text-white' : 'bg-crema-hondo text-tinta/70')}>
      {n}
    </span>
  );
}

type PropsChip = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  activo?: boolean;
  cuenta?: number;
  /** Si el filtro vive en la URL, pasá el href y se arma con <Link>. */
  href?: string;
  children: ReactNode;
};

/** Un chip de filtro suelto (para filtros que se prenden y apagan de a varios). */
export function Chip({ activo = false, cuenta, href, className, children, type = 'button', ...resto }: PropsChip) {
  const clases = unir(BASE, activo ? ACTIVO : INACTIVO, className);
  const contenido = (
    <>
      <span className="min-w-0 truncate">{children}</span>
      {cuenta != null && <Cuenta n={cuenta} activo={activo} />}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-current={activo ? 'true' : undefined} className={clases}>
        {contenido}
      </Link>
    );
  }
  return (
    <button type={type} aria-pressed={activo} className={clases} {...resto}>
      {contenido}
    </button>
  );
}

export type OpcionChip<V extends string = string> = { valor: V; etiqueta: ReactNode; cuenta?: number; href?: string };

type PropsChips<V extends string> = {
  opciones: OpcionChip<V>[];
  /** El chip elegido. */
  valor: V;
  onCambiar?: (valor: V) => void;
  /** Qué filtran, para lectores de pantalla ("Estado del cheque"). */
  etiquetaAccesible?: string;
  /** true: una sola fila que scrollea de costado; por defecto bajan de renglón. */
  desplazable?: boolean;
  className?: string;
};

/** Filtro de una sola opción en chips: "Todos · Pendientes · Cobrados". */
export function Chips<V extends string>({
  opciones,
  valor,
  onCambiar,
  etiquetaAccesible = 'Filtros',
  desplazable = false,
  className,
}: PropsChips<V>) {
  return (
    <div
      role="group"
      aria-label={etiquetaAccesible}
      className={unir(
        'flex min-w-0 gap-2',
        // desplazable: 4 px de aire alrededor para que el contorno del foco no
        // quede cortado por el scroll (sin margen negativo: así nunca se pasa
        // del ancho de lo que lo contiene)
        desplazable ? 'overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap',
        className,
      )}
    >
      {opciones.map((o) => (
        <Chip key={o.valor} activo={o.valor === valor} cuenta={o.cuenta} href={o.href} onClick={() => onCambiar?.(o.valor)}>
          {o.etiqueta}
        </Chip>
      ))}
    </div>
  );
}

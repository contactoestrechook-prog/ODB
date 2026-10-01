import Link from 'next/link';
import { Fragment, type Key, type ReactNode } from 'react';
import { FOCO, FOCO_ADENTRO, ROTULO, unir } from './clases';
import { Vacio } from './Vacio';

export type ColumnaTabla<T> = {
  /** Identificador único de la columna. */
  clave: string;
  /** Encabezado (escritorio) y rótulo del dato (tarjeta del celular). */
  titulo: ReactNode;
  /** Qué se muestra en la celda. */
  celda: (fila: T, indice: number) => ReactNode;
  /** Alineación en escritorio. Las de `importe` van a la derecha solas. */
  alinear?: 'izquierda' | 'centro' | 'derecha';
  /** Es plata o una cantidad: a la derecha y con cifras parejas. */
  importe?: boolean;
  /** En el celular va arriba, como título de la tarjeta (ej. el nombre del producto). */
  principal?: boolean;
  /** Botones de la fila: en el celular van abajo, en una fila que se acomoda sola. */
  acciones?: boolean;
  /** No se muestra en el celular (datos secundarios). */
  ocultarEnMovil?: boolean;
  /** Clase de ancho de la columna en escritorio ("w-32", "min-w-48"). */
  ancho?: string;
  /** Clases extra para la celda de escritorio. */
  claseCelda?: string;
};

type PropsTabla<T> = {
  columnas: ColumnaTabla<T>[];
  filas: T[];
  /** Clave única de cada fila: el nombre de un campo ('id') o una función. */
  claveFila: keyof T | ((fila: T, indice: number) => Key);
  /** Tarjeta propia para el celular (solo los datos: las columnas `acciones`
   *  van igual abajo, fuera de la tarjeta). Si no se pasa, se arma sola. */
  tarjetaMovil?: (fila: T, indice: number) => ReactNode;
  /** Si cada fila lleva a una ficha: en el celular la tarjeta entera es un enlace
   *  (las acciones quedan abajo, fuera del enlace); en escritorio, la columna principal. */
  hrefFila?: (fila: T) => string;
  /** Qué mostrar si no hay filas (por defecto, un <Vacio> genérico). */
  vacio?: ReactNode;
  /** Una línea al pie (totales, "Ver más"). */
  pie?: ReactNode;
  /** true: sin la caja blanca (la tabla ya está dentro de una <Tarjeta relleno={false}>). */
  sinMarco?: boolean;
  /** Descripción para lectores de pantalla ("Cheques en cartera"). */
  etiqueta?: string;
  className?: string;
};

const ALINEAR = { izquierda: 'text-left', centro: 'text-center', derecha: 'text-right' } as const;

function alineacion<T>(c: ColumnaTabla<T>) {
  return ALINEAR[c.alinear ?? (c.importe || c.acciones ? 'derecha' : 'izquierda')];
}

/**
 * Lista de datos que en el celular se ve como tarjetas (una debajo de otra,
 * nada se sale del ancho) y desde `md` como tabla, con scroll lateral propio
 * si no entra. Reemplaza a las <table> sueltas y al parche global de tablas.
 *
 * Ojo: las dos vistas existen a la vez en la página (una escondida). Si una
 * celda tiene un campo editable, armá `tarjetaMovil` para no duplicarlo, y no
 * pongas botones dentro de `tarjetaMovil`: van en una columna `acciones`.
 */
export function TablaResponsiva<T>({
  columnas,
  filas,
  claveFila,
  tarjetaMovil,
  hrefFila,
  vacio,
  pie,
  sinMarco = false,
  etiqueta,
  className,
}: PropsTabla<T>) {
  if (filas.length === 0) {
    return <>{vacio ?? <Vacio titulo="No hay nada para mostrar" texto="Cuando haya datos, aparecen acá." className={className} />}</>;
  }

  const clave = (f: T, i: number): Key =>
    typeof claveFila === 'function' ? claveFila(f, i) : String(f[claveFila] as unknown);

  const visibles = columnas.filter((c) => !c.ocultarEnMovil);
  const acciones = visibles.filter((c) => c.acciones);
  const datos = visibles.filter((c) => !c.acciones);
  const marcadas = datos.filter((c) => c.principal);
  const principales = marcadas.length > 0 ? marcadas : datos.slice(0, 1);
  const resto = datos.filter((c) => !principales.includes(c));
  const columnaEnlace = columnas.find((c) => c.principal) ?? columnas.find((c) => !c.acciones);

  const tarjetaAutomatica = (f: T, i: number) => (
    <>
      <div className="min-w-0 space-y-0.5 text-sm font-semibold text-tinta">
        {principales.map((c) => (
          <div key={c.clave} className="min-w-0">
            {c.celda(f, i)}
          </div>
        ))}
      </div>
      {resto.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          {resto.map((c) => (
            <div key={c.clave} className="min-w-0">
              <dt className="text-xs text-tinta/60">{c.titulo}</dt>
              <dd className={unir('mt-0.5 min-w-0 text-sm text-tinta', c.importe && 'tabular-nums')}>{c.celda(f, i)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  return (
    <div
      className={unir(
        'min-w-0',
        !sinMarco && 'rounded-2xl border border-black/[0.06] bg-white shadow-tarjeta',
        className,
      )}
    >
      {/* celular: tarjetas */}
      <ul className="divide-y divide-black/[0.06] md:hidden" aria-label={etiqueta}>
        {filas.map((f, i) => {
          const contenido = tarjetaMovil ? tarjetaMovil(f, i) : tarjetaAutomatica(f, i);
          const href = hrefFila?.(f);
          return (
            <li key={clave(f, i)} className="min-w-0">
              {href ? (
                <Link
                  href={href}
                  className={unir('block px-4 py-3 transition-colors hover:bg-crema-claro active:bg-crema-claro', FOCO_ADENTRO)}
                >
                  {contenido}
                </Link>
              ) : (
                <div className="px-4 py-3">{contenido}</div>
              )}
              {acciones.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pb-3">
                  {acciones.map((c) => (
                    <Fragment key={c.clave}>{c.celda(f, i)}</Fragment>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* desde md: tabla */}
      <div className="hidden overflow-x-auto rounded-2xl md:block">
        <table className="tabla-kit w-full border-collapse text-sm">
          {etiqueta && <caption className="sr-only">{etiqueta}</caption>}
          <thead>
            <tr className="border-b border-black/[0.06]">
              {columnas.map((c) => (
                <th
                  key={c.clave}
                  scope="col"
                  className={unir('whitespace-nowrap px-4 py-3 align-bottom', ROTULO, alineacion(c), c.ancho)}
                >
                  {c.acciones && !c.titulo ? <span className="sr-only">Acciones</span> : c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {filas.map((f, i) => {
              const href = hrefFila?.(f);
              return (
                <tr key={clave(f, i)} className="transition-colors hover:bg-crema-claro/70">
                  {columnas.map((c) => (
                    <td
                      key={c.clave}
                      className={unir(
                        'px-4 py-3 align-middle text-tinta',
                        alineacion(c),
                        c.importe && 'importe',
                        c.acciones && 'whitespace-nowrap',
                        c.claseCelda,
                      )}
                    >
                      {href && c === columnaEnlace ? (
                        <Link
                          href={href}
                          className={unir('rounded-sm font-medium text-tinta underline-offset-4 hover:text-marca hover:underline', FOCO)}
                        >
                          {c.celda(f, i)}
                        </Link>
                      ) : c.acciones ? (
                        <div className="inline-flex items-center justify-end gap-2">{c.celda(f, i)}</div>
                      ) : (
                        c.celda(f, i)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pie && <div className="border-t border-black/[0.06] px-4 py-3 text-sm">{pie}</div>}
    </div>
  );
}

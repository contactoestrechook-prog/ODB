'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { unir } from './clases';

type DatosCampo = { id: string; idDescripcion?: string; invalido: boolean; obligatorio: boolean };

const ContextoCampo = createContext<DatosCampo | null>(null);

/** Lo usan Entrada, Selector y AreaTexto para tomar el id, la ayuda y el error del <Campo> que los envuelve. */
export function useCampo() {
  return useContext(ContextoCampo);
}

type PropsCampo = {
  /** El rótulo visible del campo. */
  etiqueta: ReactNode;
  /** Una ayuda corta debajo ("Sin puntos ni guiones"). Si hay error, se muestra el error. */
  ayuda?: ReactNode;
  /** Mensaje de error: pinta el campo en rojo y queda enlazado a él (el lector de pantalla lo lee al enfocarlo). Para avisar un error al guardar, además un <Aviso tono="error">. */
  error?: ReactNode;
  /** Agrega el asterisco y marca el campo como obligatorio. */
  obligatorio?: boolean;
  /** id del control; si no se pasa, se genera uno. */
  id?: string;
  className?: string;
  /** El control: <Entrada>, <Selector> o <AreaTexto>. */
  children: ReactNode;
};

/**
 * Rótulo + control + ayuda/error, enlazados para lectores de pantalla.
 * <Campo etiqueta="CUIT" ayuda="Sin guiones"><Entrada inputMode="numeric" /></Campo>
 */
export function Campo({ etiqueta, ayuda, error, obligatorio = false, id, className, children }: PropsCampo) {
  const automatico = useId();
  const idCampo = id ?? `campo-${automatico}`;
  const nota = error || ayuda;
  const idDescripcion = nota ? `${idCampo}-nota` : undefined;
  return (
    <ContextoCampo.Provider value={{ id: idCampo, idDescripcion, invalido: Boolean(error), obligatorio }}>
      <div className={unir('min-w-0', className)}>
        <label htmlFor={idCampo} className="mb-1.5 block text-sm font-medium text-tinta">
          {etiqueta}
          {obligatorio && (
            <span className="text-marca" aria-hidden="true">
              {' '}*
            </span>
          )}
        </label>
        {children}
        {nota && (
          <p
            id={idDescripcion}
            className={unir('mt-1.5', error ? 'text-sm font-medium text-marca-hondo' : 'text-xs text-tinta/60')}
          >
            {nota}
          </p>
        )}
      </div>
    </ContextoCampo.Provider>
  );
}

import { aNumero, pesos, pesosCorto } from '../../lib/formato';
import { unir } from './clases';

type PropsMonto = {
  /** El importe: número o texto numérico (como llega de la API). */
  valor: unknown;
  /** true: con centavos ("$1.234,50"). */
  decimales?: boolean;
  /** true: abreviado ("$1,2M"); el importe completo queda en el title. */
  corto?: boolean;
  /** true: es una diferencia. Muestra el signo y pinta verde (+), rojo (−) o neutro (0). */
  diferencia?: boolean;
  /** Qué mostrar si no hay importe. Por defecto '—'. */
  vacio?: string;
  className?: string;
};

/**
 * Un importe en pantalla: "$1.234.567" con cifras parejas (clase `importe`:
 * se alinean en columna y no se cortan en dos renglones).
 */
export function Monto({ valor, decimales = false, corto = false, diferencia = false, vacio, className }: PropsMonto) {
  const n = aNumero(valor);
  const completo = pesos(valor, { decimales, signo: diferencia, vacio });
  const texto = corto ? pesosCorto(valor, { vacio }) : completo;
  const tono = diferencia && n != null ? (n > 0 ? 'text-ok' : n < 0 ? 'text-marca-hondo' : 'text-tinta/60') : undefined;
  return (
    <span className={unir('importe', tono, className)} title={corto ? completo : undefined}>
      {texto}
    </span>
  );
}

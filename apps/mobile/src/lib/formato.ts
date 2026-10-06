// Formatos y reglas de texto que comparten varias pantallas. Lógica pura: sin
// estado, sin red y sin componentes.

// ---- Sucursal ----
// Regla de la tienda (apps/web/app/ui/PlacaPedido.tsx): todos los pedidos de la
// app salen de Saint Thomas, escrito "Saint Thomas", nunca "Sant Thomas". La
// base la guarda cruda como "Suc Sant Thomas", así que todo nombre que venga de
// la API pasa por acá antes de mostrarse.
export const SUCURSAL_RETIRO = { nombre: 'Saint Thomas', direccion: 'Castex 3601, Canning' };

export function nombreSucursal(crudo?: string | null): string {
  const n = String(crudo ?? '')
    .trim()
    .replace(/^suc(ursal|\.)?\s+/i, '')
    .replace(/^sant\s+thomas/i, 'Saint Thomas')
    .replace(/^santa\s+ines$/i, 'Santa Inés');
  return n || SUCURSAL_RETIRO.nombre;
}

// ---- Cantidades ----
// Entera sin decimales; por peso con coma y hasta 2 decimales ("1,5", "0,25").
export function cantidadLegible(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// ---- Estados del pedido ----
export const ETIQUETA_ESTADO: Record<string, string> = {
  recibido: 'Recibido',
  pagado: 'Pagado',
  en_preparacion: 'En preparación',
  listo: 'Listo',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  completada: 'Completada',
};

export function etiquetaEstado(estado?: string | null): string {
  if (!estado) return '';
  const conocido = ETIQUETA_ESTADO[estado.toLowerCase()];
  if (conocido) return conocido;
  // estado nuevo que la app todavía no conoce: al menos sin guiones bajos
  const t = estado.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---- WhatsApp ----
// Lleva cualquier forma habitual de escribir un celular argentino a los 10
// dígitos (código de área + número, sin 0, sin 15 y sin +54 9):
//   "+54 9 11 2345-6789", "011 15 2345 6789", "11 2345 6789" → "1123456789"
// Devuelve null si no se puede armar un número válido.
export function normalizarWhatsApp(entrada: string): string | null {
  let d = String(entrada ?? '').replace(/\D/g, '');
  if (d.startsWith('54') && d.length > 10) {
    d = d.slice(2);
    if (d.startsWith('9') && d.length > 10) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // el "15" de los celulares va después del código de área (2, 3 o 4 dígitos);
  // el único código de 2 dígitos es 11 (AMBA)
  if (d.length === 12) {
    const largoArea = d.startsWith('11') ? [2] : [3, 4];
    for (const a of largoArea) {
      if (d.slice(a, a + 2) === '15') {
        d = d.slice(0, a) + d.slice(a + 2);
        break;
      }
    }
  }
  // 10 dígitos y un código de área real: empieza con 11, 2 o 3
  return /^(11|[23]\d)\d{8}$/.test(d) ? d : null;
}

// "1123456789" → "11 2345-6789" (para mostrar el número ya normalizado). Fuera
// del 11 el largo del código de área varía (3 o 4 dígitos): va sin agrupar.
export function formatearWhatsApp(diezDigitos: string): string {
  const d = diezDigitos;
  if (d.length === 10 && d.startsWith('11')) return `11 ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

// ENTREGAR A CUENTA CORRIENTE (25/11/2026): lo que se revisa antes de entregar, sin base.
// Juan Pablo, por Leandro: «agregar que fue cuenta corriente para que lo facture pero lo deje en
// cuenta del cliente». La cuenta tiene que estar abierta y el pedido entrar en el tope; la
// factura es A si el cliente es responsable inscripto con CUIT, B si no.

export type CuentaParaEntregar = { clienteId: string; nombre: string; tipo: 'FA' | 'FB' };

const plata = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

export function cuentaParaEntregar(
  c: { id: string; nombre?: string | null; razon_social?: string | null; cuit?: string | null; condicion_iva?: string | null; cta_cte_habilitada?: boolean | null; limite_credito?: number | string | null } | null | undefined,
  total: number,
  saldo: number | null,
): CuentaParaEntregar | string {
  if (!c) return 'No existe ese cliente';
  const nombre = String(c.razon_social || c.nombre || 'El cliente');
  if (!c.cta_cte_habilitada) return `${nombre} no tiene cuenta corriente abierta: abrila en Cuentas corrientes › Sumar cuenta`;
  const tope = Number(c.limite_credito ?? 0);
  if (tope > 0 && saldo != null && saldo + total > tope + 0.01) {
    return `Se pasa del tope de ${nombre}: debe ${plata(saldo)}, el pedido es de ${plata(total)} y el tope es ${plata(tope)}`;
  }
  return { clienteId: String(c.id), nombre, tipo: c.condicion_iva === 'responsable_inscripto' && c.cuit ? 'FA' : 'FB' };
}

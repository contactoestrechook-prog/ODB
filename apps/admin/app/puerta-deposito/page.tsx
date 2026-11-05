import { Pantalla } from '../ui/kit/Pantalla';
import { PuertaDepositoAdmin } from '../ui/PuertaDepositoAdmin';

export const dynamic = 'force-dynamic';

// Lo que el salón recibió con remito espera la factura (5/11/2026)
export default function PuertaDeposito() {
  return (
    <Pantalla activo="/puerta-deposito">
      <PuertaDepositoAdmin />
    </Pantalla>
  );
}

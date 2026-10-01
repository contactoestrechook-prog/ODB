import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { MercadoPagoWorkspace } from '../ui/MercadoPagoWorkspace';
import { PinGate } from '../ui/PinGate';

export const dynamic = 'force-dynamic';

export default async function MercadoPago() {
  let estado: any = { vinculado: false };
  let resumen: any = {};
  let pagos: any[] = [];
  let error: string | null = null;
  try {
    const [re, rr, rp] = await Promise.all([
      apiFetch('/mercadopago/estado'),
      apiFetch('/mercadopago/resumen'),
      apiFetch('/mercadopago/pagos'),
    ]);
    if (re.ok) estado = await re.json();
    if (rr.ok) resumen = await rr.json();
    if (rp.ok) pagos = await rp.json();
    if (!re.ok && !rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/mercadopago">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <PinGate modulo="mercadopago" titulo="Mercado Pago">
          <MercadoPagoWorkspace estado={estado} resumen={resumen} pagos={pagos} />
        </PinGate>
      )}
    </Pantalla>
  );
}

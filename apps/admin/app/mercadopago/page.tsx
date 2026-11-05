import { Unbounded } from 'next/font/google';
import { Header } from '../ui/Header';
import { MercadoPagoTablero } from '../ui/MercadoPagoTablero';
import { PinGate } from '../ui/PinGate';

export const dynamic = 'force-dynamic';

// Mercado Pago, versión 2 (Leandro, 5/11/2026: «a otro nivel», «análisis mes a
// mes», «mejorá mucho toda la gráfica»). Mismo idioma que Frío: perfil Ultra,
// negro y tipográfico, letra Unbounded solo para esta pantalla.
const unbounded = Unbounded({ subsets: ['latin'], weight: ['300', '400', '600', '800'], variable: '--letra-mp', display: 'swap' });

export default function MercadoPago() {
  return (
    <main className={`${unbounded.variable} flex h-dvh flex-col bg-[#09090D] lg:pl-64`}>
      <Header activo="/mercadopago" sinCabecera />
      <PinGate modulo="mercadopago" titulo="Mercado Pago">
        <MercadoPagoTablero />
      </PinGate>
    </main>
  );
}

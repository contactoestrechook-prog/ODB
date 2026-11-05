import { Unbounded } from 'next/font/google';
import { Header } from '../ui/Header';
import { FrioPieza } from '../ui/FrioTablero';

export const dynamic = 'force-dynamic';

// Frío (Leandro, 3/11/2026: «un módulo gráfico muy potente»). Perfil Ultra: la
// pantalla es negra y tipográfica; el color vive solo en la pieza. La letra
// elegida es Unbounded (3/11), solo para esta pantalla.
const unbounded = Unbounded({ subsets: ['latin'], weight: ['300', '400', '600', '800'], variable: '--letra-frio', display: 'swap' });

export default function Frio() {
  return (
    <main className={`${unbounded.variable} flex h-dvh flex-col bg-[#09090D] lg:pl-64`}>
      <Header activo="/frio" sinCabecera />
      <FrioPieza />
    </main>
  );
}

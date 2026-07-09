import { Header } from '../ui/Header';
import BotSimulador from '../ui/BotSimulador';

export const metadata = { title: 'Probar el bot · ODB' };

export default function BotPage() {
  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/bot" />
      <BotSimulador />
    </main>
  );
}

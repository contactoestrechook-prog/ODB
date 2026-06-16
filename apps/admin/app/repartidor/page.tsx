import { Header } from '../ui/Header';
import { RepartidorView } from '../ui/RepartidorView';

export const dynamic = 'force-dynamic';

export default function Repartidor() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/repartidor" />
      <div className="max-w-5xl mx-auto p-6">
        <RepartidorView />
      </div>
    </main>
  );
}

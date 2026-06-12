import { Header } from '../ui/Header';
import { ControlSalida } from './ControlSalida';

export default function Salida() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/salida" />
      <div className="max-w-xl mx-auto p-6">
        <ControlSalida />
      </div>
    </main>
  );
}

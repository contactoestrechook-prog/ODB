import { Header } from '../ui/Header';
import { ColaDeposito } from './ColaDeposito';

export default function Deposito() {
  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/deposito" />
      <div className="max-w-6xl mx-auto p-6">
        <ColaDeposito />
      </div>
    </main>
  );
}

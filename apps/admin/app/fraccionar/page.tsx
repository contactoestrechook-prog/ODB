import { Header } from '../ui/Header';
import { Fraccionar } from './Fraccionar';

export default function PaginaFraccionar() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/fraccionar" />
      <div className="max-w-4xl mx-auto p-6">
        <Fraccionar />
      </div>
    </main>
  );
}

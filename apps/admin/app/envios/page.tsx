import { Header } from '../ui/Header';
import { EnviosWorkspace } from '../ui/EnviosWorkspace';

export const dynamic = 'force-dynamic';

export default function Envios() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/envios" />
      <div className="max-w-5xl mx-auto p-6">
        <EnviosWorkspace />
      </div>
    </main>
  );
}

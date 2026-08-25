import { Header } from '../ui/Header';
import { Trazabilidad } from '../ui/Trazabilidad';

export const dynamic = 'force-dynamic';

// Trazabilidad de administración. Dos preguntas que hasta ahora no tenían
// pantalla: "¿qué papeles emitimos?" y sobre todo "¿dónde se cortó la cadena?".
export default function TrazabilidadPage() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/trazabilidad" />
      <Trazabilidad />
    </main>
  );
}

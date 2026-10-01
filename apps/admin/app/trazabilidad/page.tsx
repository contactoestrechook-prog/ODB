import { Pantalla } from '../ui/kit/Pantalla';
import { Trazabilidad } from '../ui/Trazabilidad';

export const dynamic = 'force-dynamic';

// Trazabilidad de administración. Dos preguntas que hasta ahora no tenían
// pantalla: "¿qué papeles emitimos?" y sobre todo "¿dónde se cortó la cadena?".
export default function TrazabilidadPage() {
  return (
    <Pantalla activo="/trazabilidad">
      <Trazabilidad />
    </Pantalla>
  );
}
